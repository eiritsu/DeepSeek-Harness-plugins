import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type SurfaceReplacementRequestId } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { brandString } from '@deepseek-ai/dsh-brand'
import LlmRuntime, { LlmAdapter, MessageId, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { interruptedTurnClosers, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { zipSync, strToU8 } from 'fflate'
import { apply as applyOffice, Config as OfficeConfig } from '@deepseek-ai/dsh-file-recognizer-office'
import { MessageEditResendService } from '../src/service.ts'
import type {} from '../src/projection.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

class FixtureAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly started: PromiseWithResolvers<void> = Promise.withResolvers()
  readonly release: PromiseWithResolvers<void> = Promise.withResolvers()
  constructor(
    private readonly script: readonly (readonly StreamChunk[])[],
    private readonly holdRequest?: number,
  ) { super() }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.script[this.requests.length - 1]
    if (response === undefined) throw new Error('fixture model response exhausted')
    if (this.requests.length === this.holdRequest) {
      this.started.resolve()
      await this.release.promise
    }
    yield* response
  }
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolResponse(): StreamChunk[] {
  const id = ToolCallId('edit-resend-tool-call')
  const args = '{}'
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name: 'edit-resend-probe', argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'edit-resend-probe', arguments: args } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

const docx = zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly attachment text</w:t></w:r></w:p></w:body></w:document>'),
})

async function harness(
  script: readonly (readonly StreamChunk[])[],
  holdRequest?: number,
  withEditResend = true,
): Promise<{ ctx: Context; adapter: FixtureAdapter }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionProjectionRegistry)
  const root = await mkdtemp(join(tmpdir(), 'dsh-edit-resend-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  if (withEditResend) await ctx.plugin(MessageEditResendService)
  const adapter = new FixtureAdapter(script, holdRequest)
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, adapter }
}

async function createAgent(ctx: Context, session: string) {
  return ctx.agents.create({
    sessionId: SessionId(session),
    agentOptions: { provider: 'mock', model: 'fixture' },
  }).then(handle => handle.agent)
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

describe('MessageEditResendService', () => {
  it('loads and continues a Session after the optional edit bundle is absent', async () => {
    const { ctx } = await harness([textResponse('initial answer'), textResponse('edited answer')])
    const sessionId = SessionId('message-edit-resend-bundle-removed')
    const agent = await createAgent(ctx, sessionId)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const original = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    if (original?.type !== 'user/message') throw new Error('test fixture has no original user message')
    const requestId = brandString<SurfaceReplacementRequestId>('00000000-0000-4000-8000-000000000041')
    await expect(ctx.messageEditResend.replace(agent, {
      requestId,
      messageId: original.data.id,
      seq: original.seq,
      text: 'edited prompt',
    })).resolves.toMatchObject({ kind: 'completed', requestId })

    const events = await readStoredEvents(ctx, sessionId)
    const { ctx: restoredCtx } = await harness([textResponse('next ordinary turn')], undefined, false)
    await seedStoredEvents(restoredCtx, sessionId, events)
    const restored = await restoredCtx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'fixture' },
    }).then(handle => handle.agent)

    expect(restored.session.deriveMessages().some(message => message.content.some(
      block => block.type === 'text' && block.text === 'edited prompt',
    ))).toBe(true)
    expect(restoredCtx.sessionProjections.stateOf(restored.session, 'messageEditResend')).toBeUndefined()
    restored.followup(createUserMessage({ content: [{ type: 'text', text: 'continue normally' }], source: { kind: 'user' } }))
    await restored.whenIdle()
    expect(restored.session.deriveMessages().some(message => message.content.some(
      block => block.type === 'text' && block.text === 'next ordinary turn',
    ))).toBe(true)
  })

  it('keeps Office extraction and the durable FileBlock through edit, model input, and cold resume', async () => {
    const { ctx, adapter } = await harness([textResponse('answer'), textResponse('replacement answer')])
    let reads = 0
    ctx.provide('attachments', {
      readFileStream: async function* () {
        reads++
        yield docx
      },
    } as never)
    await ctx.plugin(applyOffice, z.resolve({}, OfficeConfig, {})[0] as import('@deepseek-ai/dsh-file-recognizer-office').Config)
    const replacementFlags: boolean[] = []
    ctx.on('agent/pre-step', async ({ surfaceReplacement }, next) => {
      replacementFlags.push(surfaceReplacement === true)
      return next()
    })
    const agent = await createAgent(ctx, 'message-edit-resend-office-file')
    const attachment = {
      type: 'file' as const,
      attachment: { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), name: 'report.docx', bytes: docx.byteLength },
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'summarize this report' }, attachment],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    const original = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    if (original?.type !== 'user/message') throw new Error('fixture has no Office-enriched user event')
    expect(original.data.content).toEqual([
      { type: 'text', text: 'summarize this report' },
      attachment,
      { type: 'text', text: '[Extracted from report.docx]\nQuarterly attachment text' },
    ])
    const requestId = brandString<SurfaceReplacementRequestId>('00000000-0000-4000-8000-000000000021')
    await expect(ctx.messageEditResend.replace(agent, {
      requestId,
      messageId: original.data.id,
      seq: original.seq,
      text: 'summarize the totals in this report',
    })).resolves.toMatchObject({ kind: 'completed', requestId })

    const replacement = agent.session.snapshotEvents().find(event => event.type === 'user/message' && String(event.data.id) === requestId)
    if (replacement?.type !== 'user/message') throw new Error('replacement user event was not committed')
    expect(replacement.data.content).toEqual([
      { type: 'text', text: 'summarize the totals in this report' },
      attachment,
      { type: 'text', text: '[Extracted from report.docx]\nQuarterly attachment text' },
    ])
    expect(adapter.requests[1]?.messages.some(message => message.content.some(block =>
      block.type === 'text' && block.text.includes('Quarterly attachment text')))).toBe(true)
    await expect(ctx.messageEditResend.replace(agent, {
      requestId,
      messageId: original.data.id,
      seq: original.seq,
      text: 'summarize the totals in this report',
    })).resolves.toMatchObject({ kind: 'completed', requestId })
    await expect(ctx.messageEditResend.replace(agent, {
      requestId,
      messageId: original.data.id,
      seq: original.seq,
      text: 'different prompt',
    })).rejects.toThrow(/conflicting payload/)
    expect(adapter.requests).toHaveLength(2)
    expect(reads).toBe(1)
    expect(replacementFlags).toEqual([false, true])

    const { ctx: restoredCtx } = await harness([])
    await seedStoredEvents(restoredCtx, agent.session.id, await readStoredEvents(ctx, agent.session.id))
    const restored = await restoredCtx.agents.resume({
      resumeSessionId: agent.session.id,
      agentOptions: { provider: 'mock', model: 'fixture' },
    }).then(handle => handle.agent)
    const visible = restored.session.deriveMessages().find(message => message.id === replacement.data.id)
    expect(visible?.content).toEqual(replacement.data.content)
  })

  it('revalidates the latest turn and preserves original file blocks in the replacement', async () => {
    const { ctx, adapter } = await harness([textResponse('answer'), textResponse('replacement answer')])
    const agent = await createAgent(ctx, 'message-edit-resend-file-preservation')
    const file = {
      type: 'file' as const,
      attachment: { attachmentId: AttachmentId('a'.repeat(64)), name: 'fixture.docx', bytes: 12 },
    }
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'original prompt' }, file],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()
    const original = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    if (original?.type !== 'user/message') throw new Error('fixture has no original user event')
    const requestId = brandString<SurfaceReplacementRequestId>('00000000-0000-4000-8000-000000000001')
    const request = { requestId, messageId: original.data.id, seq: original.seq, text: 'edited prompt' }

    await expect(ctx.messageEditResend.replace(agent, request)).resolves.toMatchObject({ kind: 'completed', requestId })
    expect(ctx.messageEditResend.latestStatus(agent)).toBeUndefined()
    const replacement = agent.session.snapshotEvents().find(event => event.type === 'user/message' && String(event.data.id) === requestId)
    expect(replacement?.type).toBe('user/message')
    if (replacement?.type !== 'user/message') throw new Error('replacement user event was not committed')
    expect(replacement.data.content).toEqual([{ type: 'text', text: 'edited prompt' }, file])
    expect(adapter.requests).toHaveLength(2)
    await expect(ctx.messageEditResend.replace(agent, request)).resolves.toMatchObject({ kind: 'completed', requestId })
    await expect(ctx.messageEditResend.replace(agent, { ...request, text: 'different payload' })).rejects.toThrow(/conflicting payload/)
    await expect(ctx.messageEditResend.replace(agent, { ...request, messageId: MessageId('different-source') }))
      .rejects.toThrow(/conflicting payload/)

    const { ctx: restoredCtx } = await harness([])
    await seedStoredEvents(restoredCtx, agent.session.id, await readStoredEvents(ctx, agent.session.id))
    const restored = await restoredCtx.agents.resume({
      resumeSessionId: agent.session.id,
      agentOptions: { provider: 'mock', model: 'fixture' },
    }).then(handle => handle.agent)
    expect(restored.session.deriveMessages().map(message => ({
      role: message.role,
      text: message.content.filter(block => block.type === 'text').map(block => block.text).join(''),
    }))).toMatchInlineSnapshot(`
      [
        {
          "role": "system",
          "text": "You are an AI agent powered by DeepSeek Harness.",
        },
        {
          "role": "user",
          "text": "edited prompt",
        },
        {
          "role": "assistant",
          "text": "replacement answer",
        },
      ]
    `)
  })

  it('reports the exact durable operation as uncertain while its first request is in flight', async () => {
    const { ctx, adapter } = await harness([textResponse('answer'), textResponse('replacement answer')], 2)
    const agent = await createAgent(ctx, 'message-edit-resend-recovered-status')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const original = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    if (original?.type !== 'user/message') throw new Error('fixture has no original user event')
    const requestId = brandString<SurfaceReplacementRequestId>('00000000-0000-4000-8000-000000000003')
    const request = { requestId, messageId: original.data.id, seq: original.seq, text: 'edited prompt' }
    const operation = ctx.messageEditResend.replace(agent, request)
    await adapter.started.promise
    expect(ctx.messageEditResend.latestStatus(agent)).toEqual({ requestId, recovery: 'uncertain' })
    adapter.release.resolve()
    await expect(operation).resolves.toMatchObject({ kind: 'completed', requestId })
  })

  it('restores uncertain status from the flushed request-started Session prefix without retrying it', async () => {
    const { ctx, adapter } = await harness([textResponse('answer'), textResponse('replacement answer')], 2)
    const sessionId = SessionId('message-edit-resend-recovered-after-restart')
    const agent = await createAgent(ctx, sessionId)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original prompt' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const original = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    if (original?.type !== 'user/message') throw new Error('fixture has no original user event')
    const requestId = brandString<SurfaceReplacementRequestId>('00000000-0000-4000-8000-000000000004')
    const operation = ctx.messageEditResend.replace(agent, {
      requestId,
      messageId: original.data.id,
      seq: original.seq,
      text: 'edited prompt',
    })
    await adapter.started.promise

    const persisted = await readStoredEvents(ctx, sessionId)
    expect(persisted.some(event => event.type === 'agent/surface-replacement/request-started'
      && event.data.requestId === requestId)).toBe(true)
    const { ctx: restoredCtx, adapter: restoredAdapter } = await harness([])
    await seedStoredEvents(restoredCtx, sessionId, [...persisted, ...interruptedTurnClosers(persisted)])
    const restored = await restoredCtx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'fixture' },
    }).then(handle => handle.agent)

    expect(restoredCtx.messageEditResend.latestStatus(restored)).toEqual({ requestId, recovery: 'uncertain' })
    expect(restoredCtx.messageEditResend.status(restored, requestId)).toEqual({ requestId, recovery: 'uncertain' })
    expect(restoredAdapter.requests).toHaveLength(0)

    adapter.release.resolve()
    await expect(operation).resolves.toMatchObject({ kind: 'completed', requestId })
  })

  it('rejects a completed turn whose transcript contains a tool call', async () => {
    const { ctx } = await harness([toolResponse(), textResponse('tool result turn'), textResponse('must not resend')])
    ctx.tools.register(defineContentToolFixture({
      name: 'edit-resend-probe',
      description: 'Fixture tool.',
      parameters: {},
      execute: async () => [{ type: 'text', text: 'fixture result' }],
    }))
    const agent = await createAgent(ctx, 'message-edit-resend-tool-turn')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'run a tool' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    const original = agent.session.snapshotEvents().find(event => event.type === 'user/message')
    if (original?.type !== 'user/message') throw new Error('fixture has no original user event')
    await expect(ctx.messageEditResend.replace(agent, {
      requestId: brandString<SurfaceReplacementRequestId>('00000000-0000-4000-8000-000000000002'),
      messageId: original.data.id,
      seq: original.seq,
      text: 'edited prompt',
    })).rejects.toThrow(/no longer eligible/)
  })
})
