import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  imConversationCwd,
  imConversationDigest,
  ensureImConversationWorkspace,
} from '../src/workspace.ts'
import { imSessionId, openImConversation } from '../src/conversation.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('IM conversation Workspace identity', () => {
  it('keeps provider conversation ids out of cwd and Session id', () => {
    const home = '/tmp/dsh-home-fixture'
    const cwd = imConversationCwd('weixin', 'wx-chat-secret-id', home)
    expect(cwd).toBe(join(home, 'workspaces', 'im', 'weixin', imConversationDigest('weixin', 'wx-chat-secret-id')))
    expect(cwd).not.toContain('wx-chat-secret-id')

    const sessionId = imSessionId('weixin', 'wx-chat-secret-id')
    expect(sessionId).toBe(imSessionId('weixin', 'wx-chat-secret-id'))
    expect(sessionId).not.toBe(imSessionId('telegram', 'wx-chat-secret-id'))
    expect(String(sessionId)).toMatch(/^im-weixin-/)
    expect(String(sessionId)).not.toContain('wx-chat-secret-id')
  })

  it('isolates workspaces across platforms for the same conversation key', () => {
    const home = '/tmp/dsh-home-fixture'
    expect(imConversationCwd('lark', 'shared-key', home))
      .not.toBe(imConversationCwd('weixin', 'shared-key', home))
  })
})

describe('ensureImConversationWorkspace', () => {
  it('creates the directory and registry Workspace before returning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-im-ws-'))
    vi.stubEnv('DSH_HOME', root)
    const attachSession = vi.fn(async () => {})
    const created = { attachSession }
    const resolveByPath = vi.fn(async () => undefined)
    const create = vi.fn(async () => created)
    const ctx = {
      workspaceRegistry: { resolveByPath, create },
    }

    try {
      const result = await ensureImConversationWorkspace(ctx as never, 'discord', 'guild-channel-1')
      expect(create).toHaveBeenCalledOnce()
      expect(result.workspace).toBe(created)
      expect(result.cwd).toContain(join('workspaces', 'im', 'discord'))
      expect(result.cwd).toContain(imConversationDigest('discord', 'guild-channel-1'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an empty conversation key', async () => {
    const ctx = { workspaceRegistry: { resolveByPath: vi.fn(), create: vi.fn() } }
    await expect(ensureImConversationWorkspace(ctx as never, 'qq', '  '))
      .rejects.toThrow(/non-empty/)
  })
})

describe('openImConversation', () => {
  it('prepares an independent Workspace before creating a Session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-im-open-'))
    vi.stubEnv('DSH_HOME', root)
    const attachSession = vi.fn(async () => {})
    const workspace = { attachSession }
    const dispose = vi.fn(async () => {})
    const agent = { session: { header: { cwd: undefined as string | undefined } } }
    const handle = { agent, dispose }
    const create = vi.fn(async (request: { meta?: { cwd?: string } }) => {
      agent.session.header.cwd = request.meta?.cwd
      return handle
    })
    const resume = vi.fn()
    const ctx = {
      workspaceRegistry: {
        resolveByPath: vi.fn(async () => undefined),
        create: vi.fn(async () => workspace),
      },
      sessionPersistence: { stat: vi.fn(async () => undefined) },
      agents: { create, resume },
    }

    try {
      const opened = await openImConversation(ctx as never, {
        platform: 'telegram',
        conversationKey: 'tg-chat-9',
        selection: { provider: 'mock', model: 'mock' },
      })
      expect(create).toHaveBeenCalledOnce()
      expect(resume).not.toHaveBeenCalled()
      expect(attachSession).toHaveBeenCalledWith(opened.sessionId)
      expect(opened.cwd).toBe(imConversationCwd('telegram', 'tg-chat-9', root))
      expect(opened.sessionId).toBe(imSessionId('telegram', 'tg-chat-9'))
      expect(create.mock.calls[0]?.[0]).toMatchObject({
        sessionId: opened.sessionId,
        meta: { cwd: opened.cwd },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resumes a persisted Session and still attaches the conversation Workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-im-resume-'))
    vi.stubEnv('DSH_HOME', root)
    const attachSession = vi.fn(async () => {})
    const workspace = { attachSession }
    const handle = { agent: { session: { header: {} } }, dispose: vi.fn(async () => {}) }
    const resume = vi.fn(async () => handle)
    const create = vi.fn()
    const sessionId = imSessionId('whatsapp', 'wa-peer-1')
    const ctx = {
      workspaceRegistry: {
        resolveByPath: vi.fn(async () => workspace),
        create: vi.fn(),
      },
      sessionPersistence: { stat: vi.fn(async () => ({ id: SessionId(String(sessionId)) })) },
      agents: { create, resume },
    }

    try {
      const opened = await openImConversation(ctx as never, {
        platform: 'whatsapp',
        conversationKey: 'wa-peer-1',
        selection: { provider: 'mock', model: 'mock' },
      })
      expect(resume).toHaveBeenCalledOnce()
      expect(create).not.toHaveBeenCalled()
      expect(attachSession).toHaveBeenCalledWith(opened.sessionId)
      expect(opened.sessionId).toBe(sessionId)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('disposes the Agent handle when Workspace attach fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-im-attach-fail-'))
    vi.stubEnv('DSH_HOME', root)
    const dispose = vi.fn(async () => {})
    const handle = { agent: { session: { header: {} } }, dispose }
    const ctx = {
      workspaceRegistry: {
        resolveByPath: vi.fn(async () => undefined),
        create: vi.fn(async () => ({
          attachSession: vi.fn(async () => { throw new Error('attach failed') }),
        })),
      },
      sessionPersistence: { stat: vi.fn(async () => undefined) },
      agents: {
        create: vi.fn(async () => handle),
        resume: vi.fn(),
      },
    }

    try {
      await expect(openImConversation(ctx as never, {
        platform: 'wecom',
        conversationKey: 'wecom-user-1',
        selection: { provider: 'mock', model: 'mock' },
      })).rejects.toThrow('attach failed')
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
