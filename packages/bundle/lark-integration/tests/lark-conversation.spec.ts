import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { LarkChannel, NormalizedMessage } from '@larksuite/channel'
import { describe, expect, it, vi } from 'vitest'
import { LarkConversationBridge, larkSessionId } from '../src/host/lark/conversation.ts'

const APP_ID = 'cli_app'
const OPEN_ID = 'ou_authorized'

interface AgentFixture {
  readonly id: Agent['id']
  readonly session: { readonly id: Agent['id']; readonly header: { readonly cwd?: string } }
  followup: Agent['followup']
}

interface ContextFixture {
  readonly fiber: { assertActive(): void }
  readonly logger: { warn(message: string): void }
  on(event: string, listener: (session: object, event: never) => void): () => boolean
  readonly agents: {
    get(id: Agent['id']): Agent | undefined
    create: AgentHandle['agent'] extends never ? never : (...args: never[]) => Promise<AgentHandle>
    resume: (...args: never[]) => Promise<AgentHandle>
  }
  readonly sessionPersistence: { stat: (...args: never[]) => Promise<object | undefined> }
  readonly sessionQuery: { observeSession: (...args: never[]) => Promise<{ events: readonly unknown[]; [Symbol.dispose](): void }> }
  readonly workspaceRegistry: {
    resolveByPath: (...args: never[]) => Promise<{ attachSession: (...args: never[]) => Promise<void> } | undefined>
    create: (...args: never[]) => Promise<{ attachSession: (...args: never[]) => Promise<void> }>
  }
  readonly attachments: {
    saveImage: (...args: never[]) => Promise<unknown>
    saveFile: (...args: never[]) => Promise<unknown>
    readImage: (...args: never[]) => Promise<unknown>
  }
}

interface ChannelFixture {
  on(event: string, handler: (message: NormalizedMessage) => void): () => void
  connect(): Promise<void>
  disconnect(): Promise<void>
  reply: LarkChannel['reply']
  downloadResourceWithMeta: LarkChannel['downloadResourceWithMeta']
}

function agentFixture(value: AgentFixture): Agent {
  return value as never
}

function contextFixture(value: ContextFixture): Context {
  return value as never
}

function channelFixture(value: ChannelFixture): LarkChannel {
  return value as never
}

interface Harness {
  readonly bridge: LarkConversationBridge
  readonly channel: LarkChannel
  readonly channelConnect: ReturnType<typeof vi.fn>
  readonly channelDisconnect: ReturnType<typeof vi.fn>
  readonly eventDisposers: ReturnType<typeof vi.fn>[]
  readonly channelHandler: (message: NormalizedMessage) => void
  readonly calls: { create: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>; followup: ReturnType<typeof vi.fn> }
  readonly attachmentCalls: { saveImage: ReturnType<typeof vi.fn>; saveFile: ReturnType<typeof vi.fn>; readImage: ReturnType<typeof vi.fn> }
  readonly observeSession: ReturnType<typeof vi.fn>
  readonly statSession: ReturnType<typeof vi.fn>
  readonly replies: ReturnType<typeof vi.fn>
  readonly events: Array<{ type: string; data: object }>
  readonly emitSessionEvent: (agent: AgentFixture, event: { type: string; data: Record<string, unknown> }) => void
}

function harness(options: {
  readonly persisted?: boolean
  readonly response?: readonly Record<string, unknown>[]
  readonly replyGate?: Promise<void>
} = {}): Harness {
  const events: Array<{ type: string; data: object }> = []
  const listeners = new Set<(session: object, event: never) => void>()
  const replies = vi.fn(async (..._args: Parameters<LarkChannel['reply']>) => {
    await options.replyGate
    return { messageId: 'reply-message' }
  })
  const eventDisposers: ReturnType<typeof vi.fn>[] = []
  const calls = { create: vi.fn(), resume: vi.fn(), followup: vi.fn() }
  const attachmentCalls = { saveImage: vi.fn(async () => ({ attachmentId: 'image-ref', mediaType: 'image/png', bytes: 10, width: 1, height: 1 })),
    saveFile: vi.fn(async () => ({ attachmentId: 'file-ref', name: 'file.txt', bytes: 10 })),
    readImage: vi.fn(async () => ({ data: new Uint8Array([1]), ref: { attachmentId: 'image-ref' } })) }
  const observeSession = vi.fn(async () => ({ events: [...events], [Symbol.dispose]: vi.fn() }))
  const statSession = vi.fn(async () => options.persisted ? {} : undefined)
  const handles: AgentHandle[] = []
  let channelHandler = (_message: NormalizedMessage): void => {}
  let agentNumber = 0
  const emitSessionEvent = (agent: AgentFixture, event: { type: string; data: object }): void => {
    events.push(event)
    for (const listener of listeners) listener(agent.session, event as never)
  }
  const makeAgent = (): AgentFixture => {
    agentNumber += 1
    const session = { id: larkSessionId(APP_ID, 'oc_chat'), header: { cwd: '/tmp/lark-workspace' } }
    const agent = {
      id: session.id,
      session,
      followup: vi.fn((message: Parameters<Agent['followup']>[0]) => {
        calls.followup(message)
        emitSessionEvent(agent, { type: 'user/message', data: message })
        const response = options.response ?? [{ type: 'text', text: `reply-${agentNumber}` }]
        emitSessionEvent(agent, {
          type: 'assistant/message', data: { message: { content: response } },
        })
        emitSessionEvent(agent, {
          type: 'turn/end', data: { reason: { kind: 'completed' } },
        })
      }),
    }
    const fixture = agentFixture(agent)
    const handle = { agent: fixture, dispose: vi.fn(async () => {}) }
    handles.push(handle)
    return { id: agent.id, session, followup: agent.followup }
  }
  const active: AgentFixture[] = []
  const channelConnect = vi.fn(async () => {})
  const channelDisconnect = vi.fn(async () => {})
  const makeHandle = (): AgentHandle => {
    const agent = makeAgent()
    active.push(agent)
    return handles.at(-1) as AgentHandle
  }
  const channel = channelFixture({
    on: vi.fn((event: string, handler: (message: NormalizedMessage) => void) => {
      if (event === 'message') channelHandler = handler
      const dispose = vi.fn()
      eventDisposers.push(dispose)
      return dispose
    }),
    connect: channelConnect,
    disconnect: channelDisconnect,
    reply: replies,
    downloadResourceWithMeta: vi.fn(async () => ({ buffer: Buffer.from('file-bytes'), contentType: 'image/png' })),
  })
  const ctx = contextFixture({
    fiber: { assertActive: vi.fn() },
    logger: { warn: vi.fn() },
    on: vi.fn((event: string, listener: (session: object, event: never) => void) => {
      if (event === 'session/event') listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    agents: {
      get: vi.fn(() => undefined),
      create: calls.create.mockImplementation(async () => makeHandle()),
      resume: calls.resume.mockImplementation(async () => makeHandle()),
    },
    sessionPersistence: { stat: statSession },
    sessionQuery: {
      observeSession,
    },
    workspaceRegistry: {
      resolveByPath: vi.fn(async () => ({ attachSession: vi.fn(async () => {}) })),
      create: vi.fn(async () => ({ attachSession: vi.fn(async () => {}) })),
    },
    attachments: {
      ...attachmentCalls,
    },
  })
  const bridge = new LarkConversationBridge(ctx, channel, {
    appId: APP_ID,
    allowedSenderId: OPEN_ID,
    cwd: '/tmp/lark-workspace',
    responseTimeoutMs: 5_000,
    currentSelection: () => ({ provider: 'mock', model: 'mock' }),
  })
  return {
    bridge,
    channel,
    channelConnect,
    channelDisconnect,
    eventDisposers,
    channelHandler: (value) => { channelHandler(value) },
    calls,
    attachmentCalls,
    observeSession,
    statSession,
    replies,
    events,
    emitSessionEvent,
  }
}

function message(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    messageId: 'om_message',
    chatId: 'oc_chat',
    chatType: 'p2p',
    senderId: OPEN_ID,
    content: 'hello',
    resources: [],
    ...overrides,
  } as NormalizedMessage
}

describe('larkSessionId', () => {
  it('is stable per application and chat while keeping provider ids out of the Session id', () => {
    expect(larkSessionId(APP_ID, 'oc_chat')).toBe(larkSessionId(APP_ID, 'oc_chat'))
    expect(larkSessionId(APP_ID, 'oc_chat')).not.toBe(larkSessionId('other-app', 'oc_chat'))
    expect(String(larkSessionId(APP_ID, 'oc_chat'))).not.toContain('oc_chat')
  })
})

describe('LarkConversationBridge', () => {
  it('opens the long connection, accepts only the configured private sender, and replies to a completed turn', async () => {
    const h = harness()
    await h.bridge.connect()
    expect(h.channelConnect).toHaveBeenCalledOnce()
    h.channelHandler(message({ senderId: 'ou_other' }))
    await Promise.resolve()
    expect(h.calls.create).not.toHaveBeenCalled()
    h.channelHandler(message())
    await vi.waitFor(() => { expect(h.replies).toHaveBeenCalledWith(expect.anything(), { text: 'reply-1' }) })
    expect(h.calls.create).toHaveBeenCalledOnce()
    expect(h.calls.followup).toHaveBeenCalledOnce()
    await h.bridge.dispose()
    expect(h.channelDisconnect).toHaveBeenCalledOnce()
  })

  it('unsubscribes and disconnects after a failed long-connection handshake', async () => {
    const h = harness()
    h.channelConnect.mockRejectedValueOnce(new Error('mock handshake failure'))

    await expect(h.bridge.connect()).rejects.toThrow('mock handshake failure')
    await h.bridge.dispose()

    expect(h.channelDisconnect).toHaveBeenCalledOnce()
    expect(h.eventDisposers).toHaveLength(2)
    for (const dispose of h.eventDisposers) expect(dispose).toHaveBeenCalledOnce()
  })

  it('reserves one platform message while its first reply is still in flight', async () => {
    const gate = Promise.withResolvers<undefined>()
    const h = harness({ replyGate: gate.promise })
    await h.bridge.connect()
    h.channelHandler(message())
    h.channelHandler(message())
    await vi.waitFor(() => { expect(h.replies).toHaveBeenCalled() })
    expect(h.calls.followup).toHaveBeenCalledOnce()

    gate.resolve(undefined)
    await h.bridge.dispose()
  })

  it('resumes a persisted Session and does not submit an already logged platform message again', async () => {
    const h = harness({ persisted: true })
    h.events.push({ type: 'user/message', data: { source: { kind: 'lark', appId: APP_ID, messageId: 'om_message' } } })
    await h.bridge.connect()
    h.channelHandler(message())
    await vi.waitFor(() => { expect(h.calls.resume).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(h.observeSession).toHaveBeenCalledOnce() })
    expect(h.statSession).toHaveBeenCalledOnce()
    expect(h.calls.followup).not.toHaveBeenCalled()
    expect(h.replies).not.toHaveBeenCalled()
    await h.bridge.dispose()
  })

  it('stores inbound images and files as durable references and returns model images to the same message', async () => {
    const h = harness({ response: [{ type: 'image', attachment: { attachmentId: 'image-ref' } }] })
    await h.bridge.connect()
    h.channelHandler(message({ resources: [
      { type: 'image', fileKey: 'img-key', fileName: 'photo.png' },
      { type: 'file', fileKey: 'file-key', fileName: 'notes.txt' },
    ] } as never))
    await vi.waitFor(() => { expect(h.replies).toHaveBeenCalledTimes(1) })
    expect(h.attachmentCalls.saveImage).toHaveBeenCalledOnce()
    expect(h.attachmentCalls.saveFile).toHaveBeenCalledOnce()
    expect(h.attachmentCalls.readImage).toHaveBeenCalledOnce()
    expect((h.calls.followup.mock.calls[0]?.[0] as { content: readonly { type: string }[] }).content.map(block => block.type))
      .toEqual(['text', 'image', 'file'])
    await h.bridge.dispose()
  })

  it('waits for accepted handlers to settle before disposal returns', async () => {
    const gate = Promise.withResolvers<undefined>()
    const h = harness({ replyGate: gate.promise })
    await h.bridge.connect()
    h.channelHandler(message())
    await vi.waitFor(() => { expect(h.replies).toHaveBeenCalled() })
    let disposed = false
    const disposing = h.bridge.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    gate.resolve(undefined)
    await disposing
    expect(disposed).toBe(true)
  })
})
