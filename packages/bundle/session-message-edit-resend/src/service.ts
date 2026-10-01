/** Host policy and Remote methods for replacing the latest ordinary user turn. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, SurfaceReplacementRequest, SurfaceReplacementRequestId, SurfaceReplacementState } from '@deepseek-ai/dsh-agent'
import { MessageId, freezeMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { messageEditResendProjectionDefinition } from './projection.ts'
import type { EditEligibility, EditResendRequest, EditResendResult, EditResendStatus } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    messageEditResend: MessageEditResendService
  }
}

/** Domain-owned eligibility reason, safe to present without exposing Host details. */
type PolicyResult = EditEligibility & { readonly user?: UserMessage; readonly sourceSeqs?: readonly SessionSeq[] }

/** Remote service that revalidates and admits one edit/resend operation. */
export class MessageEditResendService extends TypertRemoteService {
  static inject = ['agents', 'sessionProjections']

  constructor(ctx: Context) {
    super(ctx, 'messageEditResend')
    ctx.effect(() => ctx.sessionProjections.register(messageEditResendProjectionDefinition), 'message-edit-resend: projection')
  }

  /** Replace one eligible prompt and wait for its durable turn settlement.
   * @param agent - Session's live Agent.
   * @param request - request identity and edited prompt text.
   * @returns durable completion, uncertainty, or failure state.
   */
  @Remote('replace')
  async replace(agent: Agent, request: EditResendRequest): Promise<EditResendResult> {
    this.assertLive(agent)
    validateRequest(request)

    const requestId = brandString<SurfaceReplacementRequestId>(request.requestId)
    const existing = agent.surfaceReplacement(requestId)
    let operation: SurfaceReplacementRequest
    if (existing !== undefined) {
      const existingText = primaryTextOf(existing.request.message)
      const source = this.ctx.sessionProjections.stateOf(agent.session, 'messageEditResend')?.operations
        .find(operationSource => operationSource.requestId === request.requestId)
      if (Number(existing.request.startSeq) !== Number(request.seq)
        || String(existing.request.message.id) !== request.requestId
        || existingText !== request.text
        || source === undefined
        || String(source.messageId) !== String(request.messageId)
        || Number(source.seq) !== request.seq) {
        throw new Error('edit-resend request id has conflicting payload')
      }
      operation = existing.request
    } else {
      const policy = policyFor(this.ctx, agent, request.messageId, request.seq)
      if (!policy.eligible || policy.user === undefined || policy.sourceSeqs === undefined) {
        throw new Error('edit-resend target is no longer eligible')
      }
      operation = makeReplacement(request, policy.user, policy.sourceSeqs)
    }

    try {
      const state = await agent.replaceSurface(operation)
      return resultOf(state)
    } catch {
      const state = agent.surfaceReplacement(requestId)
      if (state !== undefined) return resultOf(state)
      throw new Error('edit-resend could not be durably admitted')
    }
  }

  /** Read a durable operation state by request identity.
   * @param agent - Session's live Agent.
   * @param requestId - UUID used when the operation was submitted.
   * @returns current durable status, or undefined before admission.
   */
  @Remote('status')
  status(agent: Agent, requestId: string): EditResendStatus | undefined {
    this.assertLive(agent)
    if (!isRequestId(requestId)) return undefined
    const state = agent.surfaceReplacement(brandString<SurfaceReplacementRequestId>(requestId))
    return state === undefined ? undefined : statusOf(state)
  }

  /** Read an unresolved replacement after the Client reconnects or reloads.
   * @param agent - Session's live Agent.
   * @returns the latest uncertain operation, or undefined when none needs review.
   */
  @Remote('latestStatus')
  latestStatus(agent: Agent): EditResendStatus | undefined {
    this.assertLive(agent)
    const operation = this.ctx.sessionProjections.stateOf(agent.session, 'messageEditResend')?.operations.at(-1)
    if (operation?.recovery !== 'uncertain') return undefined
    return {
      requestId: brandString<SurfaceReplacementRequestId>(operation.requestId),
      recovery: operation.recovery,
    }
  }

  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) throw new Error('edit-resend Agent is not live')
  }
}

function policyFor(
  ctx: Context,
  agent: Agent,
  messageId: string,
  seq: number,
): PolicyResult {
  const busy = agent.status !== 'idle' || agent.inbox.nextStep.length > 0 || agent.inbox.nextTurn.length > 0
  if (busy) return { eligible: false, reason: 'busy' }
  const state = ctx.sessionProjections.stateOf(agent.session, 'messageEditResend')
  const turn = state?.latest
  if (turn === undefined || turn === null || turn.endReason !== 'completed'
    || turn.unsafe || turn.userCount !== 1 || turn.user === null || turn.assistantSeqs.length === 0) {
    return { eligible: false, reason: 'not-ordinary-turn' }
  }
  const user = turn.user
  if (user.message.id !== messageId || Number(user.seq) !== seq) {
    return { eligible: false, reason: 'not-latest' }
  }
  const sourceSeqs = [user.seq, ...turn.assistantSeqs]
  const start = agent.session.surface.nodes.findIndex(node => Number(node) === Number(user.seq))
  const surfaceTail = start < 0 ? [] : agent.session.surface.nodes.slice(start)
  if (start < 0 || !deepEqualJson(surfaceTail, sourceSeqs)) {
    return { eligible: false, reason: 'not-latest' }
  }
  return { eligible: true, user: user.message, sourceSeqs }
}

function makeReplacement(
  request: EditResendRequest,
  original: UserMessage,
  sourceSeqs: readonly SessionSeq[],
): SurfaceReplacementRequest {
  const requestId = brandString<SurfaceReplacementRequestId>(request.requestId)
  const endSeq = sourceSeqs.at(-1)
  if (endSeq === undefined) throw new Error('Surface replacement requires at least one source event.')
  const content = replaceText(original, request.text)
  const message: UserMessage = freezeMessage({
    id: MessageId(request.requestId),
    role: 'user',
    source: original.source,
    content,
  })
  return {
    requestId,
    message,
    startSeq: SessionSeq(request.seq),
    endSeq,
    sourceEventSeqs: sourceSeqs,
  }
}

function replaceText(message: UserMessage, text: string): UserMessage['content'] {
  let replaced = false
  const content: UserMessage['content'][number][] = []
  for (const block of message.content) {
    if (block.type === 'text' && !replaced) {
      content.push({ type: 'text', text })
      replaced = true
    } else {
      content.push(block)
    }
  }
  return replaced ? content : [{ type: 'text', text }, ...content]
}

function primaryTextOf(message: UserMessage): string {
  return message.content.find(block => block.type === 'text')?.text ?? ''
}

function validateRequest(request: EditResendRequest): void {
  if (!isRequestId(request.requestId) || typeof request.text !== 'string' || request.text.trim() === ''
    || !Number.isSafeInteger(request.seq) || request.seq < 0 || typeof request.messageId !== 'string') {
    throw new Error('invalid edit-resend request')
  }
}

function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function resultOf(state: SurfaceReplacementState): EditResendResult {
  if (state.recovery === 'uncertain') return { kind: 'uncertain', requestId: state.request.requestId }
  if (state.recovery === 'settled' && state.outcome === 'completed') {
    return { kind: 'completed', requestId: state.request.requestId }
  }
  return { kind: 'failed', requestId: state.request.requestId }
}

function statusOf(state: SurfaceReplacementState): EditResendStatus {
  return {
    requestId: state.request.requestId,
    recovery: state.recovery,
    ...(state.outcome === undefined ? {} : { outcome: state.outcome }),
  }
}
