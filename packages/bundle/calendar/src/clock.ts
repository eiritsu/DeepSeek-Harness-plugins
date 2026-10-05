/** Host clock and zone reads. Nothing here fixes a zone. */

/** Read the current Host instant as a canonical UTC instant. */
export function hostNow(): string {
  return new Date(Date.now()).toISOString()
}

/**
 * Read the zone the Host process runs in.
 * @returns the IANA zone name, or `UTC` where the runtime reports none.
 */
export function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/**
 * Whether a zone name is one the runtime's `Intl` implementation accepts.
 * @param value - Candidate IANA zone name.
 * @returns whether the zone can format a date.
 */
export function isSupportedTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

/** One formatter per zone; `Intl.DateTimeFormat` construction dominates the all-day path. */
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * Resolve a display date in one zone without constructing a formatter per call.
 * @param zone - Zone the date is rendered in.
 * @returns a cached `en-CA` formatter, which formats as `YYYY-MM-DD`.
 */
function zoneFormatter(zone: string): Intl.DateTimeFormat {
  const cached = zoneFormatters.get(zone)
  if (cached !== undefined) return cached
  const created = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
  zoneFormatters.set(zone, created)
  return created
}

/**
 * Whether a `YYYY-MM-DD` string names a real civil date.
 *
 * The check round-trips the parts through UTC, so it is independent of any
 * zone: rendering a date's UTC midnight in a zone behind UTC would otherwise
 * report the previous day and reject every valid date.
 * @param value - Candidate civil date.
 * @returns whether the parts name a day that exists.
 */
export function isCivilDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const round = new Date(Date.UTC(year, month - 1, day))
  return round.getUTCFullYear() === year && round.getUTCMonth() === month - 1 && round.getUTCDate() === day
}

/**
 * Render one instant as a calendar date in one zone.
 * @param instant - Canonical UTC instant, or epoch milliseconds.
 * @param zone - Zone the date is rendered in.
 * @returns the `YYYY-MM-DD` date the instant falls on.
 */
export function dateInZone(instant: string | number, zone: string): string {
  const date = new Date(instant)
  // `en-CA` renders ISO-ordered parts, so a host without the locale data still
  // produces a sortable `YYYY-MM-DD` string from the formatToParts fallback.
  const formatted = zoneFormatter(zone).format(date)
  if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted
  const parts = zoneFormatter(zone).formatToParts(date)
  const year = parts.find(part => part.type === 'year')?.value ?? ''
  const month = parts.find(part => part.type === 'month')?.value ?? ''
  const day = parts.find(part => part.type === 'day')?.value ?? ''
  return `${year}-${month}-${day}`
}
