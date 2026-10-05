import { describe, expect, it } from 'vitest'
import type { ScheduleId, ScheduleRecord } from '@deepseek-ai/dsh-schedule/client'
import type { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { CalendarEntry, CalendarSnapshot, CalendarTask } from '../src/types.ts'
import {
  buildViewItems, civilToInstant, dateKeyFromInstant, defaultRuleDraft, filterViewItems, formatClock,
  monthMatrix, monthRange, ruleDraftFromRecord, ruleDraftToChange, ruleDraftToSelector, sessionDirectory,
  shiftDateKey, upcomingItems, validateRuleDraft, type CalendarRuleDraft, type CalendarViewItem,
  type SessionVisibilityRow,
} from '../src/client/calendar-model.ts'

const id = (value: string): ScheduleId => value as ScheduleId

function snapshotOf(entries: readonly CalendarEntry[], timeZone: string): CalendarSnapshot {
  return {
    now: '2026-10-05T13:39:00.000Z',
    hostTimeZone: 'UTC',
    timeZone,
    range: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-20T00:00:00.000Z' },
    tasks: [],
    occurrences: [],
    occurrencesTruncated: false,
    entries,
    entriesTruncated: false,
    subscriptions: [],
    importedCalendars: [],
    selectableSessions: [],
    serviceAvailable: true,
  }
}

function item(partial: Partial<CalendarViewItem> & Pick<CalendarViewItem, 'id' | 'date'>): CalendarViewItem {
  return { source: 'subscription', title: partial.id, allDay: false, recurring: false, ...partial }
}

describe('month grid', () => {
  it('produces forty-two Monday-first cells with the month membership marked', () => {
    const cells = monthMatrix(2026, 10)
    expect(cells).toHaveLength(42)
    expect(cells[0]!.weekday).toBe(1)
    // 2026-10-01 is a Thursday, so the grid starts on Monday 2026-09-28.
    expect(cells[0]!.dateKey).toBe('2026-09-28')
    expect(cells[0]!.inMonth).toBe(false)
    expect(cells.filter(cell => cell.inMonth)).toHaveLength(31)
    expect(cells[41]!.dateKey).toBe('2026-11-08')
  })

  it('covers the whole grid in one accepted month range', () => {
    const range = monthRange(2026, 10, 'UTC')
    expect(range.start).toBe('2026-09-28T00:00:00.000Z')
    expect(range.end).toBe('2026-11-09T00:00:00.000Z')
  })

  it('shifts date keys across month and year boundaries', () => {
    expect(shiftDateKey('2026-12-31', 1)).toBe('2027-01-01')
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('zone-aware instants', () => {
  it('reads a display date in the requested zone', () => {
    expect(dateKeyFromInstant('2026-10-05T23:30:00.000Z', 'Asia/Shanghai')).toBe('2026-10-06')
    expect(dateKeyFromInstant('2026-10-05T23:30:00.000Z', 'UTC')).toBe('2026-10-05')
  })

  it('resolves the earlier ambiguous instant across a fall-back transition', () => {
    // 01:30 happens twice in America/New_York on 2026-11-01; the earlier is EDT (UTC-4).
    expect(civilToInstant('2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z')
  })

  it('resolves a spring-forward gap just after the gap', () => {
    // 02:30 does not exist in America/New_York on 2026-03-08.
    const instant = civilToInstant('2026-03-08', '02:30', 'America/New_York')
    expect(instant).toBe('2026-03-08T06:30:00.000Z')
    expect(dateKeyFromInstant(instant, 'America/New_York')).toBe('2026-03-08')
  })

  it('formats a Host instant as a wall-clock time in a zone', () => {
    expect(formatClock('2026-10-05T23:30:00.000Z', 'Asia/Shanghai', 'en-GB')).toBe('07:30')
  })
})

describe('entry projection', () => {
  it('trusts the Host-resolved display date for a timed entry', () => {
    const entry: CalendarEntry = {
      id: 'sub:1', origin: 'subscription', title: 'Late call', allDay: false, recurring: false,
      date: '2026-10-05', startsAt: '2026-10-05T23:30:00.000Z',
    }
    const [item] = buildViewItems(snapshotOf([entry], 'Asia/Shanghai'))
    expect(item!.date).toBe('2026-10-05')
  })

  it('keeps an all-day entry on its Host-resolved display date', () => {
    const entry: CalendarEntry = {
      id: 'sub:2', origin: 'import', title: 'Holiday', allDay: true, recurring: false,
      date: '2026-10-01', startsAt: '2026-10-01T00:00:00.000Z',
    }
    const [item] = buildViewItems(snapshotOf([entry], 'Asia/Shanghai'))
    expect(item!.date).toBe('2026-10-01')
  })
})

describe('upcoming list', () => {
  const now = '2026-10-05T10:00:00.000Z'

  it('includes an all-day entry dated today even after midnight', () => {
    const today = item({ id: 'all-day', date: '2026-10-05', allDay: true })
    expect(upcomingItems([today], now, 'UTC', 10)).toHaveLength(1)
  })

  it('drops a timed item already past and keeps a future one', () => {
    const past = item({ id: 'past', date: '2026-10-05', startsAt: '2026-10-05T09:00:00.000Z' })
    const future = item({ id: 'future', date: '2026-10-05', startsAt: '2026-10-05T11:00:00.000Z' })
    expect(upcomingItems([past, future], now, 'UTC', 10).map(entry => entry.id)).toEqual(['future'])
  })
})

describe('source filter', () => {
  const items: CalendarViewItem[] = [
    item({ id: 'task-recurring', date: '2026-10-05', source: 'task', recurring: true }),
    item({ id: 'task-once', date: '2026-10-05', source: 'task', recurring: false }),
    item({ id: 'sub', date: '2026-10-05', source: 'subscription' }),
    item({ id: 'import', date: '2026-10-05', source: 'import' }),
  ]

  it('separates recurring tasks, one-time tasks, and subscriptions', () => {
    expect(filterViewItems(items, 'task').map(entry => entry.id)).toEqual(['task-recurring'])
    expect(filterViewItems(items, 'once').map(entry => entry.id)).toEqual(['task-once'])
    expect(filterViewItems(items, 'subscription').map(entry => entry.id)).toEqual(['sub'])
    expect(filterViewItems(items, 'all')).toHaveLength(4)
  })
})

describe('default one-time draft', () => {
  it('rounds a past-the-hour clock up to the next whole hour, not tomorrow', () => {
    const draft = defaultRuleDraft('2026-10-05T13:39:00.000Z', 'UTC')
    expect(draft).toMatchObject({ kind: 'at', date: '2026-10-05', time: '15:00' })
  })

  it('rolls to the next day at 23:00 instead of producing a past 00:00', () => {
    const draft = defaultRuleDraft('2026-10-05T23:00:00.000Z', 'UTC')
    expect(draft).toMatchObject({ kind: 'at', date: '2026-10-06', time: '00:00' })
  })

  it('computes the target hour in the display zone', () => {
    // 23:30 UTC is 07:30 the next day in Asia/Shanghai.
    const draft = defaultRuleDraft('2026-10-05T23:30:00.000Z', 'Asia/Shanghai')
    expect(draft).toMatchObject({ kind: 'at', date: '2026-10-06', time: '09:00' })
  })
})

describe('rule drafts', () => {
  it('preserves a native cron rule instead of inventing a weekly one', () => {
    const cron: ScheduleRecord = { id: id('t'), kind: 'cron', title: 'Report', prompt: 'Report', expression: '0 9 * * 1-5', timeZone: 'Asia/Shanghai', scheduledAt: '2026-10-05T01:00:00.000Z' }
    const draft = ruleDraftFromRecord(cron, 'UTC')
    expect(draft.kind).toBe('keep')
    // `keep` sends no timing change, so a title edit never replaces the cron.
    expect(ruleDraftToChange(draft, 'UTC')).toBeUndefined()
    expect(ruleDraftToSelector(draft, 'UTC')).toBeUndefined()
    expect(validateRuleDraft(draft, 'UTC', '2026-10-05T00:00:00.000Z')).toBeUndefined()
  })

  it('maps a weekly record back into a weekly draft', () => {
    const weekly: ScheduleRecord = { id: id('w'), kind: 'weekly', title: 'Standup', prompt: 'Standup', time: '09:30:00.000', timeZone: 'Asia/Shanghai', weekdays: [1, 3], scheduledAt: '2026-10-05T01:30:00.000Z' }
    expect(ruleDraftFromRecord(weekly, 'UTC')).toMatchObject({ kind: 'weekly', time: '09:30', weekdays: [1, 3] })
  })

  it('validates future one-time targets and every intervals', () => {
    const past: CalendarRuleDraft = { kind: 'at', date: '2026-10-01', time: '09:00', weekdays: [], everyAmount: 1, everyUnit: 'hour' }
    expect(validateRuleDraft(past, 'UTC', '2026-10-05T00:00:00.000Z')).toBe('create.notFuture')
    const tooFast: CalendarRuleDraft = { kind: 'every', date: '', time: '09:00', weekdays: [], everyAmount: 30, everyUnit: 'second' }
    expect(validateRuleDraft(tooFast, 'UTC', '2026-10-05T00:00:00.000Z')).toBe('create.invalidInterval')
    const weeklyEmpty: CalendarRuleDraft = { kind: 'weekly', date: '', time: '09:00', weekdays: [], everyAmount: 1, everyUnit: 'hour' }
    expect(validateRuleDraft(weeklyEmpty, 'UTC', '2026-10-05T00:00:00.000Z')).toBe('create.invalidWeekdays')
  })
})

describe('projected display data', () => {
  it('keeps source, time, status, and delivery semantics across a non-UTC zone', () => {
    const activeRecord: ScheduleRecord = {
      id: 'task-active' as ScheduleId, kind: 'every', title: 'Active reminder', prompt: 'Active',
      everySeconds: 3600, scheduledAt: '2026-10-06T02:00:00.000Z',
    }
    const endedRecord: ScheduleRecord = {
      id: 'task-ended' as ScheduleId, kind: 'at', title: 'Ended reminder', prompt: 'Ended',
      scheduledAt: '2026-10-06T03:00:00.000Z',
    }
    const tasks: CalendarTask[] = [
      {
        id: activeRecord.id, sessionId: 'session-active', status: 'active', record: activeRecord,
        lastDelivery: {
          scheduledAt: activeRecord.scheduledAt, deliveredAt: '2026-10-06T02:00:04.000Z', messageId: 'msg-1' as MessageId,
        },
      },
      { id: endedRecord.id, sessionId: 'session-ended', status: 'inactive', record: endedRecord },
    ]
    const entries: CalendarEntry[] = [
      {
        id: 'sub:1', origin: 'subscription', title: 'All-day holiday', allDay: true, recurring: false,
        date: '2026-10-06', startsAt: '2026-10-06T00:00:00.000Z', color: '#4c8dff',
      },
      {
        id: 'imp:1', origin: 'import', title: 'Imported standup', allDay: false, recurring: true,
        date: '2026-10-06', startsAt: '2026-10-06T01:00:00.000Z',
      },
    ]
    const snapshot: CalendarSnapshot = {
      now: '2026-10-05T23:30:00.000Z', hostTimeZone: 'UTC', timeZone: 'Asia/Shanghai',
      range: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-20T00:00:00.000Z' },
      tasks,
      occurrences: [
        { taskId: activeRecord.id, sessionId: 'session-active', kind: 'every', title: activeRecord.title, startsAt: activeRecord.scheduledAt, status: 'active', recurring: true },
        { taskId: endedRecord.id, sessionId: 'session-ended', kind: 'at', title: endedRecord.title, startsAt: endedRecord.scheduledAt, status: 'inactive', recurring: false },
      ],
      occurrencesTruncated: false,
      entries,
      entriesTruncated: false,
      subscriptions: [],
      importedCalendars: [],
      selectableSessions: [],
      serviceAvailable: true,
    }
    const projected = buildViewItems(snapshot).map(item => ({
      source: item.source,
      title: item.title,
      date: item.date,
      startsAt: item.startsAt ?? null,
      allDay: item.allDay,
      recurring: item.recurring,
      status: item.status ?? null,
      sessionId: item.sessionId ?? null,
      lastDelivery: item.task?.lastDelivery?.deliveredAt ?? null,
    }))
    expect(projected).toMatchInlineSnapshot(`
      [
        {
          "allDay": true,
          "date": "2026-10-06",
          "lastDelivery": null,
          "recurring": false,
          "sessionId": null,
          "source": "subscription",
          "startsAt": "2026-10-06T00:00:00.000Z",
          "status": null,
          "title": "All-day holiday",
        },
        {
          "allDay": false,
          "date": "2026-10-06",
          "lastDelivery": null,
          "recurring": true,
          "sessionId": null,
          "source": "import",
          "startsAt": "2026-10-06T01:00:00.000Z",
          "status": null,
          "title": "Imported standup",
        },
        {
          "allDay": false,
          "date": "2026-10-06",
          "lastDelivery": "2026-10-06T02:00:04.000Z",
          "recurring": true,
          "sessionId": "session-active",
          "source": "task",
          "startsAt": "2026-10-06T02:00:00.000Z",
          "status": "active",
          "title": "Active reminder",
        },
        {
          "allDay": false,
          "date": "2026-10-06",
          "lastDelivery": null,
          "recurring": false,
          "sessionId": "session-ended",
          "source": "task",
          "startsAt": "2026-10-06T03:00:00.000Z",
          "status": "inactive",
          "title": "Ended reminder",
        },
      ]
    `)
  })
})

describe('session directory', () => {
  const row = (over: Partial<SessionVisibilityRow> & { id: string }): SessionVisibilityRow => ({
    displayTitle: over.id.toUpperCase(), blank: false, retainedBy: {}, ...over,
  })

  it('excludes subagent and archived sessions but keeps a cold ordinary one', () => {
    const directory = sessionDirectory([
      row({ id: 'cold' }),
      row({ id: 'sub', origin: 'subagent' }),
      row({ id: 'arch' }),
    ], new Set(['arch']))
    expect(directory.allowed).toEqual(['cold'])
    // Hidden rows still carry labels so an existing task's detail can name them.
    expect(directory.labels['arch']).toBe('ARCH')
    expect(directory.labels['sub']).toBe('SUB')
  })

  it('keeps the current blank session and drops other blank sessions', () => {
    const directory = sessionDirectory([
      row({ id: 'current', blank: true, retainedBy: { mainView: 2 } }),
      row({ id: 'other-blank', blank: true }),
    ], new Set())
    expect(directory.allowed).toEqual(['current'])
  })
})
