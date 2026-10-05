/** Stored entry reads, local entry writes, and range resolution. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type {
  CalendarDeleteEntryResult,
  CalendarEntry,
  CalendarEntryId as CalendarEntryIdType,
  CalendarEntryMutationResult,
  CalendarSaveEntryRequest,
} from './types.ts'
import type { EntryRecord } from './storage.ts'
import { calendarDomain } from './storage.ts'
import { dateInZone, isCivilDate } from './clock.ts'

/** Longest accepted local entry title, in characters. */
const MAX_ENTRY_TITLE = 200

/** Milliseconds in one calendar day, used to bound a whole-day entry's window. */
const DAY_MS = 86_400_000

/** Result of resolving stored entries into one requested range. */
export interface ResolvedEntries {
  readonly entries: CalendarEntry[]
  /** True when the configured entry ceiling stopped the resolution. */
  readonly truncated: boolean
}

/**
 * Read every stored entry that intersects a range, in display order.
 *
 * A whole-day entry is selected by the civil dates it covers in the requested
 * zone, so an October view in a zone behind UTC still shows its own October
 * days instead of the neighbouring ones a UTC-midnight comparison would pick.
 * A timed entry is selected by its instants, and an entry with no declared
 * duration is a point in time that belongs to the range when its start does.
 * @param domain - Open calendar domain.
 * @param from - Inclusive lower edge as epoch milliseconds.
 * @param to - Exclusive upper edge as epoch milliseconds.
 * @param zone - Zone the request renders civil dates in.
 * @param limit - Largest accepted number of entries.
 * @returns the entries inside the range and whether the ceiling stopped them.
 */
export function resolveEntries(
  domain: Domain<typeof calendarDomain>,
  from: number,
  to: number,
  zone: string,
  limit: number,
): ResolvedEntries {
  const firstDate = dateInZone(from, zone)
  const lastDate = dateInZone(to - 1, zone)
  const matched: CalendarEntry[] = []
  let truncated = false
  for (const [key, record] of domain.table('entries').entries()) {
    if (!intersects(record, from, to, firstDate, lastDate)) continue
    if (matched.length >= limit) { truncated = true; continue }
    matched.push(toEntry(key, record))
  }
  matched.sort((left, right) => left.date.localeCompare(right.date)
    || left.startsAt.localeCompare(right.startsAt)
    || left.id.localeCompare(right.id))
  return { entries: matched, truncated }
}

/**
 * Whether one stored entry belongs to a range.
 * @param record - Stored entry row.
 * @param from - Inclusive lower edge as epoch milliseconds.
 * @param to - Exclusive upper edge as epoch milliseconds.
 * @param firstDate - Civil date the range starts on, in the requested zone.
 * @param lastDate - Civil date the range's last instant falls on.
 * @returns whether the entry belongs to the range.
 */
function intersects(record: EntryRecord, from: number, to: number, firstDate: string, lastDate: string): boolean {
  if (record.allDay) return record.date >= firstDate && record.date <= lastDate
  const start = Date.parse(record.startsAt)
  const end = record.endsAt === undefined ? start : Date.parse(record.endsAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  // A zero-length interval overlaps nothing under half-open rules, so an entry
  // with no declared end is treated as the point in time it starts at.
  if (end === start) return start >= from && start < to
  return end > from && start < to
}

/**
 * Project one stored row into the value a Client renders.
 * @param key - Table key, which is the entry identity.
 * @param record - Stored entry row.
 * @returns the Client-facing entry.
 */
function toEntry(key: string, record: EntryRecord): CalendarEntry {
  return {
    id: key,
    origin: record.origin,
    ...(record.subscriptionId === undefined ? {} : { subscriptionId: record.subscriptionId }),
    ...(record.importedId === undefined ? {} : { importedId: record.importedId }),
    ...(record.color === undefined ? {} : { color: record.color }),
    title: record.title,
    ...(record.summary === undefined ? {} : { summary: record.summary }),
    ...(record.location === undefined ? {} : { location: record.location }),
    allDay: record.allDay,
    date: record.date,
    startsAt: record.startsAt,
    ...(record.endsAt === undefined ? {} : { endsAt: record.endsAt }),
    recurring: record.recurring,
  }
}

/**
 * Validate and store one local entry.
 *
 * A request carrying an `id` edits that entry and nothing else: an entry owned
 * by a subscription or an import is read-only, and an unknown id is reported
 * rather than silently created, so a stale Client cannot turn a source entry
 * into a local one.
 * @param domain - Open calendar domain.
 * @param request - Entry the Client supplied.
 * @param now - Canonical UTC instant to stamp the row with.
 * @param zone - Zone an all-day entry's display date is validated against.
 * @returns the committed entry, or the reason the request was rejected.
 */
export async function saveLocalEntry(
  domain: Domain<typeof calendarDomain>,
  request: CalendarSaveEntryRequest,
  now: string,
  zone: string,
): Promise<CalendarEntryMutationResult> {
  const title = typeof request.title === 'string' ? request.title.trim() : ''
  if (title === '' || title.length > MAX_ENTRY_TITLE) {
    return { ok: false, code: 'invalid-title', message: `A local entry needs a title of 1 to ${MAX_ENTRY_TITLE} characters.` }
  }
  if (request.id !== undefined) {
    const existing = domain.table('entries').get(request.id)
    if (existing === undefined) {
      return { ok: false, code: 'not-found', message: 'That calendar entry no longer exists.' }
    }
    if (existing.origin !== 'local') {
      return { ok: false, code: 'readonly', message: 'This entry comes from a calendar source and cannot be edited on its own.' }
    }
  }
  const window = entryWindow(request, zone)
  if ('code' in window) return window
  const id = request.id ?? brandString<CalendarEntryIdType>(`local-${randomUUID()}`)
  const record: EntryRecord = {
    origin: 'local',
    title,
    ...(typeof request.summary === 'string' && request.summary !== '' ? { summary: request.summary.slice(0, 4_000) } : {}),
    ...(typeof request.location === 'string' && request.location !== '' ? { location: request.location.slice(0, 500) } : {}),
    allDay:  request.allDay,
    date: window.date,
    startsAt: window.startsAt,
    ...(window.endsAt === undefined ? {} : { endsAt: window.endsAt }),
    recurring: false,
    storedAt: now,
  }
  await domain.table('entries').put(id, record)
  return { ok: true, entry: toEntry(id, record) }
}

/** Normalized window of one local entry request. */
type EntryWindow =
  | { readonly date: string; readonly startsAt: string; readonly endsAt?: string }
  | { readonly ok: false; readonly code: 'invalid-time' | 'invalid-range'; readonly message: string }

/**
 * Validate one entry's date and instants, filling in the whole-day window an
 * all-day entry implies.
 * @param request - Entry the Client supplied.
 * @param zone - Zone an all-day entry's display date is validated against.
 * @returns the normalized window, or the reason the request was rejected.
 */
function entryWindow(request: CalendarSaveEntryRequest, zone: string): EntryWindow {
  if (request.allDay) {
    const date = typeof request.date === 'string' ? request.date.trim() : ''
    if (!isCivilDate(date)) {
      return { ok: false, code: 'invalid-time', message: 'A whole-day entry needs a real date as YYYY-MM-DD.' }
    }
    if (request.startsAt !== undefined) {
      return { ok: false, code: 'invalid-time', message: 'A whole-day entry takes a date and rejects a start instant.' }
    }
    const startsAt = `${date}T00:00:00.000Z`
    const endsAt = new Date(Date.parse(startsAt) + DAY_MS).toISOString()
    return { date, startsAt, endsAt }
  }
  if (request.date !== undefined) {
    return { ok: false, code: 'invalid-time', message: 'A timed entry takes a start instant and rejects a whole-day date.' }
  }
  const startsAt = typeof request.startsAt === 'string' ? request.startsAt : ''
  const start = Date.parse(startsAt)
  if (!Number.isFinite(start)) {
    return { ok: false, code: 'invalid-time', message: 'A timed entry needs a start instant as a UTC calendar instant.' }
  }
  if (request.endsAt === undefined) return { date: dateInZone(start, zone), startsAt }
  const end = Date.parse(request.endsAt)
  if (!Number.isFinite(end)) {
    return { ok: false, code: 'invalid-time', message: 'A timed entry end must be a UTC calendar instant.' }
  }
  if (end <= start) return { ok: false, code: 'invalid-range', message: 'A timed entry must end after it starts.' }
  return { date: dateInZone(start, zone), startsAt, endsAt: request.endsAt }
}

/**
 * Delete one displayed entry.
 *
 * A subscription or import entry is owned by its source, so deleting it reports
 * `readonly`; removing the source is what removes those entries.
 * @param domain - Open calendar domain.
 * @param id - Entry identity the Client supplied.
 * @returns whether an owned entry was removed, or why it was not.
 */
export async function deleteEntry(
  domain: Domain<typeof calendarDomain>,
  id: string,
): Promise<CalendarDeleteEntryResult> {
  const key = brandString<CalendarEntryIdType>(id)
  const current = domain.table('entries').get(key)
  if (current === undefined) return { ok: false, code: 'not-found', message: 'That calendar entry no longer exists.' }
  if (current.origin !== 'local') {
    return { ok: false, code: 'readonly', message: 'This entry comes from a calendar source and cannot be deleted on its own.' }
  }
  await domain.table('entries').delete(key)
  return { ok: true, id }
}
