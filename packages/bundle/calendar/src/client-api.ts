/**
 * Browser-safe identifiers, bounds, and pure helpers the calendar Client and
 * the Host service agree on. Nothing here reaches a Node API, so the Client
 * bundle and the Host entry can import the same values.
 * @module @deepseek-ai/dsh-calendar/client-api
 */

import type {
  CalendarEntryErrorCode,
  CalendarImportErrorCode,
  CalendarSubscriptionErrorCode,
  CalendarTaskErrorCode,
} from './types.ts'

/** Package name; also the `plugins.bundle.config` slot key for this bundle's page. */
export const CALENDAR_PACKAGE_NAME = '@deepseek-ai/dsh-calendar'

/** Loader id of the Cordis row this bundle's patch inserts. */
export const CALENDAR_ROW_ID = 'calendar'

/** Host `cordis.yml` row id whose configuration the Plugins detail page serves. */
export const CALENDAR_CONFIG_NAMESPACE = 'calendar'

/**
 * Centre-panel id. The `main` slot uses it as a key and the
 * `sidebar.panellist` list uses it as an id; both must match.
 */
export const CALENDAR_PANEL_ID = 'calendar'

/** Dictionary namespace for the calendar page. */
export const CALENDAR_LOCALE_NAMESPACE = 'calendar'

/** Dictionary namespace for the calendar's Plugins detail page. */
export const CALENDAR_CONFIG_LOCALE_NAMESPACE = 'settings.calendar'

/** Remote namespace the Client mounts from this package's `./remote` export. */
export const CALENDAR_REMOTE_NAMESPACE = 'calendar'

/** Display order of the sidebar affordance among the shipped panel icons. */
export const CALENDAR_PANEL_ORDER = 30

/** Longest accepted range in days; a wider request is rejected before any read. */
export const MAX_CALENDAR_RANGE_DAYS = 92

/** Shortest accepted range in minutes; a narrower request is rejected before any read. */
export const MIN_CALENDAR_RANGE_MINUTES = 1

/** Longest accepted subscription or import display name, in characters. */
export const MAX_CALENDAR_NAME_LENGTH = 120

/** Longest accepted local entry title, in characters. */
export const MAX_CALENDAR_ENTRY_TITLE_LENGTH = 200

/**
 * Task names reuse the Host Schedule service's own limit, so a name accepted
 * by this form is accepted by the service that stores it.
 */
export const MAX_CALENDAR_TASK_TITLE_LENGTH = 120

/** Longest accepted reminder instruction, in characters. */
export const MAX_CALENDAR_PROMPT_LENGTH = 4_000

/** Result of validating one user-supplied subscription URL. */
export type CalendarSubscriptionUrlCheck =
  | { readonly ok: true; readonly url: string; readonly protocol: 'https' | 'http' }
  | { readonly ok: false; readonly code: CalendarSubscriptionErrorCode; readonly reason: string }

/**
 * Validate one user-supplied subscription URL with the same rule the Host
 * applies, so a Client form can reject a value before a round trip. The
 * accepted form is an absolute `https:` or `http:` URL with a host; the rule
 * deliberately admits a loopback host so a local fixture server works.
 * @param value - Raw text from a subscription form.
 * @returns The normalized URL and its protocol, or the failure a Client shows.
 */
export function checkSubscriptionUrl(value: string): CalendarSubscriptionUrlCheck {
  const trimmed = value.trim()
  if (trimmed === '') return { ok: false, code: 'invalid-url', reason: 'A subscription URL is required.' }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, code: 'invalid-url', reason: 'A subscription URL must be an absolute URL.' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, code: 'unsupported-protocol', reason: 'A subscription URL must use https: or http:.' }
  }
  if (parsed.hostname === '') {
    return { ok: false, code: 'invalid-url', reason: 'A subscription URL must name a host.' }
  }
  return { ok: true, url: parsed.toString(), protocol: parsed.protocol.slice(0, -1) as 'https' | 'http' }
}

/** Dictionary key for one subscription or refresh failure. */
export type CalendarFailureMessageKey = `failure.${CalendarSubscriptionErrorCode}`

/**
 * Map one subscription failure code to its dictionary key.
 * @param code - Subscription failure code the Host returned.
 * @returns the dictionary key for that failure.
 */
export function subscriptionFailureKey(code: CalendarSubscriptionErrorCode): CalendarFailureMessageKey {
  return `failure.${code}`
}

/** Dictionary key for one task create, update, or delete failure. */
export type CalendarTaskMessageKey = `task.${CalendarTaskErrorCode}`

/**
 * Map one task failure code to its dictionary key.
 * @param code - Task failure code the Host returned.
 * @returns the dictionary key for that failure.
 */
export function taskFailureKey(code: CalendarTaskErrorCode): CalendarTaskMessageKey {
  return `task.${code}`
}

/** Dictionary key for one local entry edit failure. */
export type CalendarEntryMessageKey = `entry.${CalendarEntryErrorCode}`

/**
 * Map one local entry failure code to its dictionary key.
 * @param code - Local entry failure code the Host returned.
 * @returns the dictionary key for that failure.
 */
export function entryFailureKey(code: CalendarEntryErrorCode): CalendarEntryMessageKey {
  return `entry.${code}`
}

/** Dictionary key for one iCalendar import failure. */
export type CalendarImportMessageKey = `import.${CalendarImportErrorCode}`

/**
 * Map one import failure code to its dictionary key.
 * @param code - Import failure code the Host returned.
 * @returns the dictionary key for that failure.
 */
export function importFailureKey(code: CalendarImportErrorCode): CalendarImportMessageKey {
  return `import.${code}`
}

/**
 * Check one Client-supplied range against the bounds the Host enforces.
 * @param rangeStart - Inclusive start as a canonical UTC instant.
 * @param rangeEnd - Exclusive end as a canonical UTC instant.
 * @returns Whether the Host will accept the range.
 */
export function isAcceptedRange(rangeStart: string, rangeEnd: string): boolean {
  const start = Date.parse(rangeStart)
  const end = Date.parse(rangeEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false
  const minutes = (end - start) / 60_000
  return minutes >= MIN_CALENDAR_RANGE_MINUTES && minutes <= MAX_CALENDAR_RANGE_DAYS * 24 * 60
}
