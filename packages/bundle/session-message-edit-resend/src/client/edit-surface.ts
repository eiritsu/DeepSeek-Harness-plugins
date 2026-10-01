/** Session-local transient state for an edit-and-resend action. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { SurfaceReplacementRequestId } from '@deepseek-ai/dsh-agent'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Draft and request state shown by the resident composer. */
export interface EditDraft {
  readonly token: symbol
  readonly messageId: MessageId
  readonly seq: SessionSeq
  readonly savedDraft: string
  readonly phase: 'editing' | 'submitting' | 'uncertain' | 'failed'
  readonly requestId?: SurfaceReplacementRequestId
}

/** Per-Session editor state shared by message actions and the composer overlay. */
export class EditResendSurface {
  readonly state: SnapshotStore<EditDraft | null> = createSnapshotStore<EditDraft | null>(null)

  /** Start editing one message while preserving the Session's previous draft. */
  begin(target: Pick<EditDraft, 'messageId' | 'seq'>, savedDraft: string): EditDraft {
    const current = this.state.getSnapshot()
    const draft: EditDraft = {
      token: Symbol('message-edit-resend'),
      ...target,
      savedDraft: current?.savedDraft ?? savedDraft,
      phase: 'editing',
    }
    this.state.set(draft)
    return draft
  }

  /** Update the visible operation state only while the same edit is active. */
  update(current: EditDraft, phase: EditDraft['phase'], requestId = current.requestId): boolean {
    const active = this.state.getSnapshot()
    if (active?.token !== current.token) return false
    this.state.set({ ...active, phase, ...(requestId === undefined ? {} : { requestId }) })
    return true
  }

  /** Clear and return the active edit only when it still matches the caller. */
  clear(current?: EditDraft): EditDraft | null {
    const active = this.state.getSnapshot()
    if (active === null || current !== undefined && active.token !== current.token) return null
    this.state.set(null)
    return active
  }
}
