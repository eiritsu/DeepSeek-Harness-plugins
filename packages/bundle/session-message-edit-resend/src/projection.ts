/** Session-owned facts used to decide whether a completed user turn can be replaced. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { MessageId as MessageIdType } from '@deepseek-ai/dsh-llm/brand'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { SessionSeq as SessionSeqType } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    messageEditResend: MessageEditResendProjection
  }
  interface SessionProjectionMap {
    messageEditResend: EditableMessageRef | null
  }
}

/** Latest completed ordinary user message offered to the optional action row. */
export interface EditableMessageRef {
  readonly messageId: MessageIdType
  readonly seq: SessionSeqType
  readonly edited: boolean
}

interface TurnRecord {
  readonly turn: number
  readonly user: { readonly seq: SessionSeqType; readonly message: UserMessage; readonly edited: boolean } | null
  readonly userCount: number
  readonly assistantSeqs: SessionSeqType[]
  readonly unsafe: boolean
  readonly endReason: 'completed' | 'other' | null
}

/** The latest open or closed turn needed by the edit eligibility policy. */
export interface MessageEditResendProjection {
  readonly active: TurnRecord | null
  readonly latest: TurnRecord | null
  readonly operations: EditResendSource[]
}

/** Original message identity captured before the durable replacement changes the visible surface. */
export interface EditResendSource {
  readonly requestId: string
  readonly messageId: MessageIdType
  readonly seq: SessionSeqType
  readonly recovery: 'safe-to-start' | 'uncertain' | 'settled'
  readonly outcome: 'completed' | 'pre-request-failure' | 'error' | 'aborted' | null
}

const turnSchema = z.object({
  turn: z.number().int().nonnegative(),
  user: z.object({
    seq: z.number().int().nonnegative().transform(SessionSeq),
    message: z.custom<UserMessage>(),
    edited: z.boolean(),
  }).nullable(),
  userCount: z.number().int().nonnegative(),
  assistantSeqs: z.array(z.number().int().nonnegative().transform(SessionSeq)),
  unsafe: z.boolean(),
  endReason: z.enum(['completed', 'other']).nullable(),
}).strict()

const stateSchema = z.object({
  active: turnSchema.nullable(),
  latest: turnSchema.nullable(),
  operations: z.array(z.object({
    requestId: z.string().min(1),
    messageId: z.string().min(1).transform(MessageId),
    seq: z.number().int().nonnegative().transform(SessionSeq),
    recovery: z.enum(['safe-to-start', 'uncertain', 'settled']),
    outcome: z.enum(['completed', 'pre-request-failure', 'error', 'aborted']).nullable(),
  }).strict()),
}).strict()

const viewSchema: z.ZodType<EditableMessageRef | null> = z.object({
  messageId: z.string().min(1).transform(MessageId),
  seq: z.number().int().nonnegative().transform(SessionSeq),
  edited: z.boolean(),
}).strict().nullable()

/** Fold the latest turn without retaining prior transcript bodies. */
export const messageEditResendProjectionDefinition = {
  key: 'messageEditResend',
  stateVersion: 1,
  stateSchema,
  init: (): MessageEditResendProjection => ({ active: null, latest: null, operations: [] }),
  apply(state: MessageEditResendProjection, event: SessionEvent): MessageEditResendProjection {
    switch (event.type) {
      case 'agent/surface-replacement/requested': {
        const latest = state.latest
        const seq = event.data.request.startSeq
        if (latest?.user === null || latest?.user === undefined || latest.endReason !== 'completed'
          || latest.unsafe || latest.userCount !== 1 || latest.assistantSeqs.length === 0
          || latest.user.seq !== seq) return state
        const existing = state.operations.find(operation => operation.requestId === event.data.request.requestId)
        if (existing !== undefined) {
          if (existing.messageId !== latest.user.message.id || existing.seq !== seq) {
            throw new Error('edit-resend request id refers to a different source message')
          }
          return state
        }
        return {
          ...state,
          operations: [...state.operations, {
            requestId: event.data.request.requestId,
            messageId: latest.user.message.id,
            seq,
            recovery: 'safe-to-start',
            outcome: null,
          }],
        }
      }
      case 'agent/surface-replacement/request-started':
        return updateOperation(state, event.data.requestId, operation => ({ ...operation, recovery: 'uncertain' }))
      case 'agent/surface-replacement/settled':
        return updateOperation(state, event.data.requestId, operation => ({
          ...operation,
          recovery: 'settled',
          outcome: event.data.outcome,
        }))
      case 'turn/start':
        return {
          active: { turn: event.data.turn, user: null, userCount: 0, assistantSeqs: [], unsafe: false, endReason: null },
          latest: null,
          operations: state.operations,
        }
      case 'turn/end': {
        const active = state.active
        if (active === null || active.turn !== event.data.turn) return state
        const latest = {
          ...active,
          endReason: event.data.reason.kind === 'completed' ? 'completed' as const : 'other' as const,
        }
        return { ...state, active: null, latest }
      }
      case 'user/message':
        return forActiveTurn(state, (current) => {
          if (event.data.source.kind !== 'user') {
            return { ...current, unsafe: true }
          }
          return {
            ...current,
            user: current.user ?? {
              seq: event.seq,
              message: event.data,
              edited: isReplacementSurfaceEvent(event),
            },
            userCount: current.userCount + 1,
            unsafe: current.unsafe || current.user !== null,
          }
        })
      case 'assistant/message':
        return forTurn(state, event.data.turn, current => ({
          ...current,
          assistantSeqs: [...current.assistantSeqs, event.seq],
          unsafe: current.unsafe || event.data.interrupted === true,
        }))
      case 'system/message':
        return forTurn(state, event.data.turn, current => ({
          ...current,
          unsafe: current.unsafe || current.user !== null,
        }))
      case 'developer/message':
      case 'tool/call':
      case 'tool/result':
        return forTurn(state, event.data.turn, current => ({ ...current, unsafe: true }))
      default:
        return state
    }
  },
  wire: {
    viewSchema,
    view: (state: MessageEditResendProjection): EditableMessageRef | null => {
      const latest = state.latest
      if (latest === null || latest.endReason !== 'completed' || latest.unsafe
        || latest.userCount !== 1 || latest.user === null || latest.assistantSeqs.length === 0) return null
      return { messageId: latest.user.message.id, seq: latest.user.seq, edited: latest.user.edited }
    },
  },
} satisfies ProjectionDefinition<'messageEditResend', MessageEditResendProjection>

function forTurn(
  state: MessageEditResendProjection,
  turn: number,
  update: (current: TurnRecord) => TurnRecord,
): MessageEditResendProjection {
  if (state.active === null || state.active.turn !== turn) return state
  return { ...state, active: update(state.active) }
}

function forActiveTurn(
  state: MessageEditResendProjection,
  update: (current: TurnRecord) => TurnRecord,
): MessageEditResendProjection {
  return state.active === null ? state : { ...state, active: update(state.active) }
}

function updateOperation(
  state: MessageEditResendProjection,
  requestId: string,
  update: (operation: EditResendSource) => EditResendSource,
): MessageEditResendProjection {
  const index = state.operations.findIndex(operation => operation.requestId === requestId)
  if (index < 0) return state
  const operations = [...state.operations]
  const current = operations[index]
  if (current === undefined) return state
  operations[index] = update(current)
  return { ...state, operations }
}
