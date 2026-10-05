/** Subscription and iCalendar import storage, refresh scheduling, and entry writes. */
import { brandString } from '@deepseek-ai/dsh-brand'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { calendarDomain } from './storage.ts'
import type { EntryRecord, SubscriptionRecord } from './storage.ts'
import { hostNow } from './clock.ts'
import { fetchIcs, parseSubscriptionUrl } from './ics-fetch.ts'
import { allDaySourceDates, occurrenceKey, parseIcs } from './ics.ts'
import type { IcsOwner, IcsParseBounds } from './ics.ts'
import type {
  CalendarAddSubscriptionRequest,
  CalendarChange,
  CalendarChangeReason,
  CalendarDeleteImportedResult,
  CalendarDeleteSubscriptionResult,
  CalendarEntryId as CalendarEntryIdType,
  CalendarFailure,
  CalendarImportIcsRequest,
  CalendarImportIcsResult,
  CalendarImportedCalendar,
  CalendarImportedId as CalendarImportedIdType,
  CalendarRefreshResult,
  CalendarSubscription,
  CalendarSubscriptionId as CalendarSubscriptionIdType,
  CalendarSubscriptionMutationResult,
  CalendarSubscriptionRef,
  CalendarUpdateSubscriptionRequest,
} from './types.ts'

/** Milliseconds in one day. */
const DAY_MS = 86_400_000

/** Longest accepted subscription or import display name, in characters. */
const MAX_NAME = 120

/**
 * Reply stored when the iCalendar parser rejects text.
 *
 * `ical.js` includes the offending source line in its own error, which could be
 * private feed content, so neither an RPC reply nor a durable failure record
 * carries it.
 */
const IMPORT_PARSE_FAILURE = 'The text could not be read as iCalendar.'

/** Reply stored when a fetched feed is not readable iCalendar; never echoes the body. */
const FEED_PARSE_FAILURE = 'The feed could not be read as iCalendar.'

/**
 * Deployment bounds the store reads through a function, so a configuration edit
 * applies from the next read instead of only at the next Host start.
 */
export interface SubscriptionBounds {
  fetchTimeoutMs(): number
  maxResponseBytes(): number
  defaultRefreshIntervalSeconds(): number
  minRefreshIntervalSeconds(): number
  maxRefreshIntervalSeconds(): number
  retentionDays(): number
  maxEventsPerSubscription(): number
  maxOccurrencesPerEvent(): number
  maxExpansionIterations(): number
  maxOccurrencesPerSubscription(): number
  expansionHorizonDays(): number
  maxImportedCalendars(): number
}

/** Notified after a subscription, import, or local entry changes. */
export type ChangeListener = (change: CalendarChange) => void

/**
 * Owns the subscription rows, the background refresh timer, and the entries a
 * fetch or an import produces.
 *
 * Fetches run concurrently, but every durable write is serialized on one chain
 * and a commit re-checks its subscription's generation inside that chain. A
 * fetch whose settings changed or whose subscription was removed while it was
 * in flight therefore cannot write its result back, and a delete cannot be
 * undone by a refresh that was already running.
 */
export class SubscriptionStore {
  private readonly listeners = new Set<ChangeListener>()
  private readonly closers = new Set<() => void>()
  private readonly generations = new Map<CalendarSubscriptionIdType, number>()
  private readonly inFlight = new Map<CalendarSubscriptionIdType, { generation: number; work: Promise<CalendarRefreshResult> }>()
  private readonly nextRunAt = new Map<CalendarSubscriptionIdType, number>()
  private readonly abort = new AbortController()
  /** Tail of the durable write chain; every link settles. */
  private commit: Promise<unknown> = Promise.resolve()
  /** Set when disposal begins so a wake-up releases every stream waiter. */
  private disposed = false
  private timer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param ctx - Host context used for logging; no subscription URL is ever logged.
   * @param domain - Open calendar domain the store owns.
   * @param bounds - Validated deployment bounds, read on each use.
   */
  constructor(
    private readonly ctx: Context,
    private readonly domain: Domain<typeof calendarDomain>,
    private readonly bounds: SubscriptionBounds,
  ) {
    this.arm()
  }

  /** Subscribe to change notifications; the returned function unsubscribes. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Whether disposal has begun; a watcher stops reading when it turns true. */
  get closed(): boolean {
    return this.disposed
  }

  /**
   * Register a wake-up run when this store disposes, so a stream waiting for a
   * change ends with the plugin instead of waiting for one that never comes.
   * @param closer - Called once during disposal.
   * @returns the function that unregisters it.
   */
  onClose(closer: () => void): () => void {
    this.closers.add(closer)
    return () => { this.closers.delete(closer) }
  }

  /**
   * Announce a change a caller committed itself, so a Client watching the
   * stream refetches after a local entry is written or removed.
   * @param reason - What the caller changed.
   * @returns nothing; a listener failure is contained by `emit`.
   */
  publish(reason: CalendarChangeReason): void {
    this.emit({ reason })
  }

  /** Every stored subscription with its live refresh state. */
  list(): CalendarSubscription[] {
    return [...this.domain.table('subscriptions').entries()]
      .map(([id, record]) => this.view(id, record))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }

  /** Every stored calendar produced by an iCalendar text import. */
  listImported(): CalendarImportedCalendar[] {
    return [...this.domain.table('imports').entries()]
      .map(([id, record]) => ({
        id,
        name: record.name,
        entryCount: this.countEntries(entry => entry.importedId === id),
        droppedEntryCount: record.droppedEntryCount,
        importedAt: record.importedAt,
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
  }

  /**
   * Store one new subscription and fetch it once.
   *
   * The returned subscription is the row as it stands after that fetch, so a
   * successful result carries the feed's failure or its first success rather
   * than promising either.
   * @param request - Subscription the Client supplied.
   * @returns the stored subscription, or the reason it was rejected.
   */
  async add(request: CalendarAddSubscriptionRequest): Promise<CalendarSubscriptionMutationResult> {
    const name = trimmedName(request.name)
    if (name === undefined) return { ok: false, code: 'invalid-url', message: `A subscription needs a name of 1 to ${MAX_NAME} characters.` }
    const target = parseSubscriptionUrl(request.url)
    if (!('ok' in target)) return { ok: false, code: target.code, message: target.message }
    const interval = request.refreshIntervalSeconds ?? this.bounds.defaultRefreshIntervalSeconds()
    const intervalFailure = this.intervalFailure(interval)
    if (intervalFailure !== undefined) return intervalFailure
    const now = hostNow()
    const id = brandString<CalendarSubscriptionIdType>(`sub-${randomUUID()}`)
    const record: SubscriptionRecord = {
      name,
      url: target.url.toString(),
      protocol: target.protocol,
      enabled: request.enabled !== false,
      refreshIntervalSeconds: interval,
      droppedEntryCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.bump(id)
    await this.serialize(async () => {
      await this.domain.table('subscriptions').put(id, record)
      this.nextRunAt.set(id, Date.now() + interval * 1_000)
    })
    this.emit({ reason: 'subscription-updated', subscriptionId: id })
    await this.refresh({ id })
    const stored = this.domain.table('subscriptions').get(id)
    return { ok: true, subscription: this.view(id, stored ?? record) }
  }

  /**
   * Update one stored subscription.
   *
   * The new configuration is stored first and a changed URL is fetched
   * afterwards, so a feed that is unreachable at its new address leaves the
   * subscription configured rather than silently reverting the address. Until
   * that fetch succeeds the subscription keeps the entries of its last
   * successful refresh and reports the failure on itself.
   * @param request - Fields the Client supplied.
   * @returns the stored subscription, or the reason the change was rejected.
   */
  async update(request: CalendarUpdateSubscriptionRequest): Promise<CalendarSubscriptionMutationResult> {
    const current = this.domain.table('subscriptions').get(request.id)
    if (current === undefined) return { ok: false, code: 'not-found', message: 'That subscription no longer exists.' }
    const name = request.name === undefined ? current.name : trimmedName(request.name)
    if (name === undefined) return { ok: false, code: 'invalid-url', message: `A subscription needs a name of 1 to ${MAX_NAME} characters.` }
    let url = current.url
    let protocol = current.protocol
    if (request.url !== undefined) {
      const target = parseSubscriptionUrl(request.url)
      if (!('ok' in target)) return { ok: false, code: target.code, message: target.message }
      url = target.url.toString()
      protocol = target.protocol
    }
    const interval = request.refreshIntervalSeconds ?? current.refreshIntervalSeconds
    const intervalFailure = this.intervalFailure(interval)
    if (intervalFailure !== undefined) return intervalFailure
    const next: SubscriptionRecord = {
      ...current,
      name,
      url,
      protocol,
      enabled: request.enabled ?? current.enabled,
      refreshIntervalSeconds: interval,
      updatedAt: hostNow(),
      // A changed address is unverified until its fetch commits, so the row
      // stops claiming the previous address was read successfully.
      ...(url === current.url ? {} : { lastRefreshedAt: undefined, lastFailure: undefined }),
    }
    this.bump(request.id)
    await this.serialize(async () => {
      await this.domain.table('subscriptions').put(request.id, next)
      this.nextRunAt.set(request.id, Date.now() + interval * 1_000)
    })
    this.emit({ reason: 'subscription-updated', subscriptionId: request.id })
    this.arm()
    if (url !== current.url) await this.refresh({ id: request.id })
    const stored = this.domain.table('subscriptions').get(request.id)
    return { ok: true, subscription: this.view(request.id, stored ?? next) }
  }

  /**
   * Remove one stored subscription and every entry it contributed.
   * @param request - Subscription the Client named.
   * @returns whether a stored subscription was removed.
   */
  async delete(request: CalendarSubscriptionRef): Promise<CalendarDeleteSubscriptionResult> {
    if (this.domain.table('subscriptions').get(request.id) === undefined) {
      return { ok: false, code: 'not-found', message: 'That subscription no longer exists.' }
    }
    // The generation moves before the write is queued, so a fetch already in
    // flight fails its commit instead of resurrecting the removed rows.
    this.bump(request.id)
    this.nextRunAt.delete(request.id)
    await this.serialize(async () => {
      await this.domain.table('subscriptions').delete(request.id)
      await this.removeEntries(entry => entry.subscriptionId === request.id)
    })
    this.emit({ reason: 'subscription-deleted', subscriptionId: request.id })
    return { ok: true, id: request.id }
  }

  /**
   * Fetch one subscription now.
   *
   * A refresh already running for the same subscription under the same
   * configuration is joined rather than duplicated. A refresh started before
   * the configuration changed is not joined: the new configuration needs its
   * own fetch, and the old one is discarded when its commit finds the
   * generation moved.
   * @param request - Subscription the Client named.
   * @returns the refreshed subscription, or the reason the fetch failed.
   */
  async refresh(request: CalendarSubscriptionRef): Promise<CalendarRefreshResult> {
    const generation = this.generationOf(request.id)
    const running = this.inFlight.get(request.id)
    if (running !== undefined && running.generation === generation) return running.work
    const work = this.runRefresh(request.id, generation, this.abort.signal)
    this.inFlight.set(request.id, { generation, work })
    this.emit({ reason: 'subscription-updated', subscriptionId: request.id })
    try {
      return await work
    } finally {
      if (this.inFlight.get(request.id)?.work === work) this.inFlight.delete(request.id)
    }
  }

  /**
   * Parse iCalendar text the user already has into a stored calendar.
   * @param request - Import the Client supplied.
   * @returns the stored calendar, or the reason it was rejected.
   */
  async importIcs(request: CalendarImportIcsRequest): Promise<CalendarImportIcsResult> {
    const name = trimmedName(request.name)
    if (name === undefined) return { ok: false, code: 'invalid-name', message: `A calendar needs a name of 1 to ${MAX_NAME} characters.` }
    const text = typeof request.ics === 'string' ? request.ics : ''
    if (text === '') return { ok: false, code: 'invalid-ics', message: 'The imported text is empty.' }
    if (Buffer.byteLength(text, 'utf8') > this.bounds.maxResponseBytes()) {
      return { ok: false, code: 'response-too-large', message: 'The imported text is larger than the configured limit.' }
    }
    if (this.domain.table('imports').size >= this.bounds.maxImportedCalendars()) {
      return { ok: false, code: 'internal-error', message: `This profile already stores the configured maximum of ${this.bounds.maxImportedCalendars()} imported calendars.` }
    }
    const id = brandString<CalendarImportedIdType>(`imp-${randomUUID()}`)
    const owner: IcsOwner = { origin: 'import', ownerId: id }
    let parsed: ReturnType<typeof parseIcs>
    try {
      parsed = parseIcs(text, this.parseBounds())
    } catch {
      return { ok: false, code: 'invalid-ics', message: IMPORT_PARSE_FAILURE }
    }
    if (parsed.unsupportedZone !== undefined) {
      return { ok: false, code: 'invalid-ics', message: parsed.unsupportedZone }
    }
    const importedAt = hostNow()
    const written = await this.serialize(() => this.replaceEntries(owner, parsed.occurrences))
    const droppedEntryCount = parsed.droppedEvents + parsed.droppedOccurrences + written.dropped
    await this.serialize(async () => {
      await this.domain.table('imports').put(id, { name, importedAt, droppedEntryCount })
    })
    this.emit({ reason: 'imported' })
    return { ok: true, calendar: { id, name, entryCount: written.written, droppedEntryCount, importedAt } }
  }

  /**
   * Remove one imported calendar and every entry it contributed.
   * @param id - Imported calendar the Client named.
   * @returns whether a stored import was removed.
   */
  async deleteImported(id: CalendarImportedIdType): Promise<CalendarDeleteImportedResult> {
    if (this.domain.table('imports').get(id) === undefined) {
      return { ok: false, code: 'not-found', message: 'That imported calendar no longer exists.' }
    }
    await this.serialize(async () => {
      await this.removeEntries(entry => entry.importedId === id)
      await this.domain.table('imports').delete(id)
    })
    this.emit({ reason: 'import-deleted' })
    return { ok: true, id }
  }

  /**
   * Stop the refresh timer, abort every fetch in flight, wait for the durable
   * write chain and the outstanding fetches, and release every listener, so no
   * timer, request, or stream outlives the plugin.
   * @returns resolution after the in-flight work settled.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.nextRunAt.clear()
    this.abort.abort()
    for (const closer of this.closers) closer()
    await Promise.allSettled([...this.inFlight.values()].map(entry => entry.work))
    await this.commit.then(() => undefined, () => undefined)
    this.closers.clear()
    this.listeners.clear()
  }

  /**
   * Perform one fetch, expansion, and serialized commit.
   * @param id - Subscription being refreshed.
   * @param generation - Configuration generation this fetch belongs to.
   * @param signal - Cancellation shared by every fetch this store owns.
   * @returns the refreshed subscription, or the reason the fetch failed.
   */
  private async runRefresh(
    id: CalendarSubscriptionIdType,
    generation: number,
    signal: AbortSignal,
  ): Promise<CalendarRefreshResult> {
    const record = this.domain.table('subscriptions').get(id)
    if (record === undefined) return { ok: false, id, code: 'not-found', message: 'That subscription no longer exists.' }
    const target = parseSubscriptionUrl(record.url)
    if (!('ok' in target)) {
      await this.recordFailure(id, record, generation, { code: target.code, message: target.message })
      return { ok: false, id, code: target.code, message: target.message }
    }
    let text: string
    try {
      const fetched = await fetchIcs(
        target.url,
        { timeoutMs: this.bounds.fetchTimeoutMs(), maxBytes: this.bounds.maxResponseBytes() },
        signal,
      )
      if (!fetched.ok) {
        if (this.generationOf(id) === generation) {
          await this.recordFailure(id, record, generation, { code: fetched.code, message: fetched.message })
          this.emit({ reason: 'subscription-failed', subscriptionId: id })
        }
        return { ok: false, id, code: fetched.code, message: fetched.message }
      }
      text = fetched.text
    } catch (error: unknown) {
      // The only rejection path is caller cancellation, which is this store's
      // own teardown: a cancelled fetch must not record a failure row.
      throw error
    }
    let parsed: ReturnType<typeof parseIcs>
    try {
      parsed = parseIcs(text, this.parseBounds())
    } catch {
      if (this.generationOf(id) === generation) {
        await this.recordFailure(id, record, generation, { code: 'invalid-ics', message: FEED_PARSE_FAILURE })
        this.emit({ reason: 'subscription-failed', subscriptionId: id })
      }
      return { ok: false, id, code: 'invalid-ics', message: FEED_PARSE_FAILURE }
    }
    if (parsed.unsupportedZone !== undefined) {
      const message = parsed.unsupportedZone
      if (this.generationOf(id) === generation) {
        await this.recordFailure(id, record, generation, { code: 'invalid-ics', message })
        this.emit({ reason: 'subscription-failed', subscriptionId: id })
      }
      return { ok: false, id, code: 'invalid-ics', message }
    }
    const owner: IcsOwner = { origin: 'subscription', ownerId: id }
    const written = await this.serialize(async () => {
      if (this.generationOf(id) !== generation) {
        // The settings changed or the subscription was removed while this
        // fetch ran; the newer configuration owns the next fetch.
        return { written: 0, dropped: 0, stale: true }
      }
      const replaced = await this.replaceEntries(owner, parsed.occurrences)
      const at = hostNow()
      await this.domain.table('subscriptions').put(id, {
        ...record,
        lastRefreshedAt: at,
        // A success clears the previous failure; keeping it would report a
        // resolved outage as current.
        lastFailure: undefined,
        droppedEntryCount: parsed.droppedEvents + parsed.droppedOccurrences + replaced.dropped,
        updatedAt: at,
      })
      this.nextRunAt.set(id, Date.now() + record.refreshIntervalSeconds * 1_000)
      return { ...replaced, stale: false }
    })
    if (written.stale) {
      return { ok: false, id, code: 'service-unavailable', message: 'The subscription changed while it was being fetched.' }
    }
    this.arm()
    this.emit({ reason: 'subscription-refreshed', subscriptionId: id })
    const stored = this.domain.table('subscriptions').get(id)
    return {
      ok: true,
      subscription: this.view(id, stored ?? { ...record, lastRefreshedAt: hostNow() }),
      entryCount: written.written,
      droppedEntryCount: parsed.droppedEvents + parsed.droppedOccurrences + written.dropped,
    }
  }

  /**
   * Store one failure on a subscription without discarding its last good data.
   *
   * The row is re-read inside the commit chain, so a settings change that
   * landed while the fetch ran is not overwritten with the old configuration.
   * @param id - Subscription whose fetch failed.
   * @param record - Row read before the fetch.
   * @param generation - Configuration generation the failed fetch belongs to.
   * @param failure - Code and message to show.
   * @returns resolution after the failure is durable.
   */
  private async recordFailure(
    id: CalendarSubscriptionIdType,
    record: SubscriptionRecord,
    generation: number,
    failure: Omit<CalendarFailure, 'at'>,
  ): Promise<void> {
    const at = hostNow()
    await this.serialize(async () => {
      if (this.generationOf(id) !== generation) return
      const current = this.domain.table('subscriptions').get(id)
      if (current === undefined) return
      this.nextRunAt.set(id, Date.now() + current.refreshIntervalSeconds * 1_000)
      await this.domain.table('subscriptions').put(id, { ...current, lastFailure: { ...failure, at }, updatedAt: at })
    })
    // The display name is the only subscription field a log line may carry.
    this.ctx.logger.warn(`calendar: subscription "${record.name}" refresh failed (${failure.code}): ${failure.message}`)
  }

  /**
   * Replace every entry one source owns with the occurrences just read, so a
   * deletion or a cancellation upstream disappears on the next refresh.
   * @param owner - Source whose entries are replaced.
   * @param occurrences - Normalized occurrences from the parsed document.
   * @returns the number of rows written and how many the ceiling rejected.
   */
  private async replaceEntries(
    owner: IcsOwner,
    occurrences: ReturnType<typeof parseIcs>['occurrences'],
  ): Promise<{ readonly written: number; readonly dropped: number }> {
    const predicate = owner.origin === 'subscription'
      ? (entry: EntryRecord) => entry.origin === 'subscription' && entry.subscriptionId === owner.ownerId
      : (entry: EntryRecord) => entry.origin === 'import' && entry.importedId === owner.ownerId
    await this.removeEntries(predicate)
    const table = this.domain.table('entries')
    const now = hostNow()
    const budget = this.bounds.maxOccurrencesPerSubscription()
    let written = 0
    let dropped = 0
    for (const occurrence of occurrences) {
      for (const date of allDaySourceDates(occurrence, budget - written)) {
        if (written >= budget) { dropped += 1; continue }
        const key = brandString<CalendarEntryIdType>(occurrenceKey(owner, occurrence, date))
        const row: EntryRecord = {
          origin: owner.origin,
          ...(owner.origin === 'subscription'
            ? { subscriptionId: brandString<CalendarSubscriptionIdType>(owner.ownerId) }
            : { importedId: brandString<CalendarImportedIdType>(owner.ownerId) }),
          ...(occurrence.color === undefined ? {} : { color: occurrence.color }),
          title: occurrence.title,
          ...(occurrence.summary === undefined ? {} : { summary: occurrence.summary }),
          ...(occurrence.location === undefined ? {} : { location: occurrence.location }),
          allDay: occurrence.allDay,
          date,
          startsAt: occurrence.allDay ? `${date}T00:00:00.000Z` : occurrence.startsAt,
          ...(occurrence.allDay
            ? { endsAt: new Date(Date.parse(`${date}T00:00:00.000Z`) + DAY_MS).toISOString() }
            : occurrence.endsAt === undefined ? {} : { endsAt: occurrence.endsAt }),
          recurring: occurrence.recurring,
          storedAt: now,
        }
        await table.put(key, row)
        written += 1
      }
    }
    return { written, dropped }
  }

  /**
   * Delete every entry row matching a predicate.
   * @param predicate - Selects the rows to remove.
   * @returns resolution after the rows are durable.
   */
  private async removeEntries(predicate: (entry: EntryRecord) => boolean): Promise<void> {
    const table = this.domain.table('entries')
    for (const [key, entry] of table.entries()) {
      if (predicate(entry)) await table.delete(key)
    }
  }

  /**
   * Count the stored entries matching a predicate.
   * @param predicate - Selects the rows to count.
   * @returns the number of matching rows.
   */
  private countEntries(predicate: (entry: EntryRecord) => boolean): number {
    let count = 0
    for (const [, entry] of this.domain.table('entries').entries()) {
      if (predicate(entry)) count += 1
    }
    return count
  }

  /**
   * Project one stored subscription into the value a Client renders.
   * @param id - Table key, which is the subscription identity.
   * @param record - Stored subscription row.
   * @returns the Client-facing subscription with its live entry count.
   */
  private view(id: CalendarSubscriptionIdType, record: SubscriptionRecord): CalendarSubscription {
    return {
      id,
      name: record.name,
      url: record.url,
      protocol: record.protocol,
      enabled: record.enabled,
      refreshIntervalSeconds: record.refreshIntervalSeconds,
      ...(record.lastRefreshedAt === undefined ? {} : { lastRefreshedAt: record.lastRefreshedAt }),
      ...(record.lastFailure === undefined ? {} : { lastFailure: record.lastFailure }),
      entryCount: this.countEntries(entry => entry.origin === 'subscription' && entry.subscriptionId === id),
      droppedEntryCount: record.droppedEntryCount,
      refreshing: this.inFlight.has(id),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  /** Expansion window and accepted limits shared by fetches and imports. */
  private parseBounds(): IcsParseBounds {
    const now = Date.now()
    return {
      from: now - this.bounds.retentionDays() * DAY_MS,
      to: now + this.bounds.expansionHorizonDays() * DAY_MS,
      maxEvents: this.bounds.maxEventsPerSubscription(),
      // One configured number bounds both the parsed occurrences and the rows
      // they become, because a whole-day occurrence can cover many dates.
      maxOccurrences: this.bounds.maxOccurrencesPerSubscription(),
      maxOccurrencesPerEvent: this.bounds.maxOccurrencesPerEvent(),
      maxExpansionIterations: this.bounds.maxExpansionIterations(),
    }
  }

  /**
   * Reject a refresh interval outside the configured range.
   * @param seconds - Interval the Client requested.
   * @returns the failure value, or undefined when the interval is accepted.
   */
  private intervalFailure(seconds: number): { readonly ok: false; readonly code: 'invalid-url'; readonly message: string } | undefined {
    const min = this.bounds.minRefreshIntervalSeconds()
    const max = this.bounds.maxRefreshIntervalSeconds()
    if (seconds < min || seconds > max) {
      return { ok: false, code: 'invalid-url', message: `A refresh interval must be between ${min} and ${max} seconds.` }
    }
    return undefined
  }

  /**
   * Read a subscription's configuration generation.
   *
   * A subscription restored from storage has no entry yet, so the missing key
   * and generation zero are the same value on both sides of every comparison.
   * @param id - Subscription to read.
   * @returns its current generation.
   */
  private generationOf(id: CalendarSubscriptionIdType): number {
    return this.generations.get(id) ?? 0
  }

  /**
   * Move a subscription's generation forward so an in-flight fetch started
   * under the old configuration cannot write over the new one.
   * @param id - Subscription whose configuration changed.
   */
  private bump(id: CalendarSubscriptionIdType): void {
    this.generations.set(id, this.generationOf(id) + 1)
  }

  /**
   * Run one durable write on the store's single chain, so a commit never
   * interleaves with a delete or a settings change.
   * @param work - The write to perform at its queue slot.
   * @returns the write's result, or a rejection once the store is stopping.
   */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('The calendar store is stopping'))
    const pending = this.commit.then(work)
    this.commit = pending.then(() => undefined, () => undefined)
    return pending
  }

  /**
   * Arm the single refresh timer for the earliest due subscription.
   * @returns nothing; the timer is stored on this store.
   */
  private arm(): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const now = Date.now()
    let earliest = Number.POSITIVE_INFINITY
    for (const [id, record] of this.domain.table('subscriptions').entries()) {
      if (!record.enabled) continue
      const due = this.nextRunAt.get(id) ?? now
      this.nextRunAt.set(id, due)
      if (due < earliest) earliest = due
    }
    if (!Number.isFinite(earliest)) return
    this.timer = setTimeout(() => { void this.tick() }, Math.max(0, earliest - now))
  }

  /**
   * Refresh every subscription whose interval elapsed, then rearm the timer.
   * @returns resolution after the due refreshes settled.
   */
  private async tick(): Promise<void> {
    const now = Date.now()
    const due: CalendarSubscriptionIdType[] = []
    for (const [id, at] of this.nextRunAt) {
      if (at <= now) due.push(id)
    }
    for (const id of due) {
      if (this.disposed) return
      await this.refresh({ id }).catch((error: unknown) => {
        this.ctx.logger.warn(`calendar: scheduled refresh failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    this.arm()
  }

  /**
   * Publish one change frame to every listener.
   * @param change - What changed, without its timestamp.
   * @returns nothing; a listener failure is contained here.
   */
  private emit(change: Omit<CalendarChange, 'at'>): void {
    const frame: CalendarChange = { ...change, at: hostNow() }
    for (const listener of this.listeners) {
      try {
        listener(frame)
      } catch (error: unknown) {
        this.ctx.logger.warn(`calendar: a change listener failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}

/**
 * Normalize a display name the Client supplied.
 * @param value - Raw name text.
 * @returns the trimmed name, or undefined when it is missing or over-long.
 */
function trimmedName(value: string): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed === '' || trimmed.length > MAX_NAME ? undefined : trimmed
}
