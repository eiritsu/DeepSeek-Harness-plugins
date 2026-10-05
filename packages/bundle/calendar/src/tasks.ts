/** Schedule service delegation and bounded occurrence derivation. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  ScheduleId,
  isRecurringScheduleRecord,
  resolveRecurringOccurrence,
} from '@deepseek-ai/dsh-schedule'
import type {
  RecurringScheduleRecord,
  ScheduleCatalogEntry,
  ScheduleId as ScheduleIdType,
  ScheduleRecord,
} from '@deepseek-ai/dsh-schedule/client'
import type { CalendarOccurrence, CalendarTask } from './types.ts'

/** Message shown when a task method runs without the Host Schedule service. */
export const SCHEDULE_UNAVAILABLE_MESSAGE =
  'Automations need the official Schedule bundle. Enable @deepseek-ai/dsh-schedule (for example through @deepseek-ai/dsh-experimental-schedule-bundle) in this profile.'

/**
 * Read the Host Schedule service when the profile has enabled it.
 *
 * `ctx.get` reads the global service store, so a row this bundle inserted under
 * a different id is still found; the `ctx.schedule` property proxy is
 * topology-sensitive and is reserved for declared injections.
 * @param ctx - Host context.
 * @returns the Schedule service, or undefined when the profile omits the row.
 */
export function scheduleService(ctx: Context): Context['schedule'] | undefined {
  return ctx.get('schedule')
}

/**
 * Project one catalog entry into the value a Client renders, keeping the bare
 * record separate so a Client can hand it back as a compare-and-update
 * `expected` value without stripping members.
 * @param entry - Catalog entry the Host Schedule service returned.
 * @param occurrenceError - Why no occurrence was derived, when expansion failed.
 * @returns the Client-facing task.
 */
export function toTask(entry: ScheduleCatalogEntry, occurrenceError?: string): CalendarTask {
  const { sessionId, status, lastDelivery, ...record } = entry
  return {
    id: entry.id,
    sessionId,
    status,
    ...(lastDelivery === undefined ? {} : { lastDelivery }),
    record: record,
    ...(occurrenceError === undefined ? {} : { occurrenceError }),
  }
}

/** Bounds one occurrence derivation applies. */
export interface OccurrenceBounds {
  /** Largest accepted number of occurrences one task contributes. */
  readonly perTask: number
  /** Largest accepted number of occurrences the whole derivation returns. */
  readonly total: number
}

/** Occurrences derived for a whole snapshot, or the reason one task yielded none. */
export interface OccurrenceDerivation {
  readonly occurrences: CalendarOccurrence[]
  /** Message per task whose stored record failed a recurrence precondition. */
  readonly errors: Map<ScheduleIdType, string>
  /** True when a bound stopped the derivation. */
  readonly truncated: boolean
}

/**
 * Derive the occurrences every catalog entry has inside one range.
 *
 * Occurrences come from the Host Schedule service's own exported recurrence
 * resolvers, so the calendar and the delivery runtime agree on when a rule is
 * due. A one-shot task contributes the single instant it stores; an inactive
 * task contributes that instant too, because its rule has no future left and
 * inventing one would misreport it as armed.
 * @param entries - Catalog entries the Host Schedule service returned.
 * @param from - Inclusive lower edge as epoch milliseconds.
 * @param to - Exclusive upper edge as epoch milliseconds.
 * @param bounds - Accepted occurrence counts.
 * @returns the derived occurrences, per-task failures, and the truncation flag.
 */
export function deriveOccurrences(
  entries: readonly ScheduleCatalogEntry[],
  from: number,
  to: number,
  bounds: OccurrenceBounds,
): OccurrenceDerivation {
  const occurrences: CalendarOccurrence[] = []
  const errors = new Map<ScheduleIdType, string>()
  let truncated = false
  for (const entry of entries) {
    // A task that hits its own per-task ceiling is reported, but the remaining
    // tasks still contribute; only the snapshot-wide ceiling ends the sweep.
    if (occurrences.length >= bounds.total) { truncated = true; break }
    try {
      const derived = occurrencesOf(entry, from, to, bounds.perTask)
      if (derived.reason !== undefined) errors.set(entry.id, derived.reason)
      if (derived.truncated) truncated = true
      for (const occurrence of derived.items) {
        if (occurrences.length >= bounds.total) { truncated = true; break }
        occurrences.push(occurrence)
      }
    } catch (error: unknown) {
      errors.set(entry.id, error instanceof Error ? error.message : String(error))
    }
  }
  return { occurrences, errors, truncated }
}

/** One task's derived occurrences and whether its per-task cap stopped it. */
interface TaskOccurrences {
  readonly items: CalendarOccurrence[]
  readonly truncated: boolean
  /** Why this task contributed nothing, when its stored record is unusable. */
  readonly reason?: string
}

/**
 * Derive one task's occurrences inside a range.
 * @param entry - Catalog entry the Host Schedule service returned.
 * @param from - Inclusive lower edge as epoch milliseconds.
 * @param to - Exclusive upper edge as epoch milliseconds.
 * @param limit - Largest accepted number of occurrences from this task.
 * @returns the occurrences in ascending order, and whether the cap stopped them.
 */
function occurrencesOf(entry: ScheduleCatalogEntry, from: number, to: number, limit: number): TaskOccurrences {
  const record: ScheduleRecord = entry
  const start = Date.parse(record.scheduledAt)
  // A stored record whose target cannot be read is reported on the task rather
  // than dropped, so the page shows why it has no occurrences.
  if (!Number.isFinite(start)) {
    return { items: [], truncated: false, reason: 'The stored schedule target is not a readable instant.' }
  }
  if (start >= to) return { items: [], truncated: false }
  if (!isRecurringScheduleRecord(record) || entry.status === 'inactive') {
    return { items: start >= from ? [occurrence(record, entry.sessionId, start, false, entry.status)] : [], truncated: false }
  }
  let current: RecurringScheduleRecord = record
  if (start < from) {
    // One call returns the latest occurrence at or before the range and the
    // first after it, so a rule anchored long in the past is reached in O(1).
    const first = resolveRecurringOccurrence(current, from)
    const anchor = Date.parse(first.occurrenceAt) >= from ? first.occurrenceAt : first.nextScheduledAt
    if (anchor === undefined) return { items: [], truncated: false }
    current = { ...current, scheduledAt: anchor }
  }
  const items: CalendarOccurrence[] = []
  for (let step = 0; step < limit; step += 1) {
    const at = Date.parse(current.scheduledAt)
    if (at >= to) return { items, truncated: false }
    items.push(occurrence(current, entry.sessionId, at, true, entry.status))
    const next = resolveRecurringOccurrence(current, at).nextScheduledAt
    if (next === undefined) return { items, truncated: false }
    current = { ...current, scheduledAt: next }
  }
  return { items, truncated: Date.parse(current.scheduledAt) < to }
}

/**
 * Project one resolved instant into an occurrence value.
 * @param record - Task record the instant came from.
 * @param sessionId - Session that receives the reminder when it becomes due.
 * @param at - Resolved instant as epoch milliseconds.
 * @param recurring - Whether the task repeats.
 * @param status - The task's stored lifecycle, so an ended task is not shown as pending.
 * @returns the occurrence.
 */
function occurrence(
  record: ScheduleRecord,
  sessionId: SessionId,
  at: number,
  recurring: boolean,
  status: 'active' | 'inactive',
): CalendarOccurrence {
  return {
    taskId: record.id,
    sessionId,
    kind: record.kind,
    title: record.title,
    startsAt: new Date(at).toISOString(),
    status,
    recurring,
  }
}

/**
 * Brand one task identity the Host Schedule service returned to a Client.
 * @param value - Task id as it crossed the Remote carrier.
 * @returns the branded identity the service's update and delete methods require.
 */
export function asScheduleId(value: string): ScheduleIdType {
  return ScheduleId(value)
}
