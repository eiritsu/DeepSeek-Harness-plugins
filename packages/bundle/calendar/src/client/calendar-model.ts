/**
 * Pure calendar math, formatting, view-item projection, and form validation.
 *
 * Nothing here touches React or Cordis. The display zone is always an explicit
 * parameter resolved from the Host snapshot (never a hardcoded zone), so the
 * same helpers work for a browser in any IANA zone and for a Host that runs in
 * another. Civil-date arithmetic runs in UTC so a month grid never shifts
 * through a daylight-saving transition; instant-to-wall-clock conversion uses
 * `Intl` for the requested zone.
 */
import type { CalendarEntry, CalendarOccurrence, CalendarSnapshot, CalendarSubscription, CalendarTask } from '../types.ts'
import type { ScheduleRecord, ScheduleTimingChange } from '@deepseek-ai/dsh-schedule/client'

/** Source buckets a user can filter the calendar by. */
export type CalendarFilter = 'all' | 'task' | 'once' | 'subscription'

/** Repeat-rule shapes the appointment form can author; `keep` preserves a native rule it cannot edit. */
export type CalendarRuleKind = 'at' | 'daily' | 'weekly' | 'every' | 'keep'

/** Editable draft of one repeat rule, in the user's chosen zone. */
export interface CalendarRuleDraft {
  readonly kind: CalendarRuleKind
  /** `YYYY-MM-DD`, one-time only. */
  readonly date: string
  /** `HH:mm`, wall clock in the draft zone. */
  readonly time: string
  /** ISO weekdays, Monday 1 through Sunday 7; weekly only. */
  readonly weekdays: readonly number[]
  /** Interval amount; every only. */
  readonly everyAmount: number
  /** Interval unit; every only. */
  readonly everyUnit: 'second' | 'minute' | 'hour'
}

/** One day cell of a month grid. */
export interface MonthCell {
  /** `YYYY-MM-DD` civil date. */
  readonly dateKey: string
  readonly day: number
  /** Whether the cell belongs to the displayed month. */
  readonly inMonth: boolean
  /** ISO weekday, Monday 1 through Sunday 7. */
  readonly weekday: number
}

/** One display-ready calendar item unified across the three sources. */
export interface CalendarViewItem {
  readonly id: string
  readonly source: 'task' | 'subscription' | 'import' | 'local'
  readonly title: string
  /** Display date `YYYY-MM-DD` in the snapshot zone. */
  readonly date: string
  readonly startsAt?: string
  readonly allDay: boolean
  readonly recurring: boolean
  readonly status?: 'active' | 'inactive'
  readonly sessionId?: string
  readonly color?: string
  readonly subscriptionId?: string
  readonly importedId?: string
  readonly location?: string
  readonly summary?: string
  readonly task?: CalendarTask
  readonly entry?: CalendarEntry
}

/** Error key returned by the appointment-form validators. */
export type CalendarFormErrorKey =
  | 'create.invalidTitle'
  | 'create.invalidPrompt'
  | 'create.invalidSession'
  | 'create.invalidDate'
  | 'create.invalidTime'
  | 'create.invalidTimezone'
  | 'create.invalidWeekdays'
  | 'create.invalidInterval'
  | 'create.notFuture'

/** The browser's own IANA zone, or `UTC` when the runtime reports none. */
export function browserTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return typeof zone === 'string' && zone !== '' ? zone : 'UTC'
}

/**
 * Check one IANA zone name through `Intl`.
 * @param zone - candidate zone.
 * @returns whether `Intl` accepts the zone.
 */
export function isValidTimeZone(zone: string): boolean {
  if (zone.trim() === '') return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)
  const read: Record<string, string> = {}
  for (const part of parts) read[part.type] = part.value
  return {
    year: Number(read['year']), month: Number(read['month']), day: Number(read['day']),
    hour: Number(read['hour']), minute: Number(read['minute']), second: Number(read['second']),
  }
}

/**
 * Offset of one zone at one instant, in whole minutes east of UTC.
 * @param timeZone - IANA zone name.
 * @param instant - instant to read the offset at.
 * @returns minutes the zone's wall clock is ahead of UTC at that instant.
 */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number {
  const read = wallClock(instant, timeZone)
  const wall = Date.UTC(read.year, read.month - 1, read.day, read.hour, read.minute, read.second)
  return (wall - instant.getTime()) / 60_000
}

/** Zero-pad one non-negative integer to at least two digits. */
function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Build `YYYY-MM-DD` from separate civil numbers (month 1-12). */
export function civilKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`
}

/** Convert a Sunday-based `getUTCDay` value to an ISO weekday (Monday 1). */
export function isoWeekday(sundayBased: number): number {
  return sundayBased === 0 ? 7 : sundayBased
}

/**
 * Display date of one instant in a zone.
 * @param instant - canonical UTC instant.
 * @param timeZone - display zone.
 * @returns `YYYY-MM-DD`.
 */
export function dateKeyFromInstant(instant: string, timeZone: string): string {
  const read = wallClock(new Date(instant), timeZone)
  return civilKey(read.year, read.month, read.day)
}

/**
 * Convert a civil date and wall-clock time in a zone to a canonical UTC instant.
 *
 * Around a daylight-saving transition the result is the earliest instant whose
 * zone wall clock matches; a spring-forward gap resolves just after the gap.
 * @param dateKey - `YYYY-MM-DD`.
 * @param time - `HH:mm`.
 * @param timeZone - IANA zone.
 * @returns canonical UTC instant.
 */
export function civilToInstant(dateKey: string, time: string, timeZone: string): string {
  const [year = 0, month = 1, day = 1] = dateKey.split('-').map(Number)
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0)
  const first = zoneOffsetMinutes(timeZone, new Date(guess))
  const candidate = guess - first * 60_000
  const second = zoneOffsetMinutes(timeZone, new Date(candidate))
  const resolved = second === first ? candidate : Math.min(candidate, guess - second * 60_000)
  return new Date(resolved).toISOString()
}

/**
 * Shift one civil date key by whole days, calendar-safe across month and year.
 * @param dateKey - `YYYY-MM-DD`.
 * @param days - signed day count.
 * @returns shifted `YYYY-MM-DD`.
 */
export function shiftDateKey(dateKey: string, days: number): string {
  const [year = 0, month = 1, day = 1] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return civilKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

/**
 * Today's display date in a zone.
 * @param nowIso - Host clock reading.
 * @param timeZone - display zone.
 * @returns `YYYY-MM-DD`.
 */
export function todayKey(nowIso: string, timeZone: string): string {
  return dateKeyFromInstant(nowIso, timeZone)
}

/**
 * Add signed months to a `{ year, month }` anchor, normalizing the month.
 * @param year - anchor year.
 * @param month - anchor month, 1-12.
 * @param delta - signed month count.
 * @returns normalized anchor.
 */
export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta
  return { year: Math.floor(total / 12), month: (total % 12 + 12) % 12 + 1 }
}

/**
 * Build the six-by-seven civil grid for one month, Monday-first.
 * @param year - displayed year.
 * @param month - displayed month, 1-12.
 * @returns forty-two day cells covering the month and its leading/trailing days.
 */
export function monthMatrix(year: number, month: number): MonthCell[] {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const lead = (isoWeekday(first.getUTCDay()) - 1 + 7) % 7
  const start = new Date(Date.UTC(year, month - 1, 1 - lead))
  const cells: MonthCell[] = []
  for (let index = 0; index < 42; index += 1) {
    const day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index))
    cells.push({
      dateKey: civilKey(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()),
      day: day.getUTCDate(),
      inMonth: day.getUTCMonth() + 1 === month && day.getUTCFullYear() === year,
      weekday: isoWeekday(day.getUTCDay()),
    })
  }
  return cells
}

/**
 * Half-open UTC range covering one month's full grid in a zone.
 * @param year - displayed year.
 * @param month - displayed month, 1-12.
 * @param timeZone - display zone.
 * @returns inclusive start and exclusive end as canonical UTC instants.
 */
export function monthRange(year: number, month: number, timeZone: string): { start: string; end: string } {
  const cells = monthMatrix(year, month)
  const first = cells[0]?.dateKey ?? civilKey(year, month, 1)
  const last = cells[cells.length - 1]?.dateKey ?? civilKey(year, month, 1)
  return { start: civilToInstant(first, '00:00', timeZone), end: civilToInstant(shiftDateKey(last, 1), '00:00', timeZone) }
}

/**
 * Half-open UTC range of the upcoming list view.
 * @param nowIso - Host clock reading.
 * @param timeZone - display zone.
 * @param days - whole days to cover; defaults to 42.
 * @returns inclusive start and exclusive end as canonical UTC instants.
 */
export function listRange(nowIso: string, timeZone: string, days = 42): { start: string; end: string } {
  const startKey = todayKey(nowIso, timeZone)
  return {
    start: civilToInstant(startKey, '00:00', timeZone),
    end: civilToInstant(shiftDateKey(startKey, days), '00:00', timeZone),
  }
}

/** Project one snapshot into unified display items, sorted for rendering. */
export function buildViewItems(snapshot: CalendarSnapshot): CalendarViewItem[] {
  const taskById = new Map<string, CalendarTask>()
  for (const task of snapshot.tasks) taskById.set(task.id, task)
  const items: CalendarViewItem[] = []
  for (const occurrence of snapshot.occurrences) {
    items.push(occurrenceItem(occurrence, taskById.get(occurrence.taskId), snapshot.timeZone))
  }
  for (const entry of snapshot.entries) items.push(entryItem(entry))
  return items.sort(compareItems)
}

function occurrenceItem(occurrence: CalendarOccurrence, task: CalendarTask | undefined, timeZone: string): CalendarViewItem {
  return {
    id: `task:${occurrence.taskId}:${occurrence.startsAt}`,
    source: 'task',
    title: occurrence.title,
    date: dateKeyFromInstant(occurrence.startsAt, timeZone),
    startsAt: occurrence.startsAt,
    allDay: false,
    recurring: occurrence.recurring,
    status: occurrence.status,
    sessionId: occurrence.sessionId,
    ...(task === undefined ? {} : { task }),
  }
}

function entryItem(entry: CalendarEntry): CalendarViewItem {
  // The Host resolves `date` in the snapshot zone for every entry, including a
  // timed one, so the display date is trusted rather than recomputed.
  return {
    id: `entry:${entry.id}`,
    source: entry.origin,
    title: entry.title,
    date: entry.date,
    startsAt: entry.startsAt,
    allDay: entry.allDay,
    recurring: entry.recurring,
    ...(entry.color === undefined ? {} : { color: entry.color }),
    ...(entry.subscriptionId === undefined ? {} : { subscriptionId: entry.subscriptionId }),
    ...(entry.importedId === undefined ? {} : { importedId: entry.importedId }),
    ...(entry.location === undefined ? {} : { location: entry.location }),
    ...(entry.summary === undefined ? {} : { summary: entry.summary }),
    entry,
  }
}

function compareItems(left: CalendarViewItem, right: CalendarViewItem): number {
  if (left.date !== right.date) return left.date < right.date ? -1 : 1
  if (left.allDay !== right.allDay) return left.allDay ? -1 : 1
  const leftStart = left.startsAt ?? ''
  const rightStart = right.startsAt ?? ''
  if (leftStart !== rightStart) return leftStart < rightStart ? -1 : 1
  return left.title.localeCompare(right.title)
}

/** Keep only the items matching one source filter. */
export function filterViewItems(items: readonly CalendarViewItem[], filter: CalendarFilter): CalendarViewItem[] {
  switch (filter) {
    case 'all': return [...items]
    case 'task': return items.filter(item => item.source === 'task' && item.recurring)
    case 'once': return items.filter(item => item.source === 'task' && !item.recurring)
    case 'subscription': return items.filter(item => item.source === 'subscription')
  }
}

/** Bucket items by their display date. */
export function groupByDate(items: readonly CalendarViewItem[]): Map<string, CalendarViewItem[]> {
  const byDate = new Map<string, CalendarViewItem[]>()
  for (const item of items) {
    const bucket = byDate.get(item.date)
    if (bucket === undefined) byDate.set(item.date, [item])
    else bucket.push(item)
  }
  return byDate
}

/**
 * Upcoming items from one Host clock reading, today's all-day entries first.
 * @param items - display items.
 * @param nowIso - Host clock reading.
 * @param timeZone - display zone.
 * @param limit - maximum returned items.
 * @returns ascending items starting no earlier than today.
 */
export function upcomingItems(
  items: readonly CalendarViewItem[], nowIso: string, timeZone: string, limit: number,
): CalendarViewItem[] {
  const today = todayKey(nowIso, timeZone)
  return items
    .filter(item => item.allDay || item.startsAt === undefined
      ? item.date >= today
      : item.startsAt >= nowIso)
    .sort(compareItems)
    .slice(0, limit)
}

/** Format one instant as a short wall-clock time in a zone. */
export function formatClock(instant: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(instant))
}

/** Format one instant as a localized date and time in a zone. */
export function formatDateTime(instant: string, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(instant))
}

/** Format one civil date key as a localized date without a zone shift. */
export function formatDateKey(dateKey: string, locale: string): string {
  const [year = 0, month = 1, day = 1] = dateKey.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(year, month - 1, day)))
}

/** Format a list of ISO weekdays with the locale's list separator. */
export function formatWeekdays(weekdays: readonly number[], locale: string, label: (weekday: number) => string): string {
  const names = [...weekdays].sort((a, b) => a - b).map(label)
  return new Intl.ListFormat(locale, { style: 'short', type: 'conjunction' }).format(names)
}

/**
 * Break a fixed-rate interval into a display amount and a localized unit.
 * @param seconds - interval in seconds.
 * @param unitLabel - localized unit label factory.
 * @returns the display amount and its unit label.
 */
export function formatInterval(seconds: number, unitLabel: (unit: 'minute' | 'hour' | 'second') => string): { value: string; unit: string } {
  if (seconds % 3600 === 0) return { value: String(seconds / 3600), unit: unitLabel('hour') }
  if (seconds % 60 === 0) return { value: String(seconds / 60), unit: unitLabel('minute') }
  return { value: String(seconds), unit: unitLabel('second') }
}

/** Next trigger instant of one stored record. */
export function recordNextTrigger(record: ScheduleRecord): string {
  return record.scheduledAt
}

/** Explicit zone of one record, when the record kind stores one. */
export function recordTimeZone(record: ScheduleRecord): string | undefined {
  return 'timeZone' in record ? record.timeZone : undefined
}

/** Convert a stored record into the form's editable rule draft. */
export function ruleDraftFromRecord(record: ScheduleRecord, fallbackZone: string): CalendarRuleDraft {
  const zone = recordTimeZone(record) ?? fallbackZone
  switch (record.kind) {
    case 'after':
    case 'at': {
      const date = dateKeyFromInstant(record.scheduledAt, zone)
      const time = formatClock(record.scheduledAt, zone, 'en-GB')
      return { kind: 'at', date, time, weekdays: [], everyAmount: 1, everyUnit: 'hour' }
    }
    case 'daily':
      return { kind: 'daily', date: '', time: record.time.slice(0, 5), weekdays: [], everyAmount: 1, everyUnit: 'hour' }
    case 'weekly':
      return { kind: 'weekly', date: '', time: record.time.slice(0, 5), weekdays: record.weekdays, everyAmount: 1, everyUnit: 'hour' }
    case 'every':
      return everyDraft(record.everySeconds)
    case 'cron':
      // Phase 1 has no cron editor: preserving the native rule lets a title or
      // instruction edit proceed without replacing the stored schedule.
      return { kind: 'keep', date: '', time: '09:00', weekdays: [], everyAmount: 1, everyUnit: 'hour' }
  }
}

function everyDraft(seconds: number): CalendarRuleDraft {
  if (seconds % 3600 === 0) return { kind: 'every', date: '', time: '09:00', weekdays: [], everyAmount: seconds / 3600, everyUnit: 'hour' }
  if (seconds % 60 === 0) return { kind: 'every', date: '', time: '09:00', weekdays: [], everyAmount: seconds / 60, everyUnit: 'minute' }
  return { kind: 'every', date: '', time: '09:00', weekdays: [], everyAmount: seconds, everyUnit: 'second' }
}

/** Whole seconds represented by an every-draft. */
export function everyDraftSeconds(draft: CalendarRuleDraft): number {
  const factor = draft.everyUnit === 'hour' ? 3600 : draft.everyUnit === 'minute' ? 60 : 1
  return Math.round(draft.everyAmount) * factor
}

/** Validate a title against the task-name bound. */
export function validateTitle(title: string): CalendarFormErrorKey | undefined {
  const trimmed = title.trim()
  if (trimmed === '' || trimmed.length > 120) return 'create.invalidTitle'
  return undefined
}

/** Validate an instruction against the prompt bound. */
export function validatePrompt(prompt: string): CalendarFormErrorKey | undefined {
  const trimmed = prompt.trim()
  if (trimmed === '' || trimmed.length > 4_000) return 'create.invalidPrompt'
  return undefined
}

/**
 * Validate one rule draft against the zone and the Host clock.
 * @param draft - the editable rule.
 * @param zone - draft zone, already checked separately.
 * @param nowIso - Host clock reading used for the future check.
 * @returns the form error key, or undefined when valid.
 */
export function validateRuleDraft(draft: CalendarRuleDraft, zone: string, nowIso: string): CalendarFormErrorKey | undefined {
  if (draft.kind === 'keep') return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(draft.date) && draft.kind === 'at') return 'create.invalidDate'
  if (!/^\d{2}:\d{2}$/u.test(draft.time)) return 'create.invalidTime'
  switch (draft.kind) {
    case 'at': {
      if (!isValidTimeZone(zone)) return 'create.invalidTimezone'
      if (Date.parse(civilToInstant(draft.date, draft.time, zone)) <= Date.parse(nowIso)) return 'create.notFuture'
      return undefined
    }
    case 'daily':
      return isValidTimeZone(zone) ? undefined : 'create.invalidTimezone'
    case 'weekly': {
      if (!isValidTimeZone(zone)) return 'create.invalidTimezone'
      return draft.weekdays.length === 0 ? 'create.invalidWeekdays' : undefined
    }
    case 'every':
      return everyDraftSeconds(draft) < 60 ? 'create.invalidInterval' : undefined
  }
}

/** Selector fields for one create request; `undefined` when the rule is preserved. */
export type CalendarRuleSelector =
  | { readonly at: { readonly date: string; readonly time: string; readonly time_zone: string } }
  | { readonly daily: { readonly time: string; readonly time_zone: string } }
  | { readonly weekly: { readonly time: string; readonly time_zone: string; readonly weekdays: number[] } }
  | { readonly every_seconds: number }

/**
 * Convert a validated rule draft into a Schedule timing change.
 * @returns the timing change, or undefined for `keep` (a native rule the form leaves untouched).
 */
export function ruleDraftToChange(draft: CalendarRuleDraft, zone: string): ScheduleTimingChange | undefined {
  switch (draft.kind) {
    case 'at':
      return { kind: 'at', at: { date: draft.date, time: `${draft.time}:00`, time_zone: zone } }
    case 'daily':
      return { kind: 'daily', daily: { time: `${draft.time}:00`, time_zone: zone } }
    case 'weekly':
      return { kind: 'weekly', weekly: { time: `${draft.time}:00`, time_zone: zone, weekdays: [...draft.weekdays].sort((a, b) => a - b) } }
    case 'every':
      return { kind: 'every', every_seconds: everyDraftSeconds(draft) }
    case 'keep':
      return undefined
  }
}

/**
 * Convert a validated rule draft into the create request's selector fields.
 * @returns exactly one selector member, or undefined for `keep` (never valid on create).
 */
export function ruleDraftToSelector(draft: CalendarRuleDraft, zone: string): CalendarRuleSelector | undefined {
  switch (draft.kind) {
    case 'at': return { at: { date: draft.date, time: `${draft.time}:00`, time_zone: zone } }
    case 'daily': return { daily: { time: `${draft.time}:00`, time_zone: zone } }
    case 'weekly': return { weekly: { time: `${draft.time}:00`, time_zone: zone, weekdays: [...draft.weekdays].sort((a, b) => a - b) } }
    case 'every': return { every_seconds: everyDraftSeconds(draft) }
    case 'keep': return undefined
  }
}

/**
 * Default one-time draft at least one hour ahead, rounded up to a whole hour in
 * the display zone. A wall clock already past :00 therefore lands on the next
 * day rather than in the past.
 * @param nowIso - Host clock reading.
 * @param zone - display zone.
 * @returns a future one-time draft.
 */
export function defaultRuleDraft(nowIso: string, zone: string): CalendarRuleDraft {
  const date = todayKey(nowIso, zone)
  const wall = formatClock(nowIso, zone, 'en-GB')
  const [hour = 0, minute = 0] = wall.split(':').map(Number)
  const target = Math.ceil((hour * 60 + minute + 60) / 60) * 60
  const dayOffset = Math.floor(target / 1440)
  const targetHour = Math.floor((target % 1440) / 60)
  return {
    kind: 'at',
    date: shiftDateKey(date, dayOffset),
    time: `${pad(targetHour)}:00`,
    weekdays: [],
    everyAmount: 1,
    everyUnit: 'hour',
  }
}

/** Build a stable display color for one subscription from its identity. */
export function subscriptionColor(id: string): string {
  const palette = ['#4c8dff', '#22a06b', '#c26dff', '#e08b1f', '#e05b78', '#1f9bb5', '#8a7dff', '#7a9a2f']
  let hash = 0
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  return palette[hash % palette.length] ?? '#4c8dff'
}

/** Index subscriptions by identity for quick lookup. */
export function subscriptionIndex(subscriptions: readonly CalendarSubscription[]): Map<string, CalendarSubscription> {
  return new Map(subscriptions.map(subscription => [subscription.id, subscription]))
}

/** One Client Session row's visibility-relevant fields from the Session list projection. */
export interface SessionVisibilityRow {
  readonly id: string
  readonly displayTitle: string
  readonly blank: boolean
  /** Coarse durable origin; a subagent Session is never an automation target. */
  readonly origin?: 'subagent'
  /** Local ownership counts; the current blank Session is the row retained by the main view. */
  readonly retainedBy: { readonly mainView?: number }
}

/** Selectable Session ids plus their display labels. */
export interface SessionDirectory {
  readonly labels: Record<string, string>
  readonly allowed: string[]
}

/**
 * Build the automation target directory the way the Workspace browser decides
 * Session visibility: ordinary Sessions are selectable, only the current blank
 * Session counts (the row retained by the main view), and subagent children and
 * archived Sessions are excluded. Cold ordinary Sessions stay selectable
 * because the Host restores them when a reminder is due.
 * @param rows - Client Session summary rows.
 * @param archived - Session ids the user archived.
 * @returns the display labels and the selectable id list.
 */
export function sessionDirectory(rows: readonly SessionVisibilityRow[], archived: ReadonlySet<string>): SessionDirectory {
  const current = rows.find(row => (row.retainedBy.mainView ?? 0) > 0)?.id
  const labels: Record<string, string> = {}
  const allowed: string[] = []
  for (const row of rows) {
    labels[row.id] = row.displayTitle
    if (row.origin === 'subagent') continue
    if (row.blank && row.id !== current) continue
    if (archived.has(row.id)) continue
    allowed.push(row.id)
  }
  return { labels, allowed }
}
