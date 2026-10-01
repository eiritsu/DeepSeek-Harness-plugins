/** Menu item for copying the Session identity delivered by its scope. */
import { useState } from 'react'
import {
  IconCheckOutlineRegular, IconCopyOutlineRegular, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CopySessionIdAction.module.css'

/** Complete props for the Session-header utility. */
export type CopySessionIdActionProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<'copySessionId'>

/** Copy the exact Session identity and report the clipboard result. */
export function CopySessionIdAction({ sessionId, t }: CopySessionIdActionProps) {
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const label = t(state === 'copied' ? 'action.copied'
    : state === 'failed' ? 'action.copyFailed'
      : state === 'copying' ? 'action.copying' : 'action.copy')

  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        className={css.trigger}
        aria-label={label}
        disabled={state === 'copying'}
        onClick={() => {
          setState('copying')
          void writeClipboard(sessionId).then((ok) => { setState(ok ? 'copied' : 'failed') })
        }}
      >
        {state === 'copied' ? <IconCheckOutlineRegular size={16} /> : <IconCopyOutlineRegular size={16} />}
        <span className={css.status} aria-live="polite">{label}</span>
      </button>
    </Tooltip>
  )
}
