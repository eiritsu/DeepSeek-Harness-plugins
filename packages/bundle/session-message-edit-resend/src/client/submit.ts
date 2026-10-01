/** Effect-owned composer dispatcher for one edit-and-resend operation. */

import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SurfaceReplacementRequestId } from '@deepseek-ai/dsh-agent'
import type { ComposerSubmitDispatcher } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EditResendRequest, EditResendResult } from '../types.ts'
import type { EditResendLocaleKey } from './locales.ts'
import type { EditResendSurface } from './edit-surface.ts'

type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown }

/** Build the Client route while keeping the request id in Session-local state after transport loss. */
export function createEditResendDispatcher(
  surfaceFor: (sessionId: SessionId) => EditResendSurface,
  replace: (sessionId: SessionId, request: EditResendRequest) => Promise<RemoteResult<EditResendResult>>,
  t: (key: EditResendLocaleKey) => string,
): ComposerSubmitDispatcher {
  return async (submission) => {
    const surface = surfaceFor(submission.sessionId)
    const editing = surface.state.getSnapshot()
    if (editing === null) return undefined
    if (editing.phase === 'uncertain') return { kind: 'error', text: t('error.uncertain') }
    if (editing.phase === 'failed') return { kind: 'error', text: t('error.failed') }
    if (editing.phase === 'submitting') return { kind: 'error', text: t('status.submitting') }
    if (submission.attachmentIds.length > 0) return { kind: 'error', text: t('error.attachments') }
    if (submission.text.trim() === '') return { kind: 'error', text: t('error.empty') }
    if (submission.signal.aborted) return { kind: 'error', text: t('error.failed') }

    const request: EditResendRequest = {
      requestId: brandString<SurfaceReplacementRequestId>(randomUUID()),
      messageId: editing.messageId,
      seq: editing.seq,
      text: submission.text,
    }
    surface.update(editing, 'submitting', request.requestId)
    try {
      const carried = await replace(submission.sessionId, request)
      if (!carried.ok) throw new Error('edit-resend transport failed')
      if (carried.value.kind === 'completed') {
        surface.clear(editing)
        return { kind: 'success' }
      }
      if (carried.value.kind === 'uncertain') {
        surface.update(editing, 'uncertain')
        return { kind: 'error', text: t('error.uncertain') }
      }
      surface.update(editing, 'failed')
      return { kind: 'error', text: t('error.failed') }
    } catch {
      surface.update(editing, 'uncertain')
      return { kind: 'error', text: t('error.uncertain') }
    }
  }
}
