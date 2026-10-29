import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LarkChannel, NormalizedMessage } from '@larksuite/channel'

vi.mock('@larksuite/channel', () => ({
  createLarkChannel: () => ({
    on: vi.fn(() => () => {}),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  }),
}))

import { LarkConversationBridge } from '../src/lark-bridge.ts'
import { applyImRuntime } from '../src/runtime.ts'
import type { Config } from '../src/config.ts'
import type { ImConnectionStatus } from '../src/types.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('LarkConversationBridge', () => {
  it('opens an IM conversation and replies after an inbound Feishu message', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-lark-bridge-'))
    vi.stubEnv('DSH_HOME', home)

    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
    const replied: Array<{ message: NormalizedMessage; reply: unknown }> = []
    const channel = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] ?? []
        listeners[event]?.push(handler)
        return () => {}
      }),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      reply: vi.fn(async (message: NormalizedMessage, reply: unknown) => {
        replied.push({ message, reply })
        return { messageId: 'om_reply_1' }
      }),
    }

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
          data: { message: { content: [{ type: 'text', text: '飞书已收到' }] } },
        } as never)
        ctx.emit('session/event', session as never, {
          type: 'turn/end',
          data: { reason: { kind: 'completed' } },
        } as never)
      })
    })
    const dispose = vi.fn(async () => {})
    const attachSession = vi.fn(async () => {})
    const agent = { id: 'im-lark-test', session, followup }
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

    const bridge = new LarkConversationBridge(ctx, channel as never as LarkChannel, {
      appId: 'cli_test_app',
      whitelistEnabled: false,
      allowedSenderIds: [],
      responseTimeoutMs: 5_000,
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    })

    try {
      await bridge.connect()
      expect(channel.connect).toHaveBeenCalledOnce()

      const inboundMsg: NormalizedMessage = {
        messageId: 'om_12345',
        chatId: 'oc_67890',
        chatType: 'p2p',
        senderId: 'ou_user_1',
        content: '你好，小助手',
        rawContentType: 'text',
        mentions: [],
        mentionAll: false,
        mentionedBot: false,
        resources: [],
        createTime: Date.now(),
      }

      for (const fn of listeners.message ?? []) {
        fn(inboundMsg)
      }

      await vi.waitFor(() => {
        expect(followup).toHaveBeenCalledOnce()
        expect(replied.some(r => (r.reply as { text: string }).text === '飞书已收到')).toBe(true)
      }, { timeout: 5_000 })
      expect(attachSession).toHaveBeenCalled()
      expect(followup.mock.calls[0]?.[0].source.kind).toBe('lark')
    } finally {
      await bridge.dispose()
      expect(channel.disconnect).toHaveBeenCalled()
      await rm(home, { recursive: true, force: true })
    }
  })

  it('drops messages from senders not in whitelist when whitelist is enabled', async () => {
    const listeners: Record<string, ((...args: unknown[]) => void)[]> = {}
    const channel = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        listeners[event] = listeners[event] ?? []
        listeners[event]?.push(handler)
        return () => {}
      }),
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      reply: vi.fn(async () => ({ messageId: 'om_reply_1' })),
    }

    const ctx = new Context()
    const followup = vi.fn()
    ctx.provide('fiber', { assertActive: () => {} })
    ctx.provide('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

    const bridge = new LarkConversationBridge(ctx, channel as never as LarkChannel, {
      appId: 'cli_test_app',
      whitelistEnabled: true,
      allowedSenderIds: ['ou_authorized'],
      responseTimeoutMs: 5_000,
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    })

    try {
      await bridge.connect()
      const unauthorizedMsg: NormalizedMessage = {
        messageId: 'om_99999',
        chatId: 'oc_67890',
        chatType: 'p2p',
        senderId: 'ou_unauthorized',
        content: '未授权消息',
        rawContentType: 'text',
        mentions: [],
        mentionAll: false,
        mentionedBot: false,
        resources: [],
        createTime: Date.now(),
      }

      for (const fn of listeners.message ?? []) {
        fn(unauthorizedMsg)
      }

      await new Promise(resolve => setTimeout(resolve, 50))
      expect(followup).not.toHaveBeenCalled()
    } finally {
      await bridge.dispose()
    }
  })
})

describe('applyImRuntime Lark bridge', () => {
  it('connects Feishu/Lark channel when appId and secret exist', async () => {
    const published: ImConnectionStatus[] = []
    const status = {
      publish: (item: ImConnectionStatus) => { published.push(item) },
    }
    const config = {
      enabled: { get: () => true },
      weixinEnabled: { get: () => false },
      weixinBotTokenEnv: { get: () => '' },
      whitelistEnabled: { get: () => false },
      authorizedUsers: { get: () => '' },
      larkAppId: { get: () => 'cli_mock_app' },
      larkAppSecretEnv: { get: () => 'LARK_APP_SECRET' },
      larkBrand: { get: () => 'feishu' },
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

    const ctx = new Context()
    ctx.provide('logger', { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
    ctx.provide('fiber', { assertActive: () => {} })
    ctx.provide('credentials', {
      resolve: async (ref: { toString(): string }) =>
        String(ref) === 'LARK_APP_SECRET' ? { value: 'mock_sec' } : undefined,
    })
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    })

    const dispose = applyImRuntime(ctx, config, status as never)
    try {
      await vi.waitFor(() => {
        expect(published.some(item => item.platform === 'lark' && item.state === 'connected')).toBe(true)
      }, { timeout: 5_000 })
    } finally {
      await dispose()
    }
  })
})
