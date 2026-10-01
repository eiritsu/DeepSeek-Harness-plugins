/**
 * Durable agent session-event vocabulary shared with type-only consumers.
 *
 * @module @deepseek-ai/dsh-agent/types
 */

import type { UserMessage } from '@deepseek-ai/dsh-llm/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
// Type-only: the Workspace registry's archive-admission family map this registry merges `turn` into.
import type {} from '@deepseek-ai/dsh-workspace/types'
import type { OptionalSessionSeq, SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { TypertContext, TypertLookup } from '@deepseek-ai/dsh-typert-protocol'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Public live-agent handle; the runtime face augments its live capabilities. */
export interface Agent {
  /** Session-backed Agent identity. */
  readonly id: SessionId
}

declare module '@deepseek-ai/dsh-workspace/types' {
  interface SessionActivityKindMap {
    /** The session's own Agent is inside a turn, including one waiting for an approval or an answer. */
    turn: true
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap {
    agent: TypertLookup<Agent, SessionId>
  }

  interface TypertContextMap {
    /** Agent Context identity shared by Host and Client adapters. */
    agent: TypertContext<SessionId>
  }
}

/** One of the two ordered pending-message lists owned by an agent. */
export type InboxTarget = 'next-turn' | 'next-step'

/** Identifies one idempotent Agent surface-replacement operation. */
export type SurfaceReplacementRequestId = Branded<'agent-surface-replacement-request-id'>

/** Input to replace one current Session surface range with one user message. */
export interface SurfaceReplacementRequest {
  readonly requestId: SurfaceReplacementRequestId
  readonly message: UserMessage
  readonly startSeq: SessionSeq
  readonly endSeq: SessionSeq
  readonly sourceEventSeqs: readonly SessionSeq[]
}

/** Current recovery state derived from the Session log, never process-local memory. */
export interface SurfaceReplacementState {
  readonly request: SurfaceReplacementRequest
  readonly requestedSeq: SessionSeq
  readonly messageSeq?: SessionSeq
  readonly requestStarted?: { readonly seq: SessionSeq; readonly turn: number; readonly step: number }
  readonly outcome?: 'completed' | 'pre-request-failure' | 'error' | 'aborted'
  readonly recovery: 'safe-to-start' | 'uncertain' | 'settled'
}

/** Complete pending Inbox value reconstructed from durable splices. */
export interface InboxState {
  readonly 'next-turn': readonly UserMessage[]
  readonly 'next-step': readonly UserMessage[]
}

/**
 * Wire-JSON pending Inbox value. Each message round-trips the session log
 * losslessly, but the fold state's full `UserMessage` type cannot cross a
 * typert Remote boundary (its source union carries an `unknown` replay
 * field), so the typed projection table keeps this JSON-safe form.
 */
export interface InboxWireState {
  readonly 'next-turn': readonly JsonValue[]
  readonly 'next-step': readonly JsonValue[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Pending agent input reconstructed from durable inbox splices. */
    inbox: InboxState
  }
  interface SessionProjectionMap {
    /** Pending agent input reconstructed from durable inbox splices. */
    inbox: InboxWireState
  }
}

/**
 * Turn and step boundaries folded from one agent session log.
 *
 * Reader contract: the key is registered by `dsh-agent-loop` and absent
 * otherwise. Without agent-loop no turn events exist, so readers treat an
 * absent key as "no open turn / no boundaries" — capability absence, not a
 * corrupt state. A reader whose behavior has no safe fallback for that
 * absence (the step-open decision, for example) may fail loud instead.
 */
export interface TurnBoundaryProjection {
  /** Seq of the open turn's `turn/start`, or null between turns. */
  readonly openTurnStartSeq: OptionalSessionSeq
  /** Seq of the latest `step/start` event, or null before the first step. */
  readonly lastStepStartSeq: OptionalSessionSeq
  /** The latest step boundary (`step/start` or `step/end`) and its seq, or null before the first step boundary. */
  readonly lastStepBoundary: { readonly kind: 'start' | 'end'; readonly seq: SessionSeq } | null
  /** Turn number of the latest `turn/start`; 0 before the first turn. */
  readonly lastTurn: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One normalized mutation of an agent's durable pending-message lists.
     * The session-projection registry applies the committed event before
     * `Session.append()` returns; Inbox live notifications follow that commit.
     */
    'agent/inbox/spliced': {
      target: InboxTarget
      start: number
      removedCount?: number
      inserted: UserMessage[]
      outcome?: 'canceled'
    }
    /**
     * A durable operation to replace an existing model-visible range with an edited user prompt.
     * @param payload.request - operation identity, exact current surface range, and replacement message.
     */
    'agent/surface-replacement/requested': { request: SurfaceReplacementRequest }
    /**
     * Conservative fence persisted and flushed immediately before the first external request.
     * @param payload.requestId - the accepted operation identity.
     * @param payload.turn - owning turn number.
     * @param payload.step - first external-request step number.
     */
    'agent/surface-replacement/request-started': {
      requestId: SurfaceReplacementRequestId
      turn: number
      step: number
    }
    /**
     * Terminal status; an unfinished started operation is uncertain and must not auto-retry.
     * @param payload.requestId - the accepted operation identity.
     * @param payload.outcome - final disposition of the operation.
     * @param payload.turn - owning turn when it started.
     */
    'agent/surface-replacement/settled': {
      requestId: SurfaceReplacementRequestId
      outcome: 'completed' | 'pre-request-failure' | 'error' | 'aborted'
      turn?: number
    }
  }
}
