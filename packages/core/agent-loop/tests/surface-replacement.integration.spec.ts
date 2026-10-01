import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { SurfaceReplacementRequest, SurfaceReplacementRequestId } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { interruptedTurnClosers, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse, toolCallResponse } from './mock-adapter.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function harness(adapter: MockAdapter, persisted: boolean): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  if (persisted) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-surface-replacement-'))
    roots.push(root)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  }
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return ctx
}

async function readStoredEvents(ctx: Context, sessionId: ReturnType<typeof SessionId>): Promise<readonly SessionEvent[]> {
  const handle = await ctx.sessionPersistence.open(sessionId, 'read')
  try {
    return (await handle.read()).events
  } finally {
    await handle.close()
  }
}

async function seedStoredEvents(ctx: Context, sessionId: ReturnType<typeof SessionId>, events: readonly SessionEvent[]): Promise<void> {
  const handle = await ctx.sessionPersistence.create(ctx.sessions.prepare(sessionId).header)
  try {
    await handle.append(events)
  } finally {
    await handle.close()
  }
}

function requestFor(agent: Awaited<ReturnType<Context['agents']['create']>>['agent']): SurfaceReplacementRequest {
  const original = agent.session.snapshotEvents().find(event => event.type === 'user/message')
  if (original?.type !== 'user/message') throw new Error('test fixture did not create a user message')
  const startSeq = original.seq
  const endSeq = agent.session.surface.nodes.at(-1)
  if (endSeq === undefined) throw new Error('test fixture has no surface nodes')
  const sourceEventSeqs = agent.session.surface.nodes.filter(seq => seq >= startSeq && seq <= endSeq)
  return {
    requestId: brandString<SurfaceReplacementRequestId>('replace-operation-1'),
    message: createUserMessage({ content: [{ type: 'text', text: 'edited prompt' }], source: { kind: 'user' } }),
    startSeq,
    endSeq,
    sourceEventSeqs,
  }
}

class BarrierAdapter extends MockAdapter {
  readonly started: PromiseWithResolvers<void> = Promise.withResolvers()
  readonly release: PromiseWithResolvers<void> = Promise.withResolvers()
  private streamCount = 0

  override async *stream(options: Parameters<MockAdapter['stream']>[0]): AsyncIterable<Parameters<MockAdapter['stream']>[0] extends never ? never : import('@deepseek-ai/dsh-llm').StreamChunk> {
    this.requests.push(options)
    if (this.streamCount++ === 0) {
      yield* textResponse('initial answer')
      return
    }
    this.started.resolve()
    await this.release.promise
    yield* textResponse('replacement answer')
  }
}

describe('Agent.replaceSurface', () => {
  it('flushes intent, commits the replacement before dispatch, and returns terminal state', async () => {
    const adapter = new MockAdapter([textResponse('initial answer'), textResponse('replacement answer')])
    const ctx = await harness(adapter, true)
    const agent = await ctx.agents.create({
      sessionId: SessionId('surface-replacement-success'),
      agentOptions: { provider: 'mock', model: 'mock' },
    }).then(handle => handle.agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const request = requestFor(agent)

    const state = await agent.replaceSurface(request)

    expect(state).toMatchObject({ recovery: 'settled', outcome: 'completed', messageSeq: expect.any(Number) as number })
    expect(agent.session.deriveMessages().some(message => message.id === request.message.id)).toBe(true)
    expect(agent.session.deriveMessages().some(message => message.content.some(block => block.type === 'text' && block.text === 'original prompt'))).toBe(false)
    const events = agent.session.snapshotEvents()
    const requested = events.find(event => event.type === 'agent/surface-replacement/requested')
    const replacement = events.find(event => event.type === 'user/message' && event.data.id === request.message.id)
    const started = events.find(event => event.type === 'agent/surface-replacement/request-started')
    expect(requested?.seq).toBeLessThan(replacement?.seq ?? -1)
    expect(replacement?.seq).toBeLessThan(started?.seq ?? -1)
    expect(started?.seq).toBeLessThan(events.find(event => event.type === 'agent/surface-replacement/settled')?.seq ?? -1)
    expect(replacement).toMatchObject({ surfaceOp: { op: 'replace', startSeq: request.startSeq, endSeq: request.endSeq } })
    expect(adapter.requests).toHaveLength(2)
    await expect(agent.replaceSurface(request)).resolves.toEqual(state)
    expect(adapter.requests).toHaveLength(2)
  })

  it('continues ordinary tool steps after the replacement prompt and releases its reservation before resolving', async () => {
    const adapter = new MockAdapter([
      textResponse('initial answer'),
      toolCallResponse('replacement-call', 'replacement-probe', {}, 'checking'),
      textResponse('replacement answer'),
      textResponse('next turn'),
    ])
    const ctx = await harness(adapter, true)
    ctx.tools.register(defineContentToolFixture({
      name: 'replacement-probe',
      description: 'Test tool for replacement continuation.',
      parameters: {},
      execute: async () => [{ type: 'text', text: 'probe result' }],
    }))
    const agent = await ctx.agents.create({
      sessionId: SessionId('surface-replacement-tool-continuation'),
      agentOptions: { provider: 'mock', model: 'mock' },
    }).then(handle => handle.agent)
    const failures: Error[] = []
    ctx.on('agent/error', ({ error }) => { failures.push(error instanceof Error ? error : new Error(String(error))) })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const replacement = await agent.replaceSurface(requestFor(agent))
    expect(failures.map(error => error.message)).toEqual([])
    expect(replacement).toMatchObject({ recovery: 'settled', outcome: 'completed' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'immediate next prompt' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    const events = agent.session.snapshotEvents()
    expect(events.filter(event => event.type === 'tool/call')).toHaveLength(1)
    expect(events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(events.filter(event => event.type === 'assistant/message')).toHaveLength(4)
    expect(adapter.requests).toHaveLength(4)
  })

  it('resumes a durable replacement prompt that was committed before request dispatch', async () => {
    const adapter = new MockAdapter([textResponse('initial answer'), textResponse('replacement answer')])
    const ctx = await harness(adapter, true)
    const agent = await ctx.agents.create({
      sessionId: SessionId('surface-replacement-safe-recovery-source'),
      agentOptions: { provider: 'mock', model: 'mock' },
    }).then(handle => handle.agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const request = requestFor(agent)
    agent.session.append('agent/surface-replacement/requested', { request })
    agent.session.append('user/message', request.message, {
      surfaceOp: { op: 'replace', startSeq: request.startSeq, endSeq: request.endSeq },
      sourceEventSeqs: [...request.sourceEventSeqs],
    })
    expect(await ctx.sessions.flush(agent.session)).toBe(true)
    expect(agent.surfaceReplacement(request.requestId)?.recovery).toBe('safe-to-start')
    const interrupted = await readStoredEvents(ctx, agent.session.id)
    expect(interrupted.some(event => event.type === 'agent/surface-replacement/request-started')).toBe(false)
    expect(interrupted.some(event => event.type === 'user/message' && event.data.id === request.message.id)).toBe(true)

    const retryAdapter = new MockAdapter([textResponse('resumed replacement')])
    const restoredCtx = await harness(retryAdapter, true)
    const restoredId = SessionId('surface-replacement-safe-recovery-restored')
    await seedStoredEvents(restoredCtx, restoredId, [...interrupted, ...interruptedTurnClosers(interrupted)])
    const restored = await restoredCtx.agents.resume({
      resumeSessionId: restoredId,
      agentOptions: { provider: 'mock', model: 'mock' },
    }).then(handle => handle.agent)
    await expect(restored.replaceSurface(request)).resolves.toMatchObject({ recovery: 'settled', outcome: 'completed' })
    expect(retryAdapter.requests).toHaveLength(1)
  })

  it('holds a synchronous Inbox reservation until the replacement turn settles', async () => {
    const adapter = new BarrierAdapter([])
    const ctx = await harness(adapter, true)
    const agent = await ctx.agents.create({
      sessionId: SessionId('surface-replacement-reservation'),
      agentOptions: { provider: 'mock', model: 'mock' },
    }).then(handle => handle.agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const request = requestFor(agent)
    const replacement = agent.replaceSurface(request)
    expect(agent.replaceSurface(request)).toBe(replacement)
    expect(() => agent.replaceSurface({
      ...request,
      message: createUserMessage({ content: [{ type: 'text', text: 'conflicting payload' }], source: { kind: 'user' } }),
    })).toThrow(/conflicting payload/)
    const result = replacement.then(value => ({ value }), (error: unknown) => ({ error }))
    await adapter.started.promise
    try {
      expect(() =>{  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'racing prompt' }], source: { kind: 'user' } })) })
        .toThrow(/reserved by a surface replacement/)
      expect(() =>{  agent.steer(createUserMessage({ content: [{ type: 'text', text: 'racing steer' }], source: { kind: 'user' } })) })
        .toThrow(/reserved by a surface replacement/)
      expect(() =>{  agent.inject(createUserMessage({ content: [{ type: 'text', text: 'racing context' }], source: { kind: 'user' } })) })
        .toThrow(/reserved by a surface replacement/)
      expect(() =>{  agent.inbox.append('next-turn', createUserMessage({ content: [{ type: 'text', text: 'direct write' }], source: { kind: 'user' } })) })
        .toThrow(/reserved by a surface replacement/)
      expect(() =>{  agent.inbox.clear() }).toThrow(/reserved by a surface replacement/)
    } finally {
      adapter.release.resolve()
      await result
    }
    await expect(result).resolves.toMatchObject({ value: { recovery: 'settled', outcome: 'completed' } })
    expect(agent.inbox.nextTurn).toHaveLength(0)
  })

  it('restores a flushed request-started fence as uncertain without replaying the provider call', async () => {
    const adapter = new BarrierAdapter([])
    const ctx = await harness(adapter, true)
    const agent = await ctx.agents.create({
      sessionId: SessionId('surface-replacement-crash-source'),
      agentOptions: { provider: 'mock', model: 'mock' },
    }).then(handle => handle.agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const request = requestFor(agent)
    const replacement = agent.replaceSurface(request)
    const outcome = replacement.then(value => ({ value }), (error: unknown) => ({ error }))
    await adapter.started.promise
    try {
      const interrupted = await readStoredEvents(ctx, agent.session.id)
      const repaired = [...interrupted, ...interruptedTurnClosers(interrupted)]

      const retryAdapter = new MockAdapter([textResponse('must not run automatically')])
      const restoredCtx = await harness(retryAdapter, true)
      const restoredId = SessionId('surface-replacement-crash-restored')
      await seedStoredEvents(restoredCtx, restoredId, repaired)
      const restored = await restoredCtx.agents.resume({
        resumeSessionId: restoredId,
        agentOptions: { provider: 'mock', model: 'mock' },
      }).then(handle => handle.agent)
      expect(restored.surfaceReplacement(request.requestId)?.recovery).toBe('uncertain')
      await expect(restored.replaceSurface(request)).resolves.toMatchObject({ recovery: 'uncertain' })
      expect(retryAdapter.requests).toHaveLength(0)
    } finally {
      adapter.release.resolve()
      await outcome
    }
    await expect(outcome).resolves.toMatchObject({ value: { recovery: 'settled' } })
  })

  it('does not accept a replacement when no durability listener participates', async () => {
    const adapter = new MockAdapter([textResponse('initial answer')])
    const ctx = await harness(adapter, false)
    const agent = await ctx.agents.create({
      sessionId: SessionId('surface-replacement-no-durability'),
      agentOptions: { provider: 'mock', model: 'mock' },
    }).then(handle => handle.agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    await expect(agent.replaceSurface(requestFor(agent))).rejects.toThrow(/durability listener/)
    expect(adapter.requests).toHaveLength(1)
  })
})
