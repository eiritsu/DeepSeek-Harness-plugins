/** Edit action offered only for the Host-projected latest eligible user message. */

import { useCallback } from 'react'
import { IconEditOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { EditResendSurface } from './edit-surface.ts'
import type { EditResendLocaleKey } from './locales.ts'
import css from './MessageEditAction.module.css'

/** Session-scoped Client services shared by the message row and composer overlay. */
export interface MessageEditActionInjected {
  readonly surface: EditResendSurface
}

type Props = PropsRuntime<'conversation.chat.user-actions'>
  & PropsLocale<'messageEditResend'>
  & MessageEditActionInjected

/** Render an edit affordance only when this row is the latest eligible user input. */
export function MessageEditAction({ messageId, seq, primaryText, surface, useProjection, useInput, inputActions, t }: Props) {
  const editable = useProjection('messageEditResend')
  const savedDraft = useInput(state => state.draft)
  const edit = editable?.messageId === messageId && Number(editable.seq) === seq
  const showEdited = edit && editable.edited
  const onEdit = useCallback(() => {
    if (!edit) return
    surface.begin({ messageId, seq: SessionSeq(seq) }, savedDraft)
    inputActions.setDraft(primaryText)
  }, [edit, inputActions, messageId, primaryText, savedDraft, seq, surface])

  if (!edit) return null
  return (
    <>
      {showEdited && <span className={css.edited}>{t('status.edited')}</span>}
      <Tooltip label={t('action.edit')} side="bottom">
        <button type="button" className={css.action} aria-label={t('action.edit')} onClick={onEdit}>
          <IconEditOutlineRegular />
        </button>
      </Tooltip>
    </>
  )
}

export type { EditResendLocaleKey }
