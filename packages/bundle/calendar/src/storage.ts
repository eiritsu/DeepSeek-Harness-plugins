/** Durable calendar state: subscriptions, entries, and text imports. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { CalendarEntryId, CalendarImportedId, CalendarSubscriptionId } from './types.ts'
import type { CalendarFailure, CalendarSubscriptionProtocol } from './types.ts'

const subscriptionIdSchema = z.string().min(1).transform(value => brandString<CalendarSubscriptionId>(value))
const importedIdSchema = z.string().min(1).transform(value => brandString<CalendarImportedId>(value))

/** Canonical UTC instant the Host wrote; an entry older than its owner's retention is pruned. */
const instantSchema = z.string().min(1)

/** `YYYY-MM-DD` display date rendered in the snapshot's zone. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

const failureSchema = z.object({
  code: z.enum([
    'invalid-url', 'unsupported-protocol', 'not-found', 'request-failed', 'timeout',
    'response-too-large', 'redirect-rejected', 'invalid-ics', 'service-unavailable', 'internal-error',
  ]),
  message: z.string().min(1),
  at: instantSchema,
}).strict()

/** One stored subscription. The URL is shown only on the configuration page and never reaches a log line. */
export const subscriptionRecordSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().min(1),
  protocol: z.enum(['https', 'http']),
  enabled: z.boolean(),
  // The accepted range is the deployment's configuration, validated on the
  // write path rather than here, so a tighter bound never refuses its own row.
  refreshIntervalSeconds: z.number().int().min(1),
  lastRefreshedAt: instantSchema.optional(),
  lastFailure: failureSchema.optional(),
  /** Occurrences the bounds rejected during the last successful fetch. */
  droppedEntryCount: z.number().int().min(0).default(0),
  createdAt: instantSchema,
  updatedAt: instantSchema,
}).strict()

/** One stored subscription row. */
export type SubscriptionRecord = z.infer<typeof subscriptionRecordSchema>

/**
 * One stored entry. Subscription and import rows are owned by their source and
 * are replaced wholesale on a successful refresh or a repeated import.
 */
export const entryRecordSchema = z.object({
  origin: z.enum(['local', 'subscription', 'import']),
  subscriptionId: subscriptionIdSchema.optional(),
  importedId: importedIdSchema.optional(),
  color: z.string().min(1).max(64).optional(),
  title: z.string().min(1).max(500),
  summary: z.string().max(4_000).optional(),
  location: z.string().max(500).optional(),
  allDay: z.boolean(),
  date: dateSchema,
  /** Every writer stores a start instant; a whole-day entry uses its date's UTC midnight. */
  startsAt: instantSchema,
  endsAt: instantSchema.optional(),
  recurring: z.boolean(),
  storedAt: instantSchema,
}).strict().refine(entry => entry.allDay || entry.endsAt === undefined || entry.endsAt > entry.startsAt, {
  message: 'A timed entry must end after it starts',
})

/** One stored entry row. */
export type EntryRecord = z.infer<typeof entryRecordSchema>

/** One calendar produced by an iCalendar text import. */
export const importedRecordSchema = z.object({
  name: z.string().min(1).max(120),
  importedAt: instantSchema,
  droppedEntryCount: z.number().int().min(0),
}).strict()

/** One stored import row. */
export type ImportedRecord = z.infer<typeof importedRecordSchema>

/**
 * Authoritative calendar storage. A malformed row rejects opening the domain
 * rather than silently dropping a user's calendar.
 */
export const calendarDomain = defineDomain({
  name: 'calendar',
  version: 1,
  tables: {
    subscriptions: domainTable<CalendarSubscriptionId, SubscriptionRecord>(subscriptionRecordSchema),
    entries: domainTable<CalendarEntryId, EntryRecord>(entryRecordSchema),
    imports: domainTable<CalendarImportedId, ImportedRecord>(importedRecordSchema),
  },
})

/** Failure carried on a stored subscription row. */
export type StoredFailure = CalendarFailure

/** Protocol carried on a stored subscription row. */
export type StoredProtocol = CalendarSubscriptionProtocol
