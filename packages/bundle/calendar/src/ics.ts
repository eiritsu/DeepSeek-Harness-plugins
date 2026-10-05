/** iCalendar text to normalized calendar entries, with bounded expansion. */
import ICAL from 'ical.js'
import type { CalendarEntryOrigin } from './types.ts'

/** One expanded occurrence of one source VEVENT, after every override applied. */
export interface IcsOccurrence {
  /** Source `UID`; several occurrences of one event share it. */
  readonly uid: string
  readonly title: string
  readonly summary?: string
  readonly location?: string
  readonly color?: string
  /** True when the source marked the start as a `VALUE=DATE` value. */
  readonly allDay: boolean
  /** Canonical UTC start instant after any `RECURRENCE-ID` relocation. */
  readonly startsAt: string
  /** Canonical UTC end instant; absent when the source declares no end. */
  readonly endsAt?: string
  /** `YYYY-MM-DD` start date as the source calendar states it. */
  readonly date: string
  /** True when the source event carries a recurrence rule. */
  readonly recurring: boolean
}

/** Bounds one parse applies, all supplied by the deployment configuration. */
export interface IcsParseBounds {
  /** Inclusive lower edge of the expansion window, as epoch milliseconds. */
  readonly from: number
  /** Exclusive upper edge of the expansion window, as epoch milliseconds. */
  readonly to: number
  /** Largest accepted number of VEVENT components read from the text. */
  readonly maxEvents: number
  /** Largest accepted number of occurrences produced for the whole document. */
  readonly maxOccurrences: number
  /** Largest accepted number of occurrences one component contributes to the window. */
  readonly maxOccurrencesPerEvent: number
  /** Largest accepted number of rule steps evaluated for one component. */
  readonly maxExpansionIterations: number
}

/** Normalized result of reading one iCalendar document. */
export interface IcsParseResult {
  readonly occurrences: IcsOccurrence[]
  /**
   * Why the document was refused, when it states a zone the Host does not
   * interpret. The document is read as a whole, so one unreadable time zone
   * rejects it rather than placing that event at a guessed instant.
   */
  readonly unsupportedZone?: string
  /** Components the document contained beyond `maxEvents`. */
  readonly droppedEvents: number
  /**
   * Occurrences a bound rejected: the document total, or one rule whose step
   * budget ran out before the window began.
   */
  readonly droppedOccurrences: number
}

/** Source prefix a normalized occurrence is written under. */
export interface IcsOwner {
  readonly origin: CalendarEntryOrigin
  /** Subscription or import identity the occurrence belongs to. */
  readonly ownerId: string
}

/** Title used when a source event carries no `SUMMARY`. */
const UNTITLED = '(untitled event)'

/**
 * A document states a time the Host refuses to interpret.
 *
 * The message is fixed and never quotes the document or its zone name, so a
 * private feed's contents stay out of a log line and a Client message.
 */
export class UnsupportedTimeZoneError extends Error {
  /**
   * @param message - What the Host could not interpret.
   */
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedTimeZoneError'
  }
}

/**
 * Read the zone an event declares, refusing one the Host cannot interpret.
 * @param event - Event to check.
 * @returns the resolved zone.
 * @throws UnsupportedTimeZoneError when the zone is floating or unresolvable.
 */
function declaredZone(event: ICAL.Event): string {
  const start = event.startDate
  if (!isInterpretable(start)) throw new UnsupportedTimeZoneError(unsupportedZoneMessage(declaredTzid(event, 'dtstart')))
  const end = event.component.hasProperty('dtend') || event.component.hasProperty('duration') ? event.endDate : undefined
  if (end !== undefined && !isInterpretable(end)) {
    throw new UnsupportedTimeZoneError(unsupportedZoneMessage(declaredTzid(event, 'dtend')))
  }
  return start.zone.tzid
}

/**
 * Read the zone name a property declares.
 *
 * Once a `TZID` fails to resolve, `ical.js` reports the value as `floating`, so
 * the declared name is read from the property parameters to tell an
 * unresolvable zone apart from a genuinely floating value. The name is never
 * carried into a message.
 * @param event - Event carrying the property.
 * @param name - Property to read, `dtstart` or `dtend`.
 * @returns the declared zone, or undefined when the property declares none.
 */
function declaredTzid(event: ICAL.Event, name: 'dtstart' | 'dtend'): string | undefined {
  const declared = event.component.getFirstProperty(name)?.getParameter('tzid')
  return typeof declared === 'string' && declared !== '' ? declared : undefined
}

/** Longest accepted title, summary, and location, in characters. */
const MAX_TITLE = 500
const MAX_SUMMARY = 4_000
const MAX_LOCATION = 500
const MAX_COLOR = 64

/**
 * Read iCalendar text into normalized occurrences.
 *
 * `ical.js` resolves `RRULE`, `EXDATE`, `RECURRENCE-ID` overrides, `TZID`
 * references, all-day `VALUE=DATE` values, and UTC-range arithmetic; this
 * function bounds the work, isolates the document's own `VTIMEZONE`
 * definitions, and normalizes the result.
 *
 * A document's `VTIMEZONE` components are registered for the duration of this
 * call and the previous registry state is restored afterwards, so two feeds
 * that define the same `TZID` differently cannot resolve each other's times.
 * @param text - iCalendar document text.
 * @param bounds - Expansion window and the deployment's accepted limits.
 * @returns the expanded occurrences and what the bounds rejected.
 * @throws Error when the text is not a readable VCALENDAR.
 */
export function parseIcs(text: string, bounds: IcsParseBounds): IcsParseResult {
  // `fromString` is the library's own typed entry into its untyped jCal bridge.
  const root = ICAL.Component.fromString(text)
  if (root.name !== 'vcalendar') throw new Error('The text is not a VCALENDAR component.')
  const restore = registerZones(root)
  try {
    return expandDocument(root, bounds)
  } finally {
    restore()
  }
}

/**
 * Register a document's `VTIMEZONE` definitions and return the function that
 * puts the shared registry back the way it was.
 * @param root - Parsed `VCALENDAR`.
 * @returns a disposer restoring every replaced definition and removing every
 *   definition the document introduced.
 */
function registerZones(root: ICAL.Component): () => void {
  const previous = new Map<string, ICAL.Timezone | null>()
  for (const component of root.getAllSubcomponents('vtimezone')) {
    const zone = new ICAL.Timezone(component)
    const tzid = zone.tzid
    if (!previous.has(tzid)) previous.set(tzid, ICAL.TimezoneService.has(tzid) ? ICAL.TimezoneService.get(tzid) : null)
    ICAL.TimezoneService.register(zone)
  }
  return () => {
    for (const [tzid, zone] of previous) {
      if (zone === null) ICAL.TimezoneService.remove(tzid)
      else ICAL.TimezoneService.register(zone)
    }
  }
}

/**
 * Expand every accepted master component of a parsed document.
 * @param root - Parsed `VCALENDAR` with its zones registered.
 * @param bounds - Expansion window and the deployment's accepted limits.
 * @returns the expanded occurrences and what the bounds rejected.
 */
function expandDocument(root: ICAL.Component, bounds: IcsParseBounds): IcsParseResult {
  const masters: ICAL.Event[] = []
  const exceptions: ICAL.Event[] = []
  // Every component is budgeted, not only the masters, so a feed of overrides
  // cannot expand the work the component ceiling exists to bound.
  for (const component of root.getAllSubcomponents('vevent').slice(0, bounds.maxEvents)) {
    const event = new ICAL.Event(component)
    // `getFirstPropertyValue` answers `null` for an absent property, so
    // membership is decided by the component, never by the value.
    if (component.hasProperty('recurrence-id')) exceptions.push(event)
    else masters.push(event)
  }
  const occurrences: IcsOccurrence[] = []
  let droppedOccurrences = 0
  let emitted = 0
  const accepted = masters
  for (const master of accepted) {
    const overrides = new Map<string, IcsOverride>()
    const withdrawn = new Set<string>()
    for (const exception of exceptions) {
      if (exception.uid !== master.uid) continue
      master.relateException(exception)
      const key = recurrenceKeyOf(exception)
      const recurrenceId = recurrenceIdOf(exception)
      if (recurrenceId === undefined) continue
      if (statusOf(exception) === 'CANCELLED') withdrawn.add(key)
      else overrides.set(key, { event: exception, recurrenceId })
    }
    // A cancelled master is withdrawn by the source; it is absent data, not a
    // rejected occurrence, so it never counts against the bounds.
    if (statusOf(master) === 'CANCELLED') continue
    try {
      declaredZone(master)
    } catch (error: unknown) {
      if (!(error instanceof UnsupportedTimeZoneError)) throw error
      return { occurrences: [], droppedEvents: 0, droppedOccurrences: 0, unsupportedZone: error.message }
    }
    // The per-component ceiling counts only occurrences that would be shown,
    // so a series with a long history does not spend today's budget before
    // the window is reached.
    let fromComponent = 0
    const derived = expand(master, overrides, withdrawn, bounds, (occurrence) => {
      if (emitted >= bounds.maxOccurrences) { droppedOccurrences += 1; return }
      if (fromComponent >= bounds.maxOccurrencesPerEvent) { droppedOccurrences += 1; return }
      fromComponent += 1
      emitted += 1
      occurrences.push(occurrence)
    })
    droppedOccurrences += derived.dropped
  }
  return {
    occurrences,
    droppedEvents: Math.max(0, root.getAllSubcomponents('vevent').length - accepted.length - exceptions.length),
    // A cancelled override is source data, not a rejected occurrence, so it is
    // absent from the series and never counted as truncation.
    droppedOccurrences,
  }
}

/**
 * Read a component's `STATUS` value.
 * @param event - Event to read.
 * @returns the upper-case status, or an empty string when none is declared.
 */
function statusOf(event: ICAL.Event): string {
  const status = event.component.getFirstPropertyValue('status')
  return typeof status === 'string' ? status.toUpperCase() : ''
}

/** One `RECURRENCE-ID` override, with the series time it replaces. */
interface IcsOverride {
  /** The overriding event, which supplies the relocated start, end, and text. */
  readonly event: ICAL.Event
  /** The series time this occurrence replaces. */
  readonly recurrenceId: ICAL.Time
}

/**
 * Read one occurrence time as the civil date the source calendar states.
 * @param time - Time the rule series or the source declared.
 * @returns the `YYYY-MM-DD` date, taken from the time's own parts.
 */
function civilDate(time: ICAL.Time): string {
  return `${String(time.year).padStart(4, '0')}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
}

/**
 * Whether an occurrence's zone is one this Host can state as an instant.
 *
 * `ical.js` answers an unresolvable `TZID` and a floating date-time both as its
 * own `floating` zone and then converts them through the process's local zone,
 * so the same feed would place an event differently on every machine. A whole
 * day is exempt: it is a civil date the source states, which is kept as it is.
 * @param time - Occurrence time to check.
 * @returns whether the time carries a zone this Host interprets.
 */
function isInterpretable(time: ICAL.Time): boolean {
  if (time.isDate) return true
  const tzid = time.zone.tzid
  return tzid === 'UTC' || ICAL.TimezoneService.has(tzid)
}

/**
 * Describe a zone this Host refuses to interpret without echoing source text.
 *
 * A `TZID` is arbitrary feed content that a private source could use to smuggle
 * text into a log line or an error message, so the message never quotes it and
 * instead states only the two repairs a person can make.
 * @param tzid - The zone the source declared, or undefined when it declared none.
 * @returns a fixed message that carries no document content.
 */
function unsupportedZoneMessage(tzid: string | undefined): string {
  return tzid === undefined || tzid === 'floating'
    ? 'The event states a floating date-time, which has no zone. Declare a time zone the Host can resolve.'
    : 'The event uses an undefined time zone. Supply its VTIMEZONE or use UTC.'
}

/**
 * Read an override's `RECURRENCE-ID` as the key the expansion series uses.
 * @param event - Event carrying a `RECURRENCE-ID`.
 * @returns the identity the master expansion reports for that occurrence.
 */
function recurrenceKeyOf(event: ICAL.Event): string {
  return recurrenceIdOf(event)?.toString() ?? ''
}

/**
 * Read an override's `RECURRENCE-ID` value.
 * @param event - Event carrying a `RECURRENCE-ID`.
 * @returns the series time, or undefined when the property is unreadable.
 */
function recurrenceIdOf(event: ICAL.Event): ICAL.Time | undefined {
  const id = event.component.getFirstPropertyValue('recurrence-id')
  return id instanceof ICAL.Time ? id : undefined
}

/** Occurrences one component produced and what its own bounds rejected. */
interface ExpansionResult {
  readonly dropped: number
}

/**
 * Expand one master event into normalized occurrences inside the window.
 *
 * Each step of the rule series is resolved through `getOccurrenceDetails`, so a
 * `RECURRENCE-ID` override contributes its own relocated start, end, and title
 * instead of the master's, and a cancelled override is withheld. `EXDATE` is
 * already removed by the expansion itself.
 * @param master - Master event with every override of its `UID` related.
 * @param overrides - Overrides that rescheduled an occurrence, keyed by their `RECURRENCE-ID`.
 * @param withdrawn - `RECURRENCE-ID` keys removed by a cancelled override.
 * @param bounds - Expansion window and the deployment's accepted limits.
 * @param emit - Receives each occurrence that lands inside the window.
 * @returns what this component's own bounds rejected.
 */
function expand(
  master: ICAL.Event,
  overrides: Map<string, IcsOverride>,
  withdrawn: Set<string>,
  bounds: IcsParseBounds,
  emit: (occurrence: IcsOccurrence) => void,
): ExpansionResult {
  if (!master.isRecurring()) {
    const occurrence = one(master, master.startDate, undefined, undefined, withdrawn)
    if (occurrence !== undefined && landsInside(occurrence, bounds)) emit(occurrence)
    return { dropped: 0 }
  }
  const expansion = new ICAL.RecurExpansion({ component: master.component, dtstart: master.startDate })
  const visited = new Set<string>()
  let dropped = 0
  let step = 0
  for (; step < bounds.maxExpansionIterations; step += 1) {
    // `next()` answers `undefined` once the series is exhausted, which is
    // distinct from a rule that has not reached the window yet.
    const next = expansion.next() as ICAL.Time | undefined
    if (!next) break
    // The series time, not the relocated start, decides where the window ends.
    if (next.toUnixTime() * 1_000 >= bounds.to) break
    const key = next.toString()
    visited.add(key)
    const occurrence = one(master, next, next, overrides.get(key), withdrawn)
    if (occurrence === undefined) continue
    // Only an occurrence that would have been shown counts against the total,
    // so a long history never consumes today's budget.
    if (landsInside(occurrence, bounds)) emit(occurrence)
  }
  // A `RECURRENCE-ID` may sit far past the range end and still move an
  // occurrence back into it. The override is already parsed, so each one the
  // series never reached is resolved on its own rather than by scanning extra
  // steps that would still miss a relabelling further out.
  for (const [key, override] of overrides) {
    if (visited.has(key) || withdrawn.has(key)) continue
    const occurrence = one(master, override.recurrenceId, override.recurrenceId, override, withdrawn)
    if (occurrence === undefined) continue
    if (landsInside(occurrence, bounds)) emit(occurrence)
  }
  // An infinite rule that simply reached the end of the window is not
  // truncated; only an exhausted step budget means occurrences were skipped.
  if (step >= bounds.maxExpansionIterations) dropped += 1
  return { dropped }
}

/**
 * Normalize one occurrence, applying any `RECURRENCE-ID` override.
 * @param master - Master event the occurrence belongs to.
 * @param time - Occurrence start as the rule series reports it.
 * @param seriesTime - The series time this occurrence replaces, present only
 *   for a rule expansion or a directly resolved override.
 * @param override - The override supplying the relocated values, when the
 *   series reached one.
 * @param withdrawn - `RECURRENCE-ID` keys removed by a cancelled override.
 * @returns the normalized occurrence, or undefined when it is withdrawn or the
 *   source declares no usable start.
 */
function one(
  master: ICAL.Event,
  time: ICAL.Time,
  seriesTime: ICAL.Time | undefined,
  override: IcsOverride | undefined,
  withdrawn: Set<string>,
): IcsOccurrence | undefined {
  if (seriesTime !== undefined && withdrawn.has(seriesTime.toString())) return undefined
  const details = seriesTime === undefined ? undefined : master.getOccurrenceDetails(seriesTime)
  const source = override?.event ?? master
  const start = details?.startDate ?? time
  if (!isInterpretable(start)) {
    throw new UnsupportedTimeZoneError(unsupportedZoneMessage(declaredTzid(source, 'dtstart')))
  }
  const date = civilDate(start)
  const end = occurrenceEnd(source, start, details?.endDate)
  // A whole-day value is the source calendar's own civil date, not an instant;
  // converting it through the process zone would place it on another day.
  const startMs = start.isDate ? Date.parse(`${date}T00:00:00.000Z`) : start.toUnixTime() * 1_000
  if (!Number.isFinite(startMs)) return undefined
  const span = start.isDate
    ? Math.max(0, Math.round(((end?.toUnixTime() ?? start.toUnixTime()) - start.toUnixTime()) / 86_400)) * 86_400_000
    : end === undefined ? 0 : (end.toUnixTime() - start.toUnixTime()) * 1_000
  const title = text(source.summary) ?? text(master.summary) ?? UNTITLED
  const summary = text(source.description) ?? text(master.description)
  const location = text(source.location) ?? text(master.location)
  const color = colorOf(source) ?? colorOf(master)
  return {
    uid: master.uid,
    title: title.slice(0, MAX_TITLE),
    ...(summary === undefined ? {} : { summary: summary.slice(0, MAX_SUMMARY) }),
    ...(location === undefined ? {} : { location: location.slice(0, MAX_LOCATION) }),
    ...(color === undefined ? {} : { color }),
    allDay: start.isDate,
    startsAt: new Date(startMs).toISOString(),
    ...(span === 0 ? {} : { endsAt: new Date(startMs + span).toISOString() }),
    date,
    recurring: master.isRecurring(),
  }
}

/**
 * Read the end of one occurrence, defaulting an absent end the way RFC 5545
 * requires: a `VALUE=DATE` start without `DTEND` or `DURATION` lasts one day,
 * a `DATE-TIME` start without either has no duration.
 *
 * The one-day default is measured from the occurrence's own start, so the
 * second day of a multi-day series is not shortened to the master's date.
 * @param source - Event supplying this occurrence's end.
 * @param start - The occurrence's own start.
 * @param expandedEnd - End the rule expansion computed, when it has one.
 * @returns the end time, or undefined when the occurrence has no duration.
 */
function occurrenceEnd(source: ICAL.Event, start: ICAL.Time, expandedEnd: ICAL.Time | undefined): ICAL.Time | undefined {
  if (source.component.hasProperty('dtend') || source.component.hasProperty('duration')) {
    return expandedEnd ?? source.endDate
  }
  if (!start.isDate) return undefined
  // `adjust` takes days, hours, minutes, and seconds in that order.
  return start.clone().adjust(1, 0, 0, 0)
}

/**
 * Read an event's rendering color when it declares a usable one.
 * @param event - Event to read.
 * @returns the trimmed color, or undefined when none is usable.
 */
function colorOf(event: ICAL.Event): string | undefined {
  const color = event.component.getFirstPropertyValue('color') as { rgb?: string; name?: string } | null
  const raw = color?.rgb ?? color?.name
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed === '' || trimmed.length > MAX_COLOR ? undefined : trimmed
}

/**
 * Read a text property, treating both an absent value and an empty string as
 * "not declared".
 * @param value - Property value as `ical.js` reports it.
 * @returns the trimmed text, or undefined when the source declares none.
 */
function text(value: string | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Whether one occurrence intersects the requested window.
 *
 * An occurrence with no duration is a point in time, so it belongs to the
 * window when its start does; a zero-length interval would otherwise overlap
 * nothing at all.
 * @param occurrence - Normalized occurrence under test.
 * @param bounds - Expansion window.
 * @returns whether the occurrence belongs in `[from, to)`.
 */
function landsInside(occurrence: IcsOccurrence, bounds: IcsParseBounds): boolean {
  const start = Date.parse(occurrence.startsAt)
  const end = occurrence.endsAt === undefined ? start : Date.parse(occurrence.endsAt)
  if (end === start) return start >= bounds.from && start < bounds.to
  return end > bounds.from && start < bounds.to
}

/**
 * Build the stored entry key of one normalized occurrence.
 * @param owner - Prefix the occurrence is attributed to.
 * @param occurrence - Normalized occurrence.
 * @param date - Covered date for a whole-day occurrence; defaults to its own.
 * @returns a key that is stable across refreshes of unchanged source data; a
 *   whole-day occurrence adds its covered date, because one event spanning
 *   several days becomes one stored row per date.
 */
export function occurrenceKey(owner: IcsOwner, occurrence: IcsOccurrence, date = occurrence.date): string {
  const base = `${owner.origin === 'subscription' ? 's' : 'i'}:${owner.ownerId}:${occurrence.uid}@${occurrence.startsAt}`
  return occurrence.allDay ? `${base}#${date}` : base
}

/**
 * Split one normalized whole-day occurrence into the source dates it covers: a
 * multi-day event becomes one stored row per date.
 *
 * RFC 5545 places no upper bound on how many days one `VEVENT` may span, so
 * the length comes from the caller's remaining row budget rather than from a
 * fixed span, and the rows the budget refuses are counted as rejected.
 * @param occurrence - Normalized occurrence.
 * @param maxDates - Largest number of dates this call may return.
 * @returns the source dates the occurrence covers, in ascending order.
 */
export function allDaySourceDates(occurrence: IcsOccurrence, maxDates: number): string[] {
  if (!occurrence.allDay || occurrence.endsAt === undefined) return [occurrence.date]
  const spanDays = Math.round((Date.parse(occurrence.endsAt) - Date.parse(occurrence.startsAt)) / 86_400_000)
  if (spanDays <= 1) return [occurrence.date]
  const [year, month, day] = occurrence.date.split('-').map(Number)
  /* v8 ignore next -- `one` always produces a four-digit date from a Time. */
  if (year === undefined || month === undefined || day === undefined) return [occurrence.date]
  const dates: string[] = []
  for (let index = 0; index < Math.min(spanDays, maxDates); index += 1) {
    const shifted = new Date(Date.UTC(year, month - 1, day + index))
    dates.push(`${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`)
  }
  return dates
}
