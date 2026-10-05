/**
 * Calendar Remote request and response values shared by the Host service and
 * every mounted Client face. This module contains types only.
 *
 * A displayed day is rendered from three independent sources that never merge:
 * Schedule automations reported by the Host Schedule service, ordinary entries
 * in this plugin's own store, and entries read from user-supplied iCalendar
 * subscriptions. Only Schedule automations reach a model; the other two are
 * display data.
 * @module @deepseek-ai/dsh-calendar/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type {
  ScheduleCreateRequest,
  ScheduleDeliveryReceipt,
  ScheduleId,
  ScheduleRecord,
  ScheduleTimingChange,
} from '@deepseek-ai/dsh-schedule/client'

/** Stable identity of one stored calendar subscription. */
export type CalendarSubscriptionId = Branded<'CalendarSubscriptionId'>

/** Stable identity of one calendar entry in this plugin's own store. */
export type CalendarEntryId = Branded<'CalendarEntryId'>

/** Stable identity of one calendar produced by an iCalendar text import. */
export type CalendarImportedId = Branded<'CalendarImportedId'>

/** URL scheme a subscription may use; the user supplies the URL explicitly. */
export type CalendarSubscriptionProtocol = 'https' | 'http'

/** Stable failure code for one subscription refresh or configuration read. */
export type CalendarSubscriptionErrorCode =
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'not-found'
  | 'request-failed'
  | 'timeout'
  | 'response-too-large'
  | 'redirect-rejected'
  | 'invalid-ics'
  | 'service-unavailable'
  | 'internal-error'

/** One displayed failure, safe to render in a Client. */
export interface CalendarFailure {
  /** Stable code the Client maps to localized copy. */
  readonly code: CalendarSubscriptionErrorCode
  /** Human-readable reason. Never contains a subscription URL, a credential, or fetched content. */
  readonly message: string
  /** Canonical UTC instant the failure was recorded at. */
  readonly at: string
}

/** One stored subscription together with its most recent refresh outcome. */
export interface CalendarSubscription {
  readonly id: CalendarSubscriptionId
  /** Display name; the only subscription field the Host writes to logs. */
  readonly name: string
  /** Absolute fetch target supplied by the user; `https:` unless the user chose `http:`. */
  readonly url: string
  readonly protocol: CalendarSubscriptionProtocol
  /** Whether the background timer fetches this subscription. */
  readonly enabled: boolean
  /** Seconds between background refreshes. */
  readonly refreshIntervalSeconds: number
  /** Canonical UTC instant of the most recent successful fetch. */
  readonly lastRefreshedAt?: string
  /** Most recent failure, retained until a later refresh succeeds. */
  readonly lastFailure?: CalendarFailure
  /** Entries this subscription currently contributes to a snapshot. */
  readonly entryCount: number
  /**
   * Occurrences the deployment's bounds rejected while reading the last
   * successful fetch. It is the source's own truncation, distinct from
   * `CalendarSnapshot.entriesTruncated`, which reports the snapshot's return
   * ceiling. Zero until the first successful fetch.
   */
  readonly droppedEntryCount: number
  /** True while a fetch for this subscription is in flight. */
  readonly refreshing: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

/** One calendar produced by an iCalendar text import. */
export interface CalendarImportedCalendar {
  readonly id: CalendarImportedId
  /** Display name supplied at import. */
  readonly name: string
  readonly entryCount: number
  /** Entries the import rejected because they fell outside the configured expansion bounds. */
  readonly droppedEntryCount: number
  readonly importedAt: string
}

/** Owner of a displayed entry. */
export type CalendarEntryOrigin = 'local' | 'subscription' | 'import'

/** One displayed entry resolved into the requested range. */
export interface CalendarEntry {
  /** Stable identity: a stored local id, or `<subscription id>:<source uid>`. */
  readonly id: string
  readonly origin: CalendarEntryOrigin
  /** Owning subscription; present only for `origin: 'subscription'`. */
  readonly subscriptionId?: CalendarSubscriptionId
  /** Owning imported calendar; present only for `origin: 'import'`. */
  readonly importedId?: CalendarImportedId
  /** Optional rendering color supplied by the source, as a CSS color string. */
  readonly color?: string
  readonly title: string
  readonly summary?: string
  readonly location?: string
  /** True when the source marks the entry as covering whole days. */
  readonly allDay: boolean
  /**
   * Display date `YYYY-MM-DD` in the snapshot's zone. An all-day entry whose
   * source range crosses midnight reports each covered date as its own entry.
   */
  readonly date: string
  /**
   * Canonical UTC start instant. A whole-day entry carries its date's UTC
   * midnight here so range overlap is decided in one comparable unit; render
   * the entry through `date`, not through this instant.
   */
  readonly startsAt: string
  /** Canonical UTC end instant; absent when the source declares no end. */
  readonly endsAt?: string
  /** True when this entry repeats, as declared by the source. */
  readonly recurring: boolean
}

/** One Schedule automation with the Session binding and lifecycle the Host reports. */
export interface CalendarTask {
  readonly id: ScheduleId
  /** Session that receives the reminder when it becomes due. */
  readonly sessionId: string
  /** Inactive tasks stay visible and never schedule another delivery. */
  readonly status: 'active' | 'inactive'
  /** Most recent durably acknowledged inbox delivery, when available. */
  readonly lastDelivery?: ScheduleDeliveryReceipt
  /**
   * Bare committed record. Pass this member back as `expected` when updating;
   * a record carrying `sessionId`, `status`, or `lastDelivery` is rejected.
   */
  readonly record: ScheduleRecord
  /**
   * Why this task contributed no occurrence to the requested range. The record
   * is present because the Host Schedule service still stores it; only the
   * derived occurrences are missing.
   */
  readonly occurrenceError?: string
}

/** One Schedule occurrence derived from a task over a requested range. */
export interface CalendarOccurrence {
  readonly taskId: ScheduleId
  readonly sessionId: string
  /** Rule discriminant of the task the occurrence came from. */
  readonly kind: ScheduleRecord['kind']
  readonly title: string
  /** Canonical UTC instant of this occurrence. */
  readonly startsAt: string
  readonly status: 'active' | 'inactive'
  /** True when the task repeats; a one-shot task reports `false`. */
  readonly recurring: boolean
}

/** Half-open range of canonical UTC instants. */
export interface CalendarRange {
  /** Inclusive start. */
  readonly start: string
  /** Exclusive end. */
  readonly end: string
}

/** Snapshot request for one displayed range. */
export interface CalendarSnapshotRequest {
  /** Inclusive canonical UTC instant the range starts at. */
  readonly rangeStart: string
  /** Exclusive canonical UTC instant the range ends at; must be after `rangeStart`. */
  readonly rangeEnd: string
  /** Zone used to render all-day dates; omitted selects the Host zone. */
  readonly timeZone?: string
}

/** One Session a new automation may be bound to. */
export interface CalendarSelectableSession {
  readonly id: string
  /**
   * Whether the Host currently holds a live Agent for this Session. It is a
   * display fact, not a delivery requirement: the Host Schedule service
   * restores a cold Session itself when a reminder comes due, so a reminder
   * for a Session that is not live is delivered on time while the application
   * is running. A fully exited application delivers nothing until it starts
   * again.
   */
  readonly live: boolean
  /** Workspace directory the Session ran in, when the Host recorded one. */
  readonly cwd?: string
  /** Epoch milliseconds of the Session's last activity, as the Host indexed it. */
  readonly updatedAt: number
  /**
   * Whether the Session has no turn yet. A blank Session still accepts a
   * reminder, and naming it is the Client's job.
   */
  readonly blank: boolean
}

/** One complete read of everything the calendar shows for a range. */
export interface CalendarSnapshot {
  /** Host clock reading taken when this snapshot was built. */
  readonly now: string
  /** Zone the Host process runs in. */
  readonly hostTimeZone: string
  /** Zone used to render all-day dates in this snapshot. */
  readonly timeZone: string
  readonly range: CalendarRange
  /** Every Schedule task the Host holds, active and inactive. */
  readonly tasks: readonly CalendarTask[]
  /** Occurrences derived from `tasks` inside `range`. */
  readonly occurrences: readonly CalendarOccurrence[]
  /** True when occurrence expansion stopped at a configured bound. */
  readonly occurrencesTruncated: boolean
  /** Local, imported, and subscription entries resolved into `range`. */
  readonly entries: readonly CalendarEntry[]
  /** True when entry resolution stopped at a configured bound. */
  readonly entriesTruncated: boolean
  readonly subscriptions: readonly CalendarSubscription[]
  readonly importedCalendars: readonly CalendarImportedCalendar[]
  /** Sessions a new automation may be bound to; only these are accepted by `createTask`. */
  readonly selectableSessions: readonly CalendarSelectableSession[]
  /**
   * Whether the Host Schedule service is mounted. When it is false, `tasks` and
   * `occurrences` are empty and every task method reports `service-unavailable`;
   * local entries and subscriptions still work.
   */
  readonly serviceAvailable: boolean
}

/** Stable failure code for one task create, update, or delete request. */
export type CalendarTaskErrorCode =
  | 'invalid_prompt'
  | 'invalid_selector'
  | 'invalid_rule'
  | 'invalid_time_zone'
  | 'not_future'
  | 'time_out_of_range'
  | 'frequency_too_high'
  | 'schedule_not_found'
  | 'schedule_ended'
  | 'schedule_conflict'
  | 'session_not_found'
  | 'service-unavailable'
  | 'internal_error'

/** Reminder selector accepted by task creation; exactly one member must be present. */
export type CalendarTaskSelector = Pick<
  ScheduleCreateRequest,
  'at' | 'after_seconds' | 'every_seconds' | 'daily' | 'weekly' | 'cron'
>

/** Create request for one Schedule automation bound to an explicit Session. */
export interface CalendarCreateTaskRequest extends CalendarTaskSelector {
  /** Session receiving the reminder; it must appear in the snapshot's `selectableSessions`. */
  readonly sessionId: string
  /** Task name of at most 120 characters, non-empty after trimming. */
  readonly title: string
  /** Reminder instruction delivered into the Session inbox. */
  readonly prompt: string
}

/** Create outcome: the committed task, or a non-mutating failure. */
export type CalendarCreateTaskResult =
  | { readonly ok: true; readonly task: CalendarTask }
  | { readonly ok: false; readonly code: CalendarTaskErrorCode; readonly message: string }

/** Compare-and-update request within the task's original Session binding. */
export interface CalendarUpdateTaskRequest {
  readonly sessionId: string
  readonly id: ScheduleId
  /** Complete `CalendarTask.record` the Client committed when editing began. */
  readonly expected: ScheduleRecord
  readonly title?: string
  readonly prompt?: string
  /** New timing; its kind may differ from the stored record's kind. */
  readonly change?: ScheduleTimingChange
}

/** Update outcome: the committed task, or a non-mutating miss or failure. */
export type CalendarUpdateTaskResult =
  | { readonly ok: true; readonly task: CalendarTask }
  | { readonly ok: false; readonly code: CalendarTaskErrorCode; readonly message: string }

/** Delete request identifying one task within its Session binding. */
export interface CalendarDeleteTaskRequest {
  readonly sessionId: string
  readonly id: ScheduleId
}

/** Delete outcome; a task already absent reports `schedule_not_found`. */
export type CalendarDeleteTaskResult =
  | { readonly ok: true; readonly id: ScheduleId }
  | { readonly ok: false; readonly code: CalendarTaskErrorCode; readonly message: string }

/** One stored subscription plus the failure detail of a rejected configuration. */
export type CalendarSubscriptionMutationResult =
  | { readonly ok: true; readonly subscription: CalendarSubscription }
  | { readonly ok: false; readonly code: CalendarSubscriptionErrorCode; readonly message: string }

/** Add request for one user-supplied iCalendar subscription. */
export interface CalendarAddSubscriptionRequest {
  /** Display name of at most 120 characters, non-empty after trimming. */
  readonly name: string
  /** Absolute `https:` or `http:` URL the user obtained themselves. */
  readonly url: string
  /** Whether the background timer fetches this subscription; defaults to true. */
  readonly enabled?: boolean
  /** Seconds between background refreshes; omitted selects the configured default. */
  readonly refreshIntervalSeconds?: number
}

/** Update request for one stored subscription. */
export interface CalendarUpdateSubscriptionRequest {
  readonly id: CalendarSubscriptionId
  readonly name?: string
  /** A changed URL is fetched once before the change is committed. */
  readonly url?: string
  readonly enabled?: boolean
  readonly refreshIntervalSeconds?: number
}

/** Request naming one stored subscription. */
export interface CalendarSubscriptionRef {
  readonly id: CalendarSubscriptionId
}

/** Delete outcome for one stored subscription and the entries it contributed. */
export type CalendarDeleteSubscriptionResult =
  | { readonly ok: true; readonly id: CalendarSubscriptionId }
  | { readonly ok: false; readonly code: CalendarSubscriptionErrorCode; readonly message: string }

/** Refresh outcome for one subscription fetch. */
export type CalendarRefreshResult =
  | {
    readonly ok: true
    readonly subscription: CalendarSubscription
    /** Entries the fetch contributed to the range. */
    readonly entryCount: number
    /** Occurrences the expansion bounds rejected. */
    readonly droppedEntryCount: number
  }
  | {
    readonly ok: false
    readonly id: CalendarSubscriptionId
    readonly code: CalendarSubscriptionErrorCode
    readonly message: string
  }

/** Import request for iCalendar text the user already has. */
export interface CalendarImportIcsRequest {
  /** Display name of at most 120 characters, non-empty after trimming. */
  readonly name: string
  /** iCalendar text. An import never fetches a URL and never triggers an Agent. */
  readonly ics: string
}

/** Stable failure code for one iCalendar text import. */
export type CalendarImportErrorCode = 'invalid-name' | 'invalid-ics' | 'response-too-large' | 'internal-error'

/** Import outcome: the stored calendar, or a non-mutating failure. */
export type CalendarImportIcsResult =
  | { readonly ok: true; readonly calendar: CalendarImportedCalendar }
  | { readonly ok: false; readonly code: CalendarImportErrorCode; readonly message: string }

/** Delete request for one calendar produced by an iCalendar text import. */
export interface CalendarDeleteImportedRequest {
  readonly id: CalendarImportedId
}

/**
 * Delete outcome for one imported calendar. Deleting it removes the entries it
 * contributed; a subscription that still serves the same feed is unaffected.
 */
export type CalendarDeleteImportedResult =
  | { readonly ok: true; readonly id: CalendarImportedId }
  | { readonly ok: false; readonly code: 'not-found' | 'internal-error'; readonly message: string }

/** Stable failure code for one local entry edit. */
export type CalendarEntryErrorCode =
  | 'invalid-title'
  | 'invalid-time'
  | 'invalid-range'
  | 'not-found'
  | 'readonly'
  | 'internal-error'

/**
 * Create or replace one local entry. Local entries are display records: they
 * never reach a model and never deliver a message to a Session.
 */
export interface CalendarSaveEntryRequest {
  /** Existing local entry to replace; absent creates a new entry. */
  readonly id?: CalendarEntryId
  /** Entry name of at most 200 characters, non-empty after trimming. */
  readonly title: string
  readonly summary?: string
  readonly location?: string
  /** True when the entry covers whole days, storing a display date instead of instants. */
  readonly allDay: boolean
  /** `YYYY-MM-DD` in the Host zone; required when `allDay`, rejected otherwise. */
  readonly date?: string
  /** Canonical UTC start instant; required when `allDay` is false. */
  readonly startsAt?: string
  /** Canonical UTC end instant; absent means the entry has no end. */
  readonly endsAt?: string
}

/** Local entry mutation outcome. */
export type CalendarEntryMutationResult =
  | { readonly ok: true; readonly entry: CalendarEntry }
  | { readonly ok: false; readonly code: CalendarEntryErrorCode; readonly message: string }

/** Delete request for one displayed entry. */
export interface CalendarDeleteEntryRequest {
  readonly id: string
}

/**
 * Delete outcome. An entry read from a subscription or an import is owned by
 * its source and reports `readonly`; removing the source removes its entries.
 */
export type CalendarDeleteEntryResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly code: CalendarEntryErrorCode; readonly message: string }

/** What changed since the previous frame. */
export type CalendarChangeReason =
  | 'subscription-refreshed'
  | 'subscription-updated'
  | 'subscription-deleted'
  | 'subscription-failed'
  | 'imported'
  | 'import-deleted'
  | 'entry-saved'
  | 'entry-deleted'

/** One change frame on the calendar watch stream. */
export interface CalendarChange {
  readonly reason: CalendarChangeReason
  /** Subscription the change belongs to, when the change is about one. */
  readonly subscriptionId?: CalendarSubscriptionId
  /** Canonical UTC instant the Host emitted the frame. */
  readonly at: string
}
