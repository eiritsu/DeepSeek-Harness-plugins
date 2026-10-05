/** Deployment-varying bounds for the calendar Host plugin. */
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Validated configuration for one calendar Host row. */
export interface Config {
  /** Deadline for one subscription fetch, covering connect, redirect, and body. */
  fetchTimeoutMs: Volatile<number>
  /** Largest accepted subscription response body, in bytes. */
  maxResponseBytes: Volatile<number>
  /** Refresh interval a new subscription receives when the request omits one. */
  defaultRefreshIntervalSeconds: Volatile<number>
  /** Shortest refresh interval a Client may request, in seconds. */
  minRefreshIntervalSeconds: Volatile<number>
  /** Longest refresh interval a Client may request, in seconds. */
  maxRefreshIntervalSeconds: Volatile<number>
  /** Days a subscription's fetched entries stay in the store before pruning. */
  retentionDays: Volatile<number>
  /** Largest accepted number of VEVENT components read from one feed. */
  maxEventsPerSubscription: Volatile<number>
  /** Largest accepted number of expanded occurrences produced by one VEVENT. */
  maxOccurrencesPerEvent: Volatile<number>
  /**
   * Largest accepted number of rule steps evaluated for one VEVENT. A rule
   * anchored far enough in the past to exhaust this budget contributes no
   * occurrence and is reported as dropped.
   */
  maxExpansionIterations: Volatile<number>
  /** Largest accepted number of stored occurrences one subscription or import contributes. */
  maxOccurrencesPerSubscription: Volatile<number>
  /** Days ahead of the Host clock a feed is expanded, so future occurrences exist to show. */
  expansionHorizonDays: Volatile<number>
  /** Largest accepted number of calendars kept from iCalendar text imports. */
  maxImportedCalendars: Volatile<number>
  /** Largest accepted number of entries one snapshot returns. */
  maxEntriesPerSnapshot: Volatile<number>
  /** Largest accepted number of occurrences one task contributes to a snapshot. */
  maxOccurrencesPerTask: Volatile<number>
  /** Largest accepted number of task occurrences one snapshot returns. */
  maxOccurrences: Volatile<number>
}

/** Schemastery configuration; every bound is editable from the profile patch. */
export const Config = z.object({
  fetchTimeoutMs: z.number().step(1).min(1_000).max(300_000).default(15_000).volatile(),
  maxResponseBytes: z.number().step(1).min(1_024).max(16 * 1024 * 1024).default(2 * 1024 * 1024).volatile(),
  defaultRefreshIntervalSeconds: z.number().step(1).min(300).max(86_400).default(3_600).volatile(),
  minRefreshIntervalSeconds: z.number().step(1).min(1).max(86_400).default(300).volatile(),
  maxRefreshIntervalSeconds: z.number().step(1).min(1).max(86_400).default(86_400).volatile(),
  retentionDays: z.number().step(1).min(1).max(3_650).default(90).volatile(),
  maxEventsPerSubscription: z.number().step(1).min(1).max(20_000).default(1_000).volatile(),
  maxOccurrencesPerEvent: z.number().step(1).min(1).max(10_000).default(366).volatile(),
  maxExpansionIterations: z.number().step(1).min(1).max(200_000).default(5_000).volatile(),
  maxOccurrencesPerSubscription: z.number().step(1).min(1).max(200_000).default(5_000).volatile(),
  expansionHorizonDays: z.number().step(1).min(1).max(3_650).default(180).volatile(),
  maxImportedCalendars: z.number().step(1).min(1).max(500).default(25).volatile(),
  maxEntriesPerSnapshot: z.number().step(1).min(1).max(100_000).default(5_000).volatile(),
  maxOccurrencesPerTask: z.number().step(1).min(1).max(10_000).default(400).volatile(),
  maxOccurrences: z.number().step(1).min(1).max(100_000).default(2_000).volatile(),
})
