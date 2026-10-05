/** Calendar page: month/list view, source filters, detail, and appointment form. */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular, IconCloseOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CalendarSelectableSession, CalendarTask } from '../types.ts'
import {
  filterViewItems, groupByDate, upcomingItems, todayKey, ruleDraftFromRecord, formatDateTime,
  type CalendarFilter,
} from './calendar-model.ts'
import { recordZone } from './labels.ts'
import type { CalendarFace } from './controller.ts'
import type { CalendarKey } from './locales.ts'
import { EventDetail } from './EventDetail.tsx'
import { MonthGrid } from './MonthGrid.tsx'
import { RecentList } from './RecentList.tsx'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { TaskForm, type TaskFormSession, type TaskFormSubmission } from './TaskForm.tsx'
import css from './CalendarPage.module.css'

/** Renderer-bound props of the calendar main panel. */
export type CalendarPageProps = PropsRuntime<'main'> & PropsLocale<'calendar'> & InjectFace<CalendarFace>

const FILTERS: readonly CalendarFilter[] = ['all', 'task', 'once', 'subscription']
const FILTER_KEYS: Record<CalendarFilter, CalendarKey> = {
  all: 'filter.all', task: 'filter.task', once: 'filter.once', subscription: 'filter.subscription',
}
const UPCOMING_LIMIT = 12
const LIST_LIMIT = 200

/**
 * Render the calendar main panel.
 * @param props - injected face, localized strings, and the calendar store hook.
 * @returns the page.
 */
export function CalendarPage(props: CalendarPageProps): ReactNode {
  const { t, useCalendar, ...face } = props
  const state = useCalendar(snapshot => snapshot)
  const locale = t('time.locale')
  const zone = state.snapshotTimeZone || state.hostTimeZone
  const now = state.now || new Date().toISOString()
  const today = todayKey(now, zone)

  const visible = useMemo(() => filterViewItems(state.items, state.filter), [state.items, state.filter])
  const itemsByDate = useMemo(() => groupByDate(visible), [visible])
  const upcoming = useMemo(() => upcomingItems(visible, now, zone, UPCOMING_LIMIT), [visible, now, zone])
  const listItems = useMemo(() => upcomingItems(visible, now, zone, LIST_LIMIT), [visible, now, zone])
  const panelItems = state.selectedDate === today ? upcoming : (itemsByDate.get(state.selectedDate) ?? [])

  const [detailId, setDetailId] = useState<string>()
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; task?: CalendarTask }>()
  const [confirmTask, setConfirmTask] = useState<CalendarTask>()

  // The detail derives from the current snapshot so a refreshed task status or
  // a removed item never leaves a stale view open.
  const detail = detailId === undefined ? undefined : state.items.find(item => item.id === detailId)
  useEffect(() => {
    if (detailId !== undefined && detail === undefined) setDetailId(undefined)
  }, [detailId, detail])

  const formSessions = useMemo(() => formSessionsFor(state, form?.task), [state.selectableSessions, state.sessionLabels, form?.task])
  const sessionOf = (id: string | undefined): { label: string | undefined; live: boolean; summary: string | undefined } => {
    if (id === undefined) return { label: undefined, live: false, summary: undefined }
    const meta = state.selectableSessions.find(item => item.id === id)
    return {
      // A selectable Session is openable even when not live; fall back to its id
      // when the Session list has no title projection yet.
      label: state.sessionLabels[id] ?? meta?.id,
      live: meta?.live ?? false,
      summary: sessionSummary(meta, zone, locale, t),
    }
  }

  const submit = async (submission: TaskFormSubmission) => {
    const result = form?.mode === 'edit' && form.task !== undefined
      ? await face.updateTask({ ...submission, id: form.task.id, expected: form.task.record })
      : await face.createTask(submission)
    if (result.ok) setForm(undefined)
    return result
  }

  const empty = !state.loading && !state.errorKey && visible.length === 0
  return (
    <div className={css.page}>
      <header className={css.header}>
        <div className={css.heading}>
          <h1 className={css.title}>{t('page.title')}</h1>
          <p className={css.now} aria-live="polite">
            {state.now === '' ? null : (
              <>
                {t('header.serverTime', { time: formatDateTime(state.now, zone, locale), zone })}
                {state.hostTimeZone === zone ? null : ` · ${t('header.hostZone', { zone: state.hostTimeZone })}`}
              </>
            )}
          </p>
        </div>
        <div className={css.headingActions}>
          <Button
            variant="primary"
            className={css.primaryAction}
            onClick={() => { setForm({ mode: 'create' }) }}
            disabled={state.selectableSessions.length === 0}
          >
            <IconPlusOutlineRegular size={16} />{t('create.open')}
          </Button>
          <Button variant="ghost" onClick={() => { face.refresh() }} disabled={state.loading || state.refreshing} aria-label={t('refresh')} title={t('refresh')}>
            <IconRefreshOutlineRegular size={16} />
          </Button>
        </div>
      </header>

      <div className={css.toolbar}>
        <div className={css.viewSwitch} role="group" aria-label={t('view.label')}>
          <Pill
            className={css.toolbarPill}
            active={state.view === 'month'}
            aria-pressed={state.view === 'month'}
            onClick={() => { face.setView('month') }}
          >
            {t('view.month')}
          </Pill>
          <Pill
            className={css.toolbarPill}
            active={state.view === 'list'}
            aria-pressed={state.view === 'list'}
            onClick={() => { face.setView('list') }}
          >
            {t('view.list')}
          </Pill>
        </div>
        <div className={css.monthNav}>
          <Button variant="ghost" size="sm" aria-label={t('month.prev')} title={t('month.prev')} onClick={() => { face.stepMonth(-1) }} disabled={state.view !== 'month'}>
            <IconChevronLeftOutlineRegular size={16} />
          </Button>
          <span className={css.monthLabel}>{t('month.label', { year: state.year, month: state.month })}</span>
          <Button variant="outline" size="sm" onClick={() => { face.goToday() }}>{t('today')}</Button>
          <Button variant="ghost" size="sm" aria-label={t('month.next')} title={t('month.next')} onClick={() => { face.stepMonth(1) }} disabled={state.view !== 'month'}>
            <IconChevronRightOutlineRegular size={16} />
          </Button>
        </div>
        <div className={css.filters} role="group" aria-label={t('filter.label')}>
          {FILTERS.map(filter => (
            <Pill
              key={filter}
              className={css.toolbarPill}
              active={state.filter === filter}
              aria-pressed={state.filter === filter}
              onClick={() => { face.setFilter(filter) }}
            >
              {t(FILTER_KEYS[filter])}
            </Pill>
          ))}
        </div>
      </div>

      {state.feedback.key === undefined ? null : (
        <p className={state.feedback.ok === true ? css.notice : css.noticeError} role="status">
          {t(state.feedback.key)}
          {state.feedback.detail === undefined ? null : <span className={css.noticeDetail}> {state.feedback.detail}</span>}
          <button type="button" className={css.noticeDismiss} aria-label={t('notice.dismiss')} onClick={() => { face.clearFeedback() }}>
            <IconCloseOutlineRegular size={14} />
          </button>
        </p>
      )}
      {state.serviceAvailable ? null : <p className={css.noticeWarn} role="status">{t('service.unavailable')}</p>}
      {state.occurrencesTruncated ? <p className={css.noticeWarn} role="status">{t('truncated.occurrences')}</p> : null}
      {state.entriesTruncated ? <p className={css.noticeWarn} role="status">{t('truncated.entries')}</p> : null}
      {sourceDroppedTotal(state) > 0
        ? <p className={css.noticeWarn} role="status">{t('truncated.sources', { count: sourceDroppedTotal(state) })}</p>
        : null}

      <div className={css.body}>
        <section className={css.mainSurface} aria-busy={state.loading || state.refreshing}>
          {state.loading ? <p className={css.status} role="status">{t('loading')}</p> : null}
          {state.errorKey === undefined ? null : (
            <div className={css.errorBox} role="alert">
              <span>{t(state.errorKey)}</span>
              <Button variant="outline" size="sm" onClick={() => { face.refresh() }}>{t('retry')}</Button>
            </div>
          )}
          {state.loading || state.errorKey !== undefined ? null : state.view === 'month'
            ? (
              <MonthGrid
                year={state.year} month={state.month} today={today} selectedDate={state.selectedDate}
                itemsByDate={itemsByDate} locale={locale} timeZone={zone} t={t}
                onSelectDate={(dateKey) => { face.selectDate(dateKey) }}
                onOpenItem={(item) => { setDetailId(item.id) }}
              />
            )
            : (
              <RecentList items={listItems} today={today} locale={locale} timeZone={zone} t={t}
                onOpenItem={(item) => { setDetailId(item.id) }} />
            )}
          {empty ? <p className={css.status}>{t('empty')}</p> : null}
        </section>
        <aside className={css.sidePanel} aria-label={t('recent.title')}>
          <h2 className={css.sideTitle}>{t('recent.title')}</h2>
          {panelItems.length === 0 && state.selectedDate !== today
            ? <p className={css.listEmpty}>{t('empty.day')}</p>
            : (
              <RecentList items={panelItems} today={today} locale={locale} timeZone={zone} t={t}
                onOpenItem={(item) => { setDetailId(item.id) }} />
            )}
        </aside>
      </div>

      {detail === undefined ? null : (
        <EventDetail
          item={detail}
          locale={locale}
          timeZone={zone}
          sessionLabel={sessionOf(detail.sessionId).label}
          sessionSummary={sessionOf(detail.sessionId).summary}
          sessionLive={sessionOf(detail.sessionId).live}
          t={t}
          onClose={() => { setDetailId(undefined) }}
          onOpenSession={(id) => { face.onOpenSession(id) }}
          onEditTask={(task) => { setDetailId(undefined); setForm({ mode: 'edit', task }) }}
          onCancelTask={(task) => { setDetailId(undefined); setConfirmTask(task) }}
        />
      )}

      {form === undefined ? null : (
        <Modal open onClose={() => { setForm(undefined) }} title={t(form.mode === 'create' ? 'create.title' : 'edit.title')}
          headless className={css.formDialog ?? ''}>
          <TaskForm
            mode={form.mode}
            sessions={formSessions}
            now={now}
            defaultZone={zone}
            {...(form.task === undefined ? {} : {
              initial: {
                sessionId: form.task.sessionId,
                title: form.task.record.title,
                prompt: form.task.record.prompt,
                zone: recordZone(form.task.record, zone),
                rule: ruleDraftFromRecord(form.task.record, zone),
              },
            })}
            t={t}
            onSubmit={submit}
            onCancel={() => { setForm(undefined) }}
          />
        </Modal>
      )}

      {confirmTask === undefined ? null : (
        <ConfirmDialog
          title={t('delete.title')}
          description={t('delete.description')}
          confirmLabel={state.feedback.busy ? t('delete.pending') : t('delete.confirm')}
          cancelLabel={t('delete.cancel')}
          busy={state.feedback.busy}
          onConfirm={() => { void face.cancelTask(confirmTask).then((result) => { if (result.ok) setConfirmTask(undefined) }) }}
          onCancel={() => { setConfirmTask(undefined) }}
        />
      )}
    </div>
  )
}

interface DroppedSources {
  readonly subscriptions: readonly { readonly droppedEntryCount: number }[]
  readonly imported: readonly { readonly droppedEntryCount: number }[]
}

function sourceDroppedTotal(state: DroppedSources): number {
  return state.subscriptions.reduce((sum, item) => sum + item.droppedEntryCount, 0)
    + state.imported.reduce((sum, item) => sum + item.droppedEntryCount, 0)
}

function formSessionsFor(
  state: {
    readonly selectableSessions: readonly { id: string; live: boolean }[]
    readonly sessionLabels: Readonly<Record<string, string>>
  },
  task: CalendarTask | undefined,
): TaskFormSession[] {
  const sessions: TaskFormSession[] = state.selectableSessions.map(item => ({
    id: item.id, live: item.live, label: state.sessionLabels[item.id] ?? item.id,
  }))
  if (task !== undefined && !sessions.some(item => item.id === task.sessionId)) {
    sessions.unshift({ id: task.sessionId, live: false, label: state.sessionLabels[task.sessionId] ?? task.sessionId })
  }
  return sessions
}

/** One-line Session metadata for the detail dialog, or undefined when the Host indexed none. */
function sessionSummary(
  meta: CalendarSelectableSession | undefined, zone: string, locale: string, t: TranslateNS<'calendar'>,
): string | undefined {
  if (meta === undefined) return undefined
  const parts: string[] = []
  if (meta.blank) {
    parts.push(t('detail.sessionBlank'))
  } else {
    if (meta.cwd !== undefined && meta.cwd !== '') parts.push(basename(meta.cwd))
    if (meta.updatedAt > 0) {
      parts.push(t('detail.sessionUpdated', { time: formatDateTime(new Date(meta.updatedAt).toISOString(), zone, locale) }))
    }
  }
  return parts.length === 0 ? undefined : parts.join(' · ')
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/u).filter(part => part !== '')
  return parts[parts.length - 1] ?? path
}
