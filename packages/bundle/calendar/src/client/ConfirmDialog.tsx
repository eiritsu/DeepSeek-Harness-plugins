/** Standard two-button confirmation dialog. */
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './CalendarPage.module.css'

/** Props of the confirmation dialog. */
export interface ConfirmDialogProps {
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly cancelLabel: string
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * Render one confirmation gate over a modal layer.
 * @param props - copy and the two outcomes.
 * @returns the confirmation dialog.
 */
export function ConfirmDialog(props: ConfirmDialogProps): ReactNode {
  const { title, description, confirmLabel, cancelLabel, busy, onConfirm, onCancel } = props
  return (
    <Modal open onClose={() => { if (!busy) onCancel() }} title={title} closeLabel={cancelLabel} className={css.confirmDialog ?? ''}>
      <p className={css.confirmText}>{description}</p>
      <div className={css.formActions}>
        <Button variant="outline" className={css.dangerButton} onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
        <Button variant="outline" className={css.dangerButton} onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}
