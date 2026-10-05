/** Event detail shown when a calendar item is opened. */
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CalendarTask } from '../types.ts'
import { formatDateTime } from './calendar-model.ts'
import type { CalendarViewItem } from './calendar-model.ts'
import { recordZone, ruleLabel, sourceLabelKey } from './labels.ts'
import css from './CalendarPage.module.css'

/** Props of the event-detail dialog. */
export interface EventDetailProps {
  readonly item: CalendarViewItem
  readonly locale: string
  readonly timeZone: string
  /** Display label of the item's Session; `undefined` when the Session is unknown. */
  readonly sessionLabel: string | undefined
  /** One-line Session metadata summary (working directory, last activity, or blank); `undefined` when unknown. */
  readonly sessionSummary: string | undefined
  /** Whether the linked Session is currently loaded in the Host. */
  readonly sessionLive: boolean
  readonly t: TranslateNS<'calendar'>
  readonly onClose: () => void
  readonly onOpenSession: (sessionId: string) => void
  readonly onEditTask: (task: CalendarTask) => void
  readonly onCancelTask: (task: CalendarTask) => void
}

/**
 * Render one item's full detail, read-only unless it is a task.
 * @param props - item, locale, and task actions.
 * @returns the detail dialog.
 */
export function EventDetail(props: EventDetailProps): ReactNode {
  const { item, locale, timeZone, sessionLabel, sessionSummary, sessionLive, t, onClose, onOpenSession, onEditTask, onCancelTask } = props
  const sessionId = item.sessionId
  const task = item.task
  const record = task?.record
  const zone = record === undefined ? timeZone : recordZone(record, timeZone)
  return (
    <Modal open onClose={onClose} title={item.title} closeLabel={t('detail.close')} className={css.detailDialog ?? ''}>
      <dl className={css.detailList}>
        <DetailRow label={t('detail.time')} value={timeText(item, locale, timeZone, t)} />
        <DetailRow label={t('detail.timezone')} value={zone} />
        <DetailRow label={t('detail.source')} value={t(sourceLabelKey(item))} />
        <DetailRow label={t('detail.rule')} value={record !== undefined ? ruleLabel(record, t, locale) : item.recurring ? t('detail.recurring') : t('rule.at')} />
        {item.status === undefined ? null : (
          <DetailRow label={t('detail.status')} value={item.status === 'active' ? t('detail.status.active') : t('detail.status.inactive')} />
        )}
        {item.location === undefined ? null : <DetailRow label={t('detail.location')} value={item.location} />}
        {sessionId === undefined || task === undefined ? null : (
          <div className={css.detailRow}>
            <dt>{t('detail.session')}</dt>
            <dd className={css.detailSession}>
              <span className={css.detailMono}>{sessionLabel ?? sessionId}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={sessionLabel === undefined}
                title={sessionLabel === undefined ? t('detail.sessionUnavailable') : t('detail.openSession')}
                onClick={() => { onOpenSession(sessionId) }}
              >
                {t('detail.openSession')}
              </Button>
              {sessionLabel === undefined
                ? <span className={css.detailHint}>{t('detail.sessionUnavailable')}</span>
                : sessionLive ? null : <span className={css.detailHint}>{t('detail.sessionDeferred')}</span>}
              {sessionSummary === undefined ? null : <span className={css.detailHint}>{sessionSummary}</span>}
            </dd>
          </div>
        )}
        {record === undefined ? null : (
          <>
            <DetailRow label={t('detail.prompt')} value={record.prompt.trim() === '' ? t('detail.noPrompt') : record.prompt} />
            {item.status !== 'active' ? null : (
              <DetailRow label={t('detail.next')} value={formatDateTime(record.scheduledAt, zone, locale)} />
            )}
            {task?.lastDelivery === undefined ? null : (
              <>
                <DetailRow label={t('detail.lastDelivery')} value={formatDateTime(task.lastDelivery.deliveredAt, zone, locale)} />
                <p className={css.detailNote}>{t('detail.deliveryNote')}</p>
              </>
            )}
            {task?.occurrenceError === undefined ? null : (
              <p className={css.detailWarn}>{t('detail.occurrenceError', { message: task.occurrenceError })}</p>
            )}
          </>
        )}
        {item.source === 'task' ? null : <p className={css.detailHint}>{t('detail.readonlyHint')}</p>}
      </dl>
      <div className={css.detailActions}>
        {task === undefined ? null : (
          <>
            <Button variant="outline" size="sm" onClick={() => { onEditTask(task) }}>{t('detail.edit')}</Button>
            <Button variant="outline" size="sm" className={css.dangerButton} onClick={() => { onCancelTask(task) }}>
              {t('detail.delete')}
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" onClick={onClose}>{t('detail.close')}</Button>
      </div>
    </Modal>
  )
}

function DetailRow({ label, value }: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div className={css.detailRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function timeText(item: CalendarViewItem, locale: string, timeZone: string, t: TranslateNS<'calendar'>): string {
  if (item.allDay || item.startsAt === undefined) return t('detail.allday')
  return formatDateTime(item.startsAt, timeZone, locale)
}
