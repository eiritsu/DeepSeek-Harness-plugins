/** Wire values owned by the optional latest-user-turn edit bundle. */
import type { SurfaceReplacementRequestId, SurfaceReplacementState } from '@deepseek-ai/dsh-agent'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Host eligibility for one exact user message. */
export type EditEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: 'not-latest' | 'not-ordinary-turn' | 'busy' }

/** One request to replace the current user prompt and regenerate its answer. */
export interface EditResendRequest {
  readonly requestId: SurfaceReplacementRequestId
  readonly messageId: MessageId
  readonly seq: SessionSeq
  readonly text: string
}

/** Safe result for one edit-and-resend operation. */
export type EditResendResult =
  | { readonly kind: 'completed'; readonly requestId: SurfaceReplacementRequestId }
  | { readonly kind: 'uncertain'; readonly requestId: SurfaceReplacementRequestId }
  | { readonly kind: 'failed'; readonly requestId: SurfaceReplacementRequestId }

/** Public status for one operation, derived from the Session log. */
export interface EditResendStatus {
  readonly requestId: SurfaceReplacementRequestId
  readonly recovery: SurfaceReplacementState['recovery']
  readonly outcome?: SurfaceReplacementState['outcome']
}
