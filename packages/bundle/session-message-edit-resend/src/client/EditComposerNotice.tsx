/** Session-scoped edit status and cancellation inside the official composer. */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { EditResendStatus } from '../types.ts'
import type { EditResendSurface } from './edit-surface.ts'
import css from './EditComposerNotice.module.css'

/** Session-scoped Client services shared by the message row and composer overlay. */
export interface EditComposerNoticeInjected {
  readonly surface: EditResendSurface
  readonly loadLatestStatus: () => Promise<EditResendStatus | undefined>
  readonly readStatus: (requestId: EditResendStatus['requestId']) => Promise<EditResendStatus | undefined>
}

type Props = PropsRuntime<'conversation.input.overlay'>
  & PropsLocale<'messageEditResend'>
  & EditComposerNoticeInjected

/** Show the current edit state and restore the saved draft when cancelled or unmounted. */
export function EditComposerNotice({ surface, loadLatestStatus, readStatus, inputActions, t }: Props) {
  const state = useSyncExternalStore(
    listener => surface.state.subscribe(listener),
    () => surface.state.getSnapshot(),
    () => surface.state.getSnapshot(),
  )
  const [recoveredUncertain, setRecoveredUncertain] = useState(false)

  useEffect(() => {
    let active = true
    void loadLatestStatus().then((status) => {
      if (active && status?.recovery === 'uncertain') setRecoveredUncertain(true)
    }).catch(() => undefined)
    return () => { active = false }
  }, [surface])

  useEffect(() => {
    if (state?.phase !== 'uncertain' || state.requestId === undefined) return
    let active = true
    void readStatus(state.requestId).then((status) => {
      if (!active || status?.recovery !== 'settled') return
      if (status.outcome === 'completed') surface.clear(state)
      else surface.update(state, 'failed')
    }).catch(() => undefined)
    return () => { active = false }
  }, [readStatus, state, surface])

  useEffect(() => () => {
    const active = surface.clear()
    if (active !== null) inputActions.setDraft(active.savedDraft)
  }, [inputActions, surface])

  if (state === null && !recoveredUncertain) return null
  if (state === null) return <div className={css.notice} role="status">{t('status.recoveredUncertain')}</div>
  const cancel = (): void => {
    const active = surface.clear(state)
    if (active !== null) inputActions.setDraft(active.savedDraft)
  }
  const label = state.phase === 'submitting' ? t('status.submitting')
    : state.phase === 'uncertain' ? t('status.uncertain')
      : state.phase === 'failed' ? t('status.failed') : t('status.editing')

  return (
    <div className={css.notice} role="status">
      <span>{label}</span>
      <Button size="sm" variant="ghost" disabled={state.phase === 'submitting'} onClick={cancel}>
        {t('action.cancel')}
      </Button>
    </div>
  )
}
