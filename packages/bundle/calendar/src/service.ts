/** Calendar Remote service: schedule delegation, entry reads, and subscription management. */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ScheduleInputError } from '@deepseek-ai/dsh-schedule'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import type { ScheduleCatalogEntry } from '@deepseek-ai/dsh-schedule/client'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { MAX_CALENDAR_RANGE_DAYS, MIN_CALENDAR_RANGE_MINUTES } from './client-api.ts'
import { Config } from './config.ts'
import { hostNow, hostTimeZone, isSupportedTimeZone } from './clock.ts'
import { deleteEntry, resolveEntries, saveLocalEntry } from './entries.ts'
import { calendarDomain } from './storage.ts'
import { SubscriptionStore } from './subscriptions.ts'
import { SCHEDULE_UNAVAILABLE_MESSAGE, asScheduleId, deriveOccurrences, scheduleService, toTask } from './tasks.ts'
import type {
  CalendarAddSubscriptionRequest,
  CalendarChange,
  CalendarCreateTaskRequest,
  CalendarCreateTaskResult,
  CalendarDeleteEntryRequest,
  CalendarDeleteEntryResult,
  CalendarDeleteImportedRequest,
  CalendarDeleteImportedResult,
  CalendarDeleteSubscriptionResult,
  CalendarDeleteTaskRequest,
  CalendarDeleteTaskResult,
  CalendarEntryId as CalendarEntryIdType,
  CalendarEntryMutationResult,
  CalendarImportIcsRequest,
  CalendarImportIcsResult,
  CalendarRefreshResult,
  CalendarSaveEntryRequest,
  CalendarSelectableSession,
  CalendarSnapshot,
  CalendarSnapshotRequest,
  CalendarSubscription,
  CalendarSubscriptionMutationResult,
  CalendarSubscriptionRef,
  CalendarTaskErrorCode,
  CalendarUpdateSubscriptionRequest,
  CalendarUpdateTaskRequest,
  CalendarUpdateTaskResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    calendar: CalendarService
  }
}

/**
 * Remote service behind the calendar page.
 *
 * Automations are read and written through the Host Schedule service, so a task
 * the model created with `schedule_create` and a task a person created here are
 * the same stored row. The Schedule service is optional in a profile: when it is
 * absent every task method reports `service-unavailable` and the page still
 * shows local entries, imports, and subscriptions.
 */
export class CalendarService extends TypertRemoteService {
  static inject = ['sessions', 'storageDomain']
  static Config = Config

  private readonly ready: Promise<Domain<typeof calendarDomain>>
  private readonly initialized: PromiseLike<unknown>
  private store: SubscriptionStore | undefined
  /** Live configuration values; every field is re-read so a config edit applies at once. */
  private readonly bounds: Config

  /**
   * @param ctx - Host services owning the Session store and durable storage.
   * @param config - Validated deployment bounds for fetches, expansion, and retention.
   */
  constructor(ctx: Context, config: Config) {
    // The Typert compiler reads the Gateway service key as a literal, so the
    // namespace is written here rather than imported from the Client module.
    super(ctx, 'calendar')
    this.bounds = config
    this.ready = ctx.storageDomain.open(calendarDomain)
    this.initialized = ctx.effect(async () => {
      const domain = await this.ready
      let cleanup: () => Promise<void>
      try {
        cleanup = ctx.effect(() => async () => {
          const store = this.store
          this.store = undefined
          // The refresh timer reads and writes the domain, so it stops and its
          // fetches settle before the domain closes; the reverse order leaves a
          // timer touching a closed store.
          await store?.dispose()
          await domain.close()
        })
      } catch (error: unknown) {
        await domain.close()
        throw error
      }
      // Every bound is read through a function, so a configuration edit takes
      // effect from the next read rather than only at the next Host start.
      this.store = new SubscriptionStore(ctx, domain, {
        fetchTimeoutMs: () => config.fetchTimeoutMs.get(),
        maxResponseBytes: () => config.maxResponseBytes.get(),
        defaultRefreshIntervalSeconds: () => config.defaultRefreshIntervalSeconds.get(),
        minRefreshIntervalSeconds: () => config.minRefreshIntervalSeconds.get(),
        maxRefreshIntervalSeconds: () => config.maxRefreshIntervalSeconds.get(),
        retentionDays: () => config.retentionDays.get(),
        maxEventsPerSubscription: () => config.maxEventsPerSubscription.get(),
        maxOccurrencesPerEvent: () => config.maxOccurrencesPerEvent.get(),
        maxExpansionIterations: () => config.maxExpansionIterations.get(),
        maxOccurrencesPerSubscription: () => config.maxOccurrencesPerSubscription.get(),
        expansionHorizonDays: () => config.expansionHorizonDays.get(),
        maxImportedCalendars: () => config.maxImportedCalendars.get(),
      })
      if (scheduleService(ctx) === undefined) ctx.logger.warn(SCHEDULE_UNAVAILABLE_MESSAGE)
      return cleanup
    })
  }

  async [Service.init](): Promise<void> {
    await this.initialized
  }

  /**
   * Read everything the calendar shows for one range.
   * @param request - Inclusive range and the zone all-day dates are rendered in.
   * @returns the Host clock, zone, tasks, occurrences, entries, and subscription state.
   * @throws Error when the range or zone is outside the accepted bounds.
   */
  @Remote('snapshot')
  async snapshot(request: CalendarSnapshotRequest): Promise<CalendarSnapshot> {
    const from = Date.parse(request.rangeStart)
    const to = Date.parse(request.rangeEnd)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      throw new Error('A calendar range needs a start and a later exclusive end as UTC calendar instants.')
    }
    const minutes = (to - from) / 60_000
    if (minutes < MIN_CALENDAR_RANGE_MINUTES || minutes > MAX_CALENDAR_RANGE_DAYS * 24 * 60) {
      throw new Error(`A calendar range must cover ${MIN_CALENDAR_RANGE_MINUTES} minute to ${MAX_CALENDAR_RANGE_DAYS} days.`)
    }
    const hostZone = hostTimeZone()
    const zone = request.timeZone ?? hostZone
    if (!isSupportedTimeZone(zone)) throw new Error(`"${zone}" is not a time zone this runtime can render.`)
    const config = this.bounds
    const domain = await this.domain()
    const service = scheduleService(this.ctx)
    const catalog: ScheduleCatalogEntry[] = service === undefined ? [] : await service.catalog()
    const derived = deriveOccurrences(catalog, from, to, {
      perTask: config.maxOccurrencesPerTask.get(),
      total: config.maxOccurrences.get(),
    })
    const entries = resolveEntries(domain, from, to, zone, config.maxEntriesPerSnapshot.get())
    const store = this.requireStore()
    return {
      now: hostNow(),
      hostTimeZone: hostZone,
      timeZone: zone,
      range: { start: request.rangeStart, end: request.rangeEnd },
      tasks: catalog.map(entry => toTask(entry, derived.errors.get(entry.id))),
      occurrences: derived.occurrences,
      occurrencesTruncated: derived.truncated,
      entries: entries.entries,
      entriesTruncated: entries.truncated,
      subscriptions: store.list(),
      importedCalendars: store.listImported(),
      selectableSessions: await this.selectableSessions(),
      serviceAvailable: service !== undefined,
    }
  }

  /**
   * List the Sessions a new automation may be bound to.
   *
   * The directory matches what the Workspace browser shows: subagent Sessions
   * and Sessions the user archived are never targets, so a reminder can never
   * be created for a lineage the UI hides. The Session controller's list reads
   * the persisted index, so a cold ordinary Session the Host has not restored
   * still appears. Activation is not required: the Host Schedule service
   * resolves and restores a cold Session itself when the reminder comes due,
   * so an automation created here is delivered on time while the application
   * runs. An application that is not running delivers nothing, and a reminder
   * that came due while it was closed is delivered when it starts again.
   *
   * The live fallback is filtered by the same rules, so a live subagent or
   * archived Session cannot re-enter the directory just because it is loaded.
   * @returns every selectable Session, most recently active first.
   */
  private async selectableSessions(): Promise<CalendarSelectableSession[]> {
    const live = new Set<string>()
    for (const session of this.ctx.sessions.list()) {
      if (session.header.origin === 'subagent') continue
      live.add(session.id)
    }
    const controller = this.ctx.get('sessionController')
    if (controller === undefined) {
      const archived = this.archivedSessionIds()
      return [...live]
        .filter(id => !archived.has(id))
        .map(id => ({ id, live: true, updatedAt: 0, blank: true }))
    }
    const listed = await controller.list({}, AbortSignal.timeout(5_000))
    // Read the archive set after the list completes: a Session archived while
    // the read was pending must not come back as a selectable target.
    const archived = this.archivedSessionIds()
    const sessions: CalendarSelectableSession[] = listed.items
      .filter(item => item.origin !== 'subagent' && !archived.has(item.sessionId))
      .map(item => ({
        id: item.sessionId,
        live: live.has(item.sessionId),
        ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
        updatedAt: item.updatedAt,
        blank: item.blank,
      }))
    for (const id of live) {
      if (archived.has(id)) continue
      if (!sessions.some(session => session.id === id)) sessions.push({ id, live: true, updatedAt: 0, blank: true })
    }
    return sessions.sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
  }

  /** Session ids the user archived, read from the optional Workspace registry. */
  private archivedSessionIds(): ReadonlySet<string> {
    return new Set<string>(this.ctx.get('workspaceRegistry')?.archivedSessionIds ?? [])
  }

  /**
   * Create one automation bound to an explicit Session.
   *
   * The Session must be one the Host can see: a reminder is delivered into a
   * Session's inbox, so a Session this Harness does not list can never receive
   * one. The Host Schedule service restores the Session at the due time, so the
   * caller does not have to open it first. This method is Host-only in the
   * Schedule service, which is why the calendar owns the validated Remote entry
   * for it.
   * @param request - Session binding, title, instruction, and one timing selector.
   * @returns the committed task, or the reason it was not created.
   */
  @Remote('createTask')
  async createTask(request: CalendarCreateTaskRequest): Promise<CalendarCreateTaskResult> {
    const service = scheduleService(this.ctx)
    if (service === undefined) return unavailable()
    const sessionId = brandString<SessionId>(request.sessionId)
    const selectable = (await this.selectableSessions()).some(session => session.id === request.sessionId)
    if (!selectable) {
      return {
        ok: false,
        code: 'session_not_found',
        message: 'That Session is not listed by this Harness, so a reminder could never reach it. Pick a listed Session.',
      }
    }
    const selectors = (['at', 'after_seconds', 'every_seconds', 'daily', 'weekly', 'cron'] as const)
      .filter(name => request[name] !== undefined)
    if (selectors.length !== 1) {
      return { ok: false, code: 'invalid_selector', message: 'Exactly one reminder timing must be selected.' }
    }
    try {
      const record = await service.create(sessionId, {
        title: request.title,
        prompt: request.prompt,
        ...(request.at === undefined ? {} : { at: request.at }),
        ...(request.after_seconds === undefined ? {} : { after_seconds: request.after_seconds }),
        ...(request.every_seconds === undefined ? {} : { every_seconds: request.every_seconds }),
        ...(request.daily === undefined ? {} : { daily: request.daily }),
        ...(request.weekly === undefined ? {} : { weekly: request.weekly }),
        ...(request.cron === undefined ? {} : { cron: request.cron }),
      })
      const catalog = await service.catalog()
      const created = catalog.find(entry => entry.id === record.id)
      if (created === undefined) {
        return { ok: false, code: 'internal_error', message: 'The created task is not readable from the catalog.' }
      }
      return { ok: true, task: toTask(created) }
    } catch (error: unknown) {
      return inputFailure(error)
    }
  }

  /**
   * Update one task's name, instruction, or timing.
   * @param request - Task binding, the record the Client committed, and the change.
   * @returns the committed task, or the reason nothing changed.
   */
  @Remote('updateTask')
  async updateTask(request: CalendarUpdateTaskRequest): Promise<CalendarUpdateTaskResult> {
    const service = scheduleService(this.ctx)
    if (service === undefined) return unavailable()
    try {
      const result = await service.update({
        sessionId: brandString<SessionId>(request.sessionId),
        id: asScheduleId(request.id),
        expected: request.expected,
        ...(request.title === undefined ? {} : { title: request.title }),
        ...(request.prompt === undefined ? {} : { prompt: request.prompt }),
        ...(request.change === undefined ? {} : { change: request.change }),
      })
      if (!('record' in result)) {
        return { ok: false, code: result.code, message: describeUpdateMiss(result.code) }
      }
      const catalog = await service.catalog()
      const updated = catalog.find(entry => entry.id === request.id)
      if (updated === undefined) {
        return { ok: false, code: 'internal_error', message: 'The updated task is not readable from the catalog.' }
      }
      return { ok: true, task: toTask(updated) }
    } catch (error: unknown) {
      return inputFailure(error)
    }
  }

  /**
   * Delete one task.
   * @param request - Task binding and identity.
   * @returns whether that Session owned a deleted task.
   */
  @Remote('deleteTask')
  async deleteTask(request: CalendarDeleteTaskRequest): Promise<CalendarDeleteTaskResult> {
    const service = scheduleService(this.ctx)
    if (service === undefined) return unavailable()
    const id = asScheduleId(request.id)
    const result = await service.delete({ sessionId: brandString<SessionId>(request.sessionId), id })
    return result.deleted
      ? { ok: true, id }
      : { ok: false, code: 'schedule_not_found', message: 'That task no longer exists.' }
  }

  /**
   * Every stored subscription with its live refresh state.
   * @returns the stored subscriptions, sorted by display name.
   */
  @Remote('listSubscriptions')
  listSubscriptions(): CalendarSubscription[] {
    return this.requireStore().list()
  }

  /**
   * Store one user-supplied iCalendar subscription and fetch it once.
   * @param request - Name and URL the user supplied.
   * @returns the stored subscription, or the reason it was rejected.
   */
  @Remote('addSubscription')
  async addSubscription(request: CalendarAddSubscriptionRequest): Promise<CalendarSubscriptionMutationResult> {
    return this.requireStore().add(request)
  }

  /**
   * Update one stored subscription; a changed URL is fetched before it commits.
   * @param request - Fields the Client supplied.
   * @returns the stored subscription, or the reason the change was rejected.
   */
  @Remote('updateSubscription')
  async updateSubscription(request: CalendarUpdateSubscriptionRequest): Promise<CalendarSubscriptionMutationResult> {
    return this.requireStore().update({ ...request, id: brandString(request.id) })
  }

  /**
   * Remove one subscription and every entry it contributed.
   * @param request - Subscription the Client named.
   * @returns whether a stored subscription was removed.
   */
  @Remote('deleteSubscription')
  async deleteSubscription(request: CalendarSubscriptionRef): Promise<CalendarDeleteSubscriptionResult> {
    return this.requireStore().delete({ id: brandString(request.id) })
  }

  /**
   * Fetch one subscription now.
   * @param request - Subscription the Client named.
   * @returns the refreshed subscription, or the reason the fetch failed.
   */
  @Remote('refreshSubscription')
  async refreshSubscription(request: CalendarSubscriptionRef): Promise<CalendarRefreshResult> {
    return this.requireStore().refresh({ id: brandString(request.id) })
  }

  /**
   * Parse iCalendar text the user already has into a stored calendar.
   * @param request - Name and iCalendar text.
   * @returns the stored calendar, or the reason it was rejected.
   */
  @Remote('importIcs')
  async importIcs(request: CalendarImportIcsRequest): Promise<CalendarImportIcsResult> {
    return this.requireStore().importIcs(request)
  }

  /**
   * Remove one imported calendar and every entry it contributed.
   * @param request - Imported calendar the Client named.
   * @returns whether a stored import was removed.
   */
  @Remote('deleteImported')
  async deleteImported(request: CalendarDeleteImportedRequest): Promise<CalendarDeleteImportedResult> {
    return this.requireStore().deleteImported(brandString(request.id))
  }

  /**
   * Create or replace one local entry.
   * @param request - Entry the Client supplied.
   * @returns the committed entry, or the reason it was rejected.
   */
  @Remote('saveEntry')
  async saveEntry(request: CalendarSaveEntryRequest): Promise<CalendarEntryMutationResult> {
    const result = await saveLocalEntry(
      await this.domain(),
      request.id === undefined ? request : { ...request, id: brandString<CalendarEntryIdType>(request.id) },
      hostNow(),
      hostTimeZone(),
    )
    // The change is published only once the write is durable, so a Client
    // refetching on the frame never reads a value that is not stored.
    if (result.ok) this.requireStore().publish('entry-saved')
    return result
  }

  /**
   * Delete one displayed entry; an entry owned by a source reports `readonly`.
   * @param request - Entry the Client named.
   * @returns whether an owned entry was removed.
   */
  @Remote('deleteEntry')
  async deleteEntry(request: CalendarDeleteEntryRequest): Promise<CalendarDeleteEntryResult> {
    const result = await deleteEntry(await this.domain(), request.id)
    if (result.ok) this.requireStore().publish('entry-deleted')
    return result
  }

  /**
   * Stream every change to the stored entries, subscriptions, and imports.
   *
   * The stream carries no state: a Client refetches the snapshot on each frame
   * and treats the snapshot as the single source of truth.
   * @param signal - Cancellation owned by the Remote stream carrier.
   * @returns one frame per committed change until the Client disconnects.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<CalendarChange> {
    const store = this.requireStore()
    let pending: CalendarChange | undefined
    let wake: (() => void) | undefined
    const stop = store.onChange((change) => { pending = change; wake?.() })
    const stopClose = store.onClose(() => { wake?.() })
    const abort = (): void => { wake?.() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted && !store.closed) {
        if (pending !== undefined) {
          const change = pending
          pending = undefined
          yield change
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      stop()
      stopClose()
      signal.removeEventListener('abort', abort)
    }
  }

  /** The open calendar domain. */
  private async domain(): Promise<Domain<typeof calendarDomain>> {
    await this.initialized
    return this.ready
  }

  /**
   * The subscription store, which exists once the service has initialized.
   * @returns the running store.
   * @throws Error when a method is reached before initialization completed.
   */
  private requireStore(): SubscriptionStore {
    if (this.store === undefined) throw new Error('The calendar store is not initialized.')
    return this.store
  }
}

/**
 * Report the optional-service failure in the shape every task method returns.
 * @returns the same failure value for a create, update, and delete request.
 */
function unavailable(): { readonly ok: false; readonly code: CalendarTaskErrorCode; readonly message: string } {
  return { ok: false, code: 'service-unavailable', message: SCHEDULE_UNAVAILABLE_MESSAGE }
}

/**
 * Translate one thrown Schedule service error into a task result value.
 * @param error - Rejection from `ctx.schedule`.
 * @returns the failure the Client renders.
 */
function inputFailure(error: unknown): { readonly ok: false; readonly code: CalendarTaskErrorCode; readonly message: string } {
  if (error instanceof ScheduleInputError) return { ok: false, code: error.code, message: error.message }
  return { ok: false, code: 'internal_error', message: 'The Schedule service rejected this request.' }
}

/**
 * Describe one non-mutating update outcome.
 * @param code - Why the update did not commit.
 * @returns a message the Client shows in place of the generic code text.
 */
function describeUpdateMiss(code: CalendarTaskErrorCode): string {
  switch (code) {
    case 'schedule_not_found': return 'That task no longer exists.'
    case 'schedule_ended': return 'That task has already ended and can no longer be changed.'
    case 'schedule_conflict': return 'That task changed since this page last read it. Reload and apply the edit again.'
    case 'invalid_prompt':
    case 'invalid_selector':
    case 'invalid_rule':
    case 'invalid_time_zone':
    case 'not_future':
    case 'time_out_of_range':
    case 'frequency_too_high':
    case 'internal_error':
    case 'service-unavailable':
    case 'session_not_found': return 'The task could not be changed.'
    default: return assertNever(code)
  }
}

/**
 * Reject a failure code this module does not handle.
 * @param code - Code the closed union produced outside every handled branch.
 * @returns never; the call is unreachable while the union stays closed.
 */
function assertNever(code: never): never {
  throw new Error(`Unhandled calendar task failure code: ${String(code)}`)
}
