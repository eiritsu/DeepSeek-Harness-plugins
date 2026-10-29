import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractWeixinText,
  parseWeixinApiJson,
  parseWeixinBotCredential,
  weixinMessageId,
} from '../src/weixin-api.ts'
import { WeixinConversationBridge } from '../src/weixin-bridge.ts'
import { ILINK_BASE_URL, ILINK_MESSAGE_TYPE } from '../src/weixin-ilink-protocol.ts'
import { applyImRuntime } from '../src/runtime.ts'
import type { Config } from '../src/config.ts'
import type { ImConnectionStatus } from '../src/types.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('WeChat iLink credential and message helpers', () => {
  it('parses JSON credentials and legacy plain tokens', () => {
    expect(parseWeixinBotCredential(JSON.stringify({
      token: ' tok ',
      botId: 'bot-1',
      userId: 'user-1',
      baseUrl: 'https://example.ilink/',
    }))).toEqual({
      token: 'tok',
      botId: 'bot-1',
      userId: 'user-1',
      baseUrl: 'https://example.ilink',
    })
    expect(parseWeixinBotCredential(' plain-token ')).toEqual({
      token: 'plain-token',
      baseUrl: ILINK_BASE_URL,
    })
    expect(parseWeixinBotCredential('')).toBeUndefined()
  })

  it('quotes uint64 message ids and extracts text bodies', () => {
    const parsed = parseWeixinApiJson<{ message_id: string; msgs: { message_id: string }[] }>(
      '{"message_id":9007199254740993,"msgs":[{"message_id":9007199254740994}]}',
    )
    expect(parsed.message_id).toBe('9007199254740993')
    expect(parsed.msgs[0]?.message_id).toBe('9007199254740994')

    expect(extractWeixinText({
      item_list: [
        { type: 1, text_item: { text: '你好' } },
        { type: 3, voice_item: { text: '语音转写' } },
      ],
    })).toBe('你好\n语音转写')
    expect(weixinMessageId({ message_id: '42' })).toBe('42')
    expect(weixinMessageId({ seq: 7 })).toBe('seq-7')
    expect(weixinMessageId({})).toBeUndefined()
  })
})

describe('WeixinConversationBridge', () => {
  it('opens an IM conversation and replies after an inbound user text message', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-weixin-bridge-'))
    vi.stubEnv('DSH_HOME', home)

    const posts: Array<{ url: string; body: string }> = []
    let updates = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const body = typeof init?.body === 'string' ? init.body : ''
      posts.push({ url, body })
      if (url.includes('/notifystart')) return new Response('{}')
      if (url.includes('/notifystop')) return new Response('{}')
      if (url.includes('/getupdates')) {
        updates += 1
        if (updates === 1) {
          return new Response(JSON.stringify({
            ret: 0,
            get_updates_buf: 'cursor-1',
            msgs: [{
              message_id: '1001',
              from_user_id: 'wx-user-1',
              message_type: ILINK_MESSAGE_TYPE.USER,
              context_token: 'ctx-token',
              item_list: [{ type: 1, text_item: { text: '你好' } }],
            }],
          }))
        }
        await new Promise<void>((resolve) => {
          const signal = init?.signal
          if (signal?.aborted) {
            resolve()
            return
          }
          signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
        return new Response(JSON.stringify({ ret: 0, msgs: [], get_updates_buf: 'cursor-1' }))
      }
      if (url.includes('/sendmessage')) {
        return new Response(JSON.stringify({ ret: 0, message_id: '2001' }))
      }
      throw new Error(`unexpected fetch ${url}`)
    })

    const ctx = new Context()
    const session = { header: { cwd: undefined as string | undefined } }
    const followup = vi.fn((message: {
      content: readonly { type: string; text?: string }[]
      source: { kind: string; messageId: string }
    }) => {
      queueMicrotask(() => {
        ctx.emit('session/event', session as never, {
          type: 'user/message',
          data: { source: message.source },
        } as never)
        ctx.emit('session/event', session as never, {
          type: 'assistant/message',
          data: { message: { content: [{ type: 'text', text: '收到' }] } },
        } as never)
        ctx.emit('session/event', session as never, {
          type: 'turn/end',
          data: { reason: { kind: 'completed' } },
        } as never)
      })
    })
    const dispose = vi.fn(async () => {})
    const attachSession = vi.fn(async () => {})
    const agent = { id: 'im-weixin-test', session, followup }
    const handle = { agent, dispose }

    ctx.provide('fiber', { assertActive: () => {} })
    ctx.provide('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    })
    ctx.provide('workspaceRegistry', {
      resolveByPath: async () => undefined,
      create: async () => ({ attachSession }),
    })
    ctx.provide('sessionPersistence', {
      stat: async () => undefined,
    })
    ctx.provide('sessionQuery', {
      observeSession: async () => ({ events: [], [Symbol.dispose]: () => {} }),
    })
    ctx.provide('agents', {
      create: async () => handle,
      resume: async () => handle,
      get: () => undefined,
    })

    const bridge = new WeixinConversationBridge(ctx, {
      credential: { token: 'tok', baseUrl: ILINK_BASE_URL, botId: 'bot-1', userId: 'wx-user-1' },
      whitelistEnabled: false,
      allowedSenderIds: [],
      responseTimeoutMs: 5_000,
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
      home,
    })

    try {
      await bridge.connect()
      await vi.waitFor(() => {
        expect(followup).toHaveBeenCalledOnce()
        expect(posts.some(p => p.url.includes('/sendmessage') && p.body.includes('收到'))).toBe(true)
      }, { timeout: 5_000 })
      expect(attachSession).toHaveBeenCalled()
      expect(followup.mock.calls[0]?.[0].source.kind).toBe('weixin')
    } finally {
      await bridge.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })

  it('filters unauthorized senders when whitelist is enabled', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-weixin-whitelist-'))
    vi.stubEnv('DSH_HOME', home)

    let updates = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/notifystart') || url.includes('/notifystop')) return new Response('{}')
      if (url.includes('/getupdates')) {
        updates += 1
        if (updates === 1) {
          return new Response(JSON.stringify({
            ret: 0,
            get_updates_buf: 'cursor-1',
            msgs: [{
              message_id: '1001',
              from_user_id: 'unauthorized-user',
              message_type: ILINK_MESSAGE_TYPE.USER,
              item_list: [{ type: 1, text_item: { text: '你好' } }],
            }],
          }))
        }
        await new Promise<void>((resolve) => {
          const signal = init?.signal
          if (signal?.aborted) {
            resolve()
            return
          }
          signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
        return new Response(JSON.stringify({ ret: 0, msgs: [] }))
      }
      return new Response('{}')
    })

    const ctx = new Context()
    const followup = vi.fn()
    ctx.provide('fiber', { assertActive: () => {} })
    ctx.provide('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

    const bridge = new WeixinConversationBridge(ctx, {
      credential: { token: 'tok', baseUrl: ILINK_BASE_URL, botId: 'bot-1' },
      whitelistEnabled: true,
      allowedSenderIds: ['authorized-user'],
      responseTimeoutMs: 5_000,
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
      home,
    })

    try {
      await bridge.connect()
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(followup).not.toHaveBeenCalled()
    } finally {
      await bridge.dispose()
      await rm(home, { recursive: true, force: true })
    }
  })
})

describe('applyImRuntime WeChat bridge', () => {
  it('marks WeChat connected after notifyStart succeeds', async () => {
    const published: ImConnectionStatus[] = []
    const status = {
      publish: (item: ImConnectionStatus) => { published.push(item) },
    }
    const config = {
      enabled: { get: () => true },
      weixinEnabled: { get: () => true },
      weixinBotTokenEnv: { get: () => 'WEIXIN_BOT_TOKEN' },
      whitelistEnabled: { get: () => false },
      authorizedUsers: { get: () => '' },
      larkAppId: { get: () => '' },
      larkAppSecretEnv: { get: () => '' },
      dingtalkClientId: { get: () => '' },
      dingtalkClientSecretEnv: { get: () => '' },
      wecomBotId: { get: () => '' },
      wecomBotSecretEnv: { get: () => '' },
      qqAppId: { get: () => '' },
      qqAppSecretEnv: { get: () => '' },
      telegramBotTokenEnv: { get: () => '' },
      discordBotTokenEnv: { get: () => '' },
      whatsappPhoneNumberId: { get: () => '' },
      whatsappAccessTokenEnv: { get: () => '' },
      whatsappEnabled: { get: () => false },
    } as unknown as Config

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/notifystart') || url.includes('/notifystop')) return new Response('{}')
      if (url.includes('/getupdates')) {
        await new Promise<void>((resolve) => {
          const signal = init?.signal
          if (signal?.aborted) {
            resolve()
            return
          }
          signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
        return new Response(JSON.stringify({ ret: 0, msgs: [] }))
      }
      return new Response('{}')
    })

    const ctx = new Context()
    ctx.provide('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    ctx.provide('fiber', { assertActive: () => {} })
    ctx.provide('credentials', {
      resolve: async () => ({ value: JSON.stringify({ token: 'live-token', botId: 'bot' }) }),
    })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    })

    const dispose = applyImRuntime(ctx, config, status as never)
    try {
      await vi.waitFor(() => {
        expect(published.some(item => item.platform === 'weixin' && item.state === 'connected')).toBe(true)
      }, { timeout: 5_000 })
    } finally {
      await dispose()
    }
  })
})
