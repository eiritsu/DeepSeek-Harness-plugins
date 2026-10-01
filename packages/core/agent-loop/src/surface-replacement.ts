/** Durable operation state for one Agent Loop surface replacement. */

import type {
  SurfaceReplacementRequest,
  SurfaceReplacementRequestId,
  SurfaceReplacementState,
} from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { assertNever, deepEqualJson } from '@deepseek-ai/dsh-util-values'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Durable replacement facts and their committed user prompts. */
    surfaceReplacement: SurfaceReplacementProjection
  }
}

/** Projection-owned replacement facts and prompts recovered from the log. */
export interface SurfaceReplacementProjection {
  readonly facts: readonly SurfaceReplacementFact[]
  readonly committedPrompts: readonly CommittedReplacementPrompt[]
}

/** Session-log facts used to reconstruct replacement progress after restart. */
export type SurfaceReplacementFact =
  | { readonly kind: 'requested'; readonly seq: SessionSeq; readonly request: SurfaceReplacementRequest }
  | {
    readonly kind: 'request-started'
    readonly seq: SessionSeq
    readonly requestId: SurfaceReplacementRequestId
    readonly turn: number
    readonly step: number
  }
  | {
    readonly kind: 'settled'
    readonly seq: SessionSeq
    readonly requestId: SurfaceReplacementRequestId
    readonly outcome: 'completed' | 'pre-request-failure' | 'error' | 'aborted'
    readonly turn?: number
  }

/** A `user/message` event found while scanning the owning Session log. */
export type CommittedReplacementPrompt = SessionEvent<'user/message'>

const projectionSchema: z.ZodType<SurfaceReplacementProjection> = z.object({
  facts: z.array(z.custom<SurfaceReplacementFact>()).readonly(),
  committedPrompts: z.array(z.custom<CommittedReplacementPrompt>()).readonly(),
}).readonly()

/** Fold the replacement journal and matching committed prompts from each Session event. */
export const surfaceReplacementProjectionDefinition = {
  key: 'surfaceReplacement',
  stateSchema: projectionSchema,
  init: (): SurfaceReplacementProjection => ({ facts: [], committedPrompts: [] }),
  apply(state: SurfaceReplacementProjection, event): SurfaceReplacementProjection {
    let facts = state.facts
    let committedPrompts = state.committedPrompts
    switch (event.type) {
      case 'agent/surface-replacement/requested':
        facts = [...facts, { kind: 'requested', seq: event.seq, request: event.data.request }]
        break
      case 'agent/surface-replacement/request-started':
        facts = [...facts, { kind: 'request-started', seq: event.seq, ...event.data }]
        break
      case 'agent/surface-replacement/settled':
        facts = [...facts, { kind: 'settled', seq: event.seq, ...event.data }]
        break
      case 'user/message':
        if (facts.some(fact => fact.kind === 'requested' && fact.request.message.id === event.data.id)) {
          committedPrompts = [...committedPrompts, event]
        }
        break
      default:
        return state
    }
    const next = { facts, committedPrompts }
    try {
      foldSurfaceReplacements(next.facts, next.committedPrompts)
    } catch (error: unknown) {
      throw new Error(`invalid surface-replacement history at session seq ${event.seq}`, { cause: error })
    }
    return next
  },
  stateVersion: 1,
} satisfies ProjectionDefinition<'surfaceReplacement', SurfaceReplacementProjection>

/**
 * Fold replacement facts and committed prompts from one ordered Session log.
 * @param facts - replacement operation facts in Session-log order.
 * @param committedPrompts - actual `user/message` events from that Session.
 * @returns every operation, preserving request-id lookup across later operations.
 */
export function foldSurfaceReplacements(
  facts: readonly SurfaceReplacementFact[],
  committedPrompts: readonly CommittedReplacementPrompt[] = [],
): readonly SurfaceReplacementState[] {
  const promptsByMessageId = new Map<MessageId, CommittedReplacementPrompt>()
  for (const event of committedPrompts) {
    const existing = promptsByMessageId.get(event.data.id)
    if (existing !== undefined && existing.seq !== event.seq) {
      throw new Error('replacement message id matches multiple durable user/messages')
    }
    promptsByMessageId.set(event.data.id, event)
  }

  const states: SurfaceReplacementState[] = []
  const indexById = new Map<SurfaceReplacementRequestId, number>()
  let previousFactSeq: SessionSeq | undefined
  for (const fact of facts) {
    if (previousFactSeq !== undefined && Number(fact.seq) <= Number(previousFactSeq)) {
      throw new Error('replacement facts are not in Session-log order')
    }
    previousFactSeq = fact.seq
    if (fact.kind === 'requested') {
      assertValidSurfaceReplacementRequest(fact.request, fact.seq)
      const knownIndex = indexById.get(fact.request.requestId)
      if (knownIndex !== undefined) {
        const known = states[knownIndex]
        if (known === undefined) throw new Error('replacement request index is out of range')
        if (!sameSurfaceReplacementRequest(known.request, fact.request)) throw new Error('replacement request id has conflicting payload')
        continue
      }
      const previous = states.at(-1)
      if (previous !== undefined && previous.recovery !== 'settled') {
        throw new Error('replacement request overlaps an unfinished operation')
      }
      const prompt = promptsByMessageId.get(fact.request.message.id)
      if (prompt !== undefined && !matchesReplacementPrompt(fact.request, prompt)) {
        throw new Error('durable user/message does not match replacement request')
      }
      if (prompt !== undefined && Number(prompt.seq) <= Number(fact.seq)) {
        throw new Error('replacement user/message precedes its request')
      }
      const state: SurfaceReplacementState = {
        request: fact.request,
        requestedSeq: fact.seq,
        ...(prompt === undefined ? {} : { messageSeq: prompt.seq }),
        recovery: 'safe-to-start',
      }
      indexById.set(fact.request.requestId, states.length)
      states.push(state)
      continue
    }

    const stateIndex = indexById.get(fact.requestId)
    if (stateIndex === undefined) throw new Error('replacement transition has no matching request')
    const state = states[stateIndex]
    if (state === undefined) throw new Error('replacement state index is out of range')
    if (state.recovery === 'settled') throw new Error('replacement operation already has a terminal outcome')
    switch (fact.kind) {
      case 'request-started':
        if (state.requestStarted !== undefined || state.messageSeq === undefined
          || Number(state.messageSeq) >= Number(fact.seq)
          || !validPositiveInteger(fact.turn) || !validPositiveInteger(fact.step)) {
          throw new Error('invalid replacement request-started transition')
        }
        states[stateIndex] = {
          ...state,
          requestStarted: { seq: fact.seq, turn: fact.turn, step: fact.step },
          recovery: 'uncertain',
        }
        continue
      case 'settled':
        break
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        assertNever(fact, 'surface replacement fact')
    }

    if (fact.outcome === 'pre-request-failure') {
      if (state.requestStarted !== undefined
        || state.messageSeq !== undefined && Number(state.messageSeq) >= Number(fact.seq)
        || fact.turn !== undefined && !validPositiveInteger(fact.turn)) {
        throw new Error('invalid replacement pre-request-failure transition')
      }
    } else if (state.requestStarted === undefined || state.requestStarted.turn !== fact.turn
      || Number(state.requestStarted.seq) >= Number(fact.seq)) {
      throw new Error('invalid replacement settled transition')
    }
    states[stateIndex] = { ...state, outcome: fact.outcome, recovery: 'settled' }
  }

  return states
}

/**
 * Compare idempotent request payloads as JSON values, ignoring object-key order.
 * @param left - previously accepted request.
 * @param right - request being checked for idempotency.
 * @returns whether both requests carry the same operation payload.
 */
export function sameSurfaceReplacementRequest(left: SurfaceReplacementRequest, right: SurfaceReplacementRequest): boolean {
  return left.startSeq === right.startSeq
    && left.endSeq === right.endSeq
    && deepEqualJson(left.message, right.message)
    && deepEqualJson(left.sourceEventSeqs, right.sourceEventSeqs)
}

/** Check that a committed user message is the exact requested surface replacement. */
function matchesReplacementPrompt(
  request: SurfaceReplacementRequest,
  event: CommittedReplacementPrompt,
): boolean {
  return event.data.id === request.message.id
    && deepEqualJson(event.data, request.message)
    && deepEqualJson(event.surfaceOp, { op: 'replace', startSeq: request.startSeq, endSeq: request.endSeq })
    && deepEqualJson(event.sourceEventSeqs, request.sourceEventSeqs)
}

/**
 * Validate the request's bounded, ordered references before accepting its durable event.
 * @param request - requested replacement and cited current surface range.
 * @param seq - next Session sequence, used to require earlier source references.
 */
export function assertValidSurfaceReplacementRequest(request: SurfaceReplacementRequest, seq: SessionSeq): void {
  const sourceSeqs = request.sourceEventSeqs.map(Number)
  const strictlyIncreasing = sourceSeqs.every((value, index) => {
    if (!Number.isSafeInteger(value)) return false
    const previous = sourceSeqs[index - 1]
    return previous === undefined || value > previous
  })
  if (Number(request.startSeq) > Number(request.endSeq)
    || Number(request.endSeq) >= Number(seq)
    || sourceSeqs.length === 0
    || sourceSeqs[0] !== Number(request.startSeq)
    || sourceSeqs.at(-1) !== Number(request.endSeq)
    || !strictlyIncreasing) {
    throw new Error('invalid surface-replacement request range')
  }
}

function validPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}
