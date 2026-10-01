import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SurfaceReplacementRequest, SurfaceReplacementRequestId } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  foldSurfaceReplacements,
  surfaceReplacementProjectionDefinition,
  type SurfaceReplacementFact,
} from '../src/surface-replacement.ts'

const requestId = brandString<SurfaceReplacementRequestId>('resend-1')
const request: SurfaceReplacementRequest = {
  requestId,
  message: createUserMessage({ content: [{ type: 'text', text: 'edited' }], source: { kind: 'user' } }),
  startSeq: SessionSeq(4),
  endSeq: SessionSeq(9),
  sourceEventSeqs: [4, 5, 6, 7, 8, 9].map(SessionSeq),
}

function requested(value: SurfaceReplacementRequest = request, seq = 11): SurfaceReplacementFact {
  return { kind: 'requested', seq: SessionSeq(seq), request: value }
}

function committedPrompt(value: SurfaceReplacementRequest = request, seq = 12): SessionEvent<'user/message'> {
  return {
    type: 'user/message',
    seq: SessionSeq(seq),
    time: 0,
    data: value.message,
    surfaceOp: { op: 'replace', startSeq: value.startSeq, endSeq: value.endSeq },
    sourceEventSeqs: [...value.sourceEventSeqs],
  }
}

describe('foldSurfaceReplacements', () => {
  it('derives prompt commit from the exact durable replacement event and marks started work uncertain', () => {
    expect(foldSurfaceReplacements([requested()])).toEqual([{
      request,
      requestedSeq: SessionSeq(11),
      recovery: 'safe-to-start',
    }])

    expect(foldSurfaceReplacements([
      requested(),
      { kind: 'request-started', seq: SessionSeq(13), requestId, turn: 3, step: 1 },
    ], [committedPrompt()])).toEqual([{
      request,
      requestedSeq: SessionSeq(11),
      messageSeq: SessionSeq(12),
      requestStarted: { seq: SessionSeq(13), turn: 3, step: 1 },
      recovery: 'uncertain',
    }])
  })

  it('deduplicates an earlier request id after later operations were accepted', () => {
    const second = { ...request, requestId: brandString<SurfaceReplacementRequestId>('resend-2') }
    expect(foldSurfaceReplacements([
      requested(request, 11),
      { kind: 'settled', seq: SessionSeq(12), requestId, outcome: 'pre-request-failure', turn: 3 },
      requested(second, 13),
      { kind: 'settled', seq: SessionSeq(14), requestId: second.requestId, outcome: 'pre-request-failure', turn: 4 },
      requested({ ...request, message: { ...request.message } }, 15),
    ])).toEqual([
      { request, requestedSeq: SessionSeq(11), outcome: 'pre-request-failure', recovery: 'settled' },
      { request: second, requestedSeq: SessionSeq(13), outcome: 'pre-request-failure', recovery: 'settled' },
    ])
  })

  it('rejects request id reuse with a different payload', () => {
    expect(() => foldSurfaceReplacements([
      requested(request, 11),
      requested({ ...request, message: { ...request.message, content: [] } }, 12),
    ])).toThrow(/conflicting payload/)
  })

  it('rejects overlapping operations and facts outside Session-log order', () => {
    expect(() => foldSurfaceReplacements([
      requested(request, 11),
      requested({ ...request, requestId: brandString<SurfaceReplacementRequestId>('resend-2') }, 12),
    ])).toThrow(/overlaps/)
    expect(() => foldSurfaceReplacements([requested(request, 12), requested(request, 11)])).toThrow(/Session-log order/)
  })

  it('rejects prompt identity, content, operation, reference, and event-order mismatches', () => {
    const wrongContent: SessionEvent<'user/message'> = {
      ...committedPrompt(),
      data: { ...request.message, content: [{ type: 'text', text: 'other' }] },
    }
    const wrongRange: SessionEvent<'user/message'> = {
      ...committedPrompt(),
      surfaceOp: { op: 'replace', startSeq: SessionSeq(3), endSeq: SessionSeq(9) },
    }
    const wrongSources: SessionEvent<'user/message'> = {
      ...committedPrompt(),
      sourceEventSeqs: [SessionSeq(4)],
    }
    for (const prompt of [wrongContent, wrongRange, wrongSources, committedPrompt(request, 10)]) {
      expect(() => foldSurfaceReplacements([requested()], [prompt])).toThrow()
    }
    expect(() => foldSurfaceReplacements([
      requested(),
      { kind: 'request-started', seq: SessionSeq(13), requestId, turn: 3, step: 1 },
    ], [committedPrompt(request, 14)])).toThrow(/request-started/)
  })

  it('rejects malformed ranges and pre-request settlement before a committed prompt', () => {
    expect(() => foldSurfaceReplacements([requested({
      ...request,
      sourceEventSeqs: [SessionSeq(5), SessionSeq(9)],
    })])).toThrow(/request range/)
    expect(() => foldSurfaceReplacements([
      requested(),
      { kind: 'settled', seq: SessionSeq(13), requestId, outcome: 'pre-request-failure' },
    ], [committedPrompt(request, 14)])).toThrow(/pre-request-failure/)
  })

  it('settles failures before an external request so later requests are not blocked', () => {
    const next = { ...request, requestId: brandString<SurfaceReplacementRequestId>('resend-2') }
    expect(foldSurfaceReplacements([
      requested(request, 11),
      { kind: 'settled', seq: SessionSeq(12), requestId, outcome: 'pre-request-failure', turn: 3 },
      requested(next, 13),
    ])).toHaveLength(2)
  })

  it('rejects duplicate request-started and terminal facts', () => {
    const started: SurfaceReplacementFact = { kind: 'request-started', seq: SessionSeq(13), requestId, turn: 3, step: 1 }
    const settled: SurfaceReplacementFact = {
      kind: 'settled', seq: SessionSeq(14), requestId, outcome: 'pre-request-failure', turn: 3,
    }
    expect(() => foldSurfaceReplacements([requested(), started, { ...started, seq: SessionSeq(14) }], [committedPrompt()]))
      .toThrow(/request-started/)
    expect(() => foldSurfaceReplacements([requested(), settled, { ...settled, seq: SessionSeq(15) }]))
      .toThrow(/terminal outcome/)
  })

  it('marks started but unsettled work uncertain and prevents automatic retry', () => {
    expect(foldSurfaceReplacements([
      requested(),
      { kind: 'request-started', seq: SessionSeq(13), requestId, turn: 3, step: 1 },
    ], [committedPrompt()])[0]?.recovery).toBe('uncertain')
    expect(() => foldSurfaceReplacements([
      requested(),
      { kind: 'request-started', seq: SessionSeq(13), requestId, turn: 3, step: 1 },
      { kind: 'request-started', seq: SessionSeq(14), requestId, turn: 3, step: 2 },
    ], [committedPrompt()])).toThrow(/request-started/)
  })

  it('reconstructs operation state through the registered log projection', () => {
    let state = surfaceReplacementProjectionDefinition.init()
    const apply = (event: Parameters<typeof surfaceReplacementProjectionDefinition.apply>[1]) => {
      state = surfaceReplacementProjectionDefinition.apply(state, event)
    }
    apply({
      type: 'agent/surface-replacement/requested',
      seq: SessionSeq(11),
      time: 0,
      data: { request },
    })
    apply(committedPrompt(request, 12))
    apply({
      type: 'agent/surface-replacement/request-started',
      seq: SessionSeq(13),
      time: 0,
      data: { requestId, turn: 3, step: 1 },
    })
    expect(foldSurfaceReplacements(state.facts, state.committedPrompts)[0]?.recovery).toBe('uncertain')
    expect(() => surfaceReplacementProjectionDefinition.apply(state, {
      type: 'agent/surface-replacement/settled',
      seq: SessionSeq(14),
      time: 0,
      data: { requestId, outcome: 'completed', turn: 3 },
    })).not.toThrow()
    apply({
      type: 'agent/surface-replacement/settled',
      seq: SessionSeq(14),
      time: 0,
      data: { requestId, outcome: 'completed', turn: 3 },
    })
    expect(foldSurfaceReplacements(state.facts, state.committedPrompts)[0]).toMatchObject({
      recovery: 'settled',
      outcome: 'completed',
    })
  })
})
