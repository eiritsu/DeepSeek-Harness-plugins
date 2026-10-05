// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScheduleId } from '@deepseek-ai/dsh-schedule/client'
import type { CalendarEntry, CalendarTask } from '../src/types.ts'
import type { CalendarViewItem } from '../src/client/calendar-model.ts'
import { EventDetail } from '../src/client/EventDetail.tsx'
import { MonthGrid } from '../src/client/MonthGrid.tsx'
import { TaskForm } from '../src/client/TaskForm.tsx'
import { maskUrl } from '../src/client/CalendarConfigPage.tsx'
import type { TaskFormSubmission } from '../src/client/TaskForm.tsx'

afterEach(cleanup)

/** Dictionary keys echo as their own copy, with template params appended for chip names. */
const t: TranslateNS<'calendar'> = (key, params) => {
  const title = params?.['title']
  return typeof title === 'string' ? `${key}:${title}` : key
}

function subscriptionItem(entry: CalendarEntry): CalendarViewItem {
  return {
    id: `entry:${entry.id}`, source: 'subscription', title: entry.title, date: entry.date,
    allDay: entry.allDay, recurring: entry.recurring, entry,
  }
}

function taskItem(task: CalendarTask): CalendarViewItem {
  return {
    id: `task:${task.id}`, source: 'task', title: task.record.title, date: '2026-10-06',
    startsAt: '2026-10-06T09:00:00.000Z', allDay: false, recurring: false, status: task.status,
    sessionId: task.sessionId, task,
  }
}

const task: CalendarTask = {
  id: 'task-1' as ScheduleId, sessionId: 's1', status: 'active',
  record: {
    id: 'task-1' as ScheduleId, kind: 'at', title: 'T', prompt: 'P',
    scheduledAt: '2026-10-06T09:00:00.000Z',
  },
}

describe('EventDetail source behavior', () => {
  it('renders a subscription entry read-only with no task actions', () => {
    const entry: CalendarEntry = { id: 'sub:1', origin: 'subscription', title: 'Feed event', allDay: true, recurring: false, date: '2026-10-06', startsAt: '2026-10-06T00:00:00.000Z' }
    render(<EventDetail item={subscriptionItem(entry)} locale="en-US" timeZone="UTC" sessionLabel={undefined} sessionSummary={undefined}
      sessionLive={false} t={t} onClose={() => {}} onOpenSession={() => {}} onEditTask={() => {}} onCancelTask={() => {}} />)
    expect(screen.getByText('detail.readonlyHint')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'detail.edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'detail.delete' })).toBeNull()
  })

  it('renders edit and cancel actions for a task', () => {
    render(<EventDetail item={taskItem(task)} locale="en-US" timeZone="UTC" sessionLabel="Session" sessionSummary="proj · last active"
      sessionLive t={t} onClose={() => {}} onOpenSession={() => {}} onEditTask={() => {}} onCancelTask={() => {}} />)
    expect(screen.getByRole('button', { name: 'detail.edit' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'detail.delete' })).toBeTruthy()
  })
})

describe('MonthGrid overflow', () => {
  it('renders three distinct chips plus a more control, each mapped to its own item', () => {
    const date = '2026-10-05'
    const titles = ['Alpha', 'Beta', 'Gamma', 'Delta']
    const items: CalendarViewItem[] = titles.map((title, index) => ({
      id: `item-${index}`, source: 'subscription', title, date, allDay: false, recurring: false,
      startsAt: `2026-10-05T0${index + 1}:00:00.000Z`,
    }))
    render(<MonthGrid year={2026} month={10} today={date} selectedDate={date} itemsByDate={new Map([[date, items]])}
      locale="en-US" timeZone="UTC" t={t} onSelectDate={() => {}} onOpenItem={() => {}} />)
    for (const title of ['Alpha', 'Beta', 'Gamma']) {
      expect(screen.getByRole('button', { name: `event.open:${title}` })).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: 'event.open:Delta' })).toBeNull()
    expect(screen.getByRole('button', { name: 'recent.more' })).toBeTruthy()
  })
})

describe('TaskForm native-rule preservation', () => {
  it('keeps an unsupported native rule and submits it unchanged', async () => {
    const onSubmit = vi.fn(async (_submission: TaskFormSubmission) => ({ ok: true } as const))
    render(<TaskForm mode="edit" sessions={[{ id: 's1', live: true, label: 'Session 1' }]} now="2026-10-05T08:00:00.000Z"
      defaultZone="UTC" initial={{ sessionId: 's1', title: 'T', prompt: 'P', zone: 'UTC', rule: { kind: 'keep', date: '', time: '09:00', weekdays: [], everyAmount: 1, everyUnit: 'hour' } }}
      t={t} onSubmit={onSubmit} onCancel={() => {}} />)
    expect(screen.getByText('create.keepHint')).toBeTruthy()
    expect(screen.queryByLabelText('create.rule')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'edit.save' }))
    await waitFor(() => { expect(onSubmit).toHaveBeenCalledTimes(1) })
    expect(onSubmit.mock.calls[0]?.[0].rule.kind).toBe('keep')
  })
})

describe('maskUrl', () => {
  it('removes a private query token before display', () => {
    expect(maskUrl('https://example.com/feed.ics?token=secret')).toBe('https://example.com/feed.ics')
    expect(maskUrl('https://example.com?token=secret')).toBe('https://example.com')
  })
})
