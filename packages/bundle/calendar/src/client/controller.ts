/**
 * Calendar page controller: one snapshot store over the Host calendar Remote,
 * with request-generation stale-response handling and the write operations the
 * page and the subscription manager share.
 *
 * The controller depends only on {@link CalendarPort}, the typed RPC adapter
 * boundary. The real adapter is built from `ctx.remote.calendar` in
 * `remote-port.ts`; specs drive a fake port, so no test reaches the wire.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ScheduleId, ScheduleRecord } from '@deepseek-ai/dsh-schedule/client'
import type {
  CalendarAddSubscriptionRequest, CalendarChange, CalendarCreateTaskRequest, CalendarCreateTaskResult,
  CalendarDeleteImportedRequest, CalendarDeleteImportedResult, CalendarDeleteSubscriptionResult,
  CalendarDeleteTaskRequest, CalendarDeleteTaskResult, CalendarImportedCalendar, CalendarImportedId,
  CalendarImportIcsRequest, CalendarImportIcsResult, CalendarRefreshResult, CalendarSelectableSession,
  CalendarSnapshot, CalendarSnapshotRequest, CalendarSubscription, CalendarSubscriptionId,
  CalendarSubscriptionMutationResult, CalendarSubscriptionRef, CalendarTask, CalendarUpdateSubscriptionRequest,
  CalendarUpdateTaskRequest, CalendarUpdateTaskResult,
} from '../types.ts'
import { importFailureKey, isAcceptedRange, subscriptionFailureKey, taskFailureKey } from '../client-api.ts'
import {
  buildViewItems, monthRange, listRange, everyDraftSeconds, ruleDraftToChange, ruleDraftToSelector,
  filterViewItems, todayKey, validatePrompt, validateRuleDraft, validateTitle, type CalendarFilter,
  type CalendarRuleDraft, type CalendarViewItem,
} from './calendar-model.ts'
import type { CalendarKey } from './locales.ts'

/** Typed RPC adapter the controller consumes; one member per Remote method. */
export interface CalendarPort {
  snapshot(request: CalendarSnapshotRequest): Promise<CalendarSnapshot>
  createTask(request: CalendarCreateTaskRequest): Promise<CalendarCreateTaskResult>
  updateTask(request: CalendarUpdateTaskRequest): Promise<CalendarUpdateTaskResult>
  deleteTask(request: CalendarDeleteTaskRequest): Promise<CalendarDeleteTaskResult>
  addSubscription(request: CalendarAddSubscriptionRequest): Promise<CalendarSubscriptionMutationResult>
  updateSubscription(request: CalendarUpdateSubscriptionRequest): Promise<CalendarSubscriptionMutationResult>
  deleteSubscription(request: CalendarSubscriptionRef): Promise<CalendarDeleteSubscriptionResult>
  refreshSubscription(request: CalendarSubscriptionRef): Promise<CalendarRefreshResult>
  importIcs(request: CalendarImportIcsRequest): Promise<CalendarImportIcsResult>
  deleteImported(request: CalendarDeleteImportedRequest): Promise<CalendarDeleteImportedResult>
  /** Subscribe to the forwarded `schedule/changed` event; returns the disposer. */
  onScheduleChanged(listener: () => void): () => void
  /** Watch the calendar change stream; ends when `signal` aborts. */
  watch(signal: AbortSignal): AsyncIterable<CalendarChange>
}

/** Draft of one appointment create or edit submitted by the form. */
export interface CalendarTaskDraft {
  readonly sessionId: string
  readonly title: string
  readonly prompt: string
  readonly zone: string
  readonly rule: CalendarRuleDraft
}

/** Edit draft carrying the committed record the compare-and-update guard needs. */
export interface CalendarTaskEditDraft extends CalendarTaskDraft {
  readonly id: ScheduleId
  readonly expected: ScheduleRecord
}

/** Subscription create or edit draft submitted by the configuration page. */
export interface CalendarSubscriptionDraft {
  readonly name: string
  readonly url: string
  readonly enabled?: boolean
  readonly refreshIntervalSeconds?: number
}

/** One feedback line shown after a write settles. */
export interface CalendarFeedback {
  readonly busy: boolean
  /** Locale key of the outcome; a success key when `ok` is true. */
  readonly key?: CalendarKey
  /** Host-authored or local detail shown as secondary text. */
  readonly detail?: string
  readonly ok?: boolean
}

/** Outcome of one write, returned to the calling form for inline display. */
export type CalendarActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly key: CalendarKey; readonly detail?: string }

/** Complete store snapshot the page renders from; mutable so the store's immer draft can update it. */
export interface CalendarState {
  view: 'month' | 'list'
  year: number
  month: number
  selectedDate: string
  filter: CalendarFilter
  loading: boolean
  refreshing: boolean
  errorKey: CalendarKey | undefined
  items: CalendarViewItem[]
  subscriptions: CalendarSubscription[]
  imported: CalendarImportedCalendar[]
  /** Sessions a new automation may be bound to, with their live state. */
  selectableSessions: CalendarSelectableSession[]
  /** Most recent raw Host candidates, kept so the Client directory can re-intersect without a reload. */
  hostSelectableSessions: CalendarSelectableSession[]
  /** Whether a Host snapshot has been applied at least once. */
  hostSnapshotLoaded: boolean
  /** Display labels for known Sessions, keyed by Session id. */
  sessionLabels: Record<string, string>
  /** Client-visible Session ids the Host candidates are intersected with. */
  allowedSessionIds: string[]
  /** Whether the Client Session directory has been read at least once. */
  sessionDirectoryLoaded: boolean
  serviceAvailable: boolean
  /** Host clock reading; empty until the first snapshot. */
  now: string
  hostTimeZone: string
  snapshotTimeZone: string
  occurrencesTruncated: boolean
  entriesTruncated: boolean
  feedback: CalendarFeedback
}

/** Injected face shared by the calendar page and the configuration page. */
export interface CalendarFace {
  readonly hooks: { calendar: SnapshotStore<CalendarState> }
  /** Open the linked Session through the native workspace navigation. */
  readonly onOpenSession: (sessionId: string) => void
  setView(view: 'month' | 'list'): void
  setFilter(filter: CalendarFilter): void
  selectDate(dateKey: string): void
  stepMonth(delta: number): void
  goToday(): void
  refresh(): void
  clearFeedback(): void
  createTask(draft: CalendarTaskDraft): Promise<CalendarActionResult>
  updateTask(draft: CalendarTaskEditDraft): Promise<CalendarActionResult>
  cancelTask(task: CalendarTask): Promise<CalendarActionResult>
  addSubscription(draft: CalendarSubscriptionDraft): Promise<CalendarActionResult>
  updateSubscription(id: CalendarSubscriptionId, draft: CalendarSubscriptionDraft): Promise<CalendarActionResult>
  removeSubscription(id: CalendarSubscriptionId): Promise<CalendarActionResult>
  refreshSubscription(id: CalendarSubscriptionId): Promise<CalendarActionResult>
  importIcs(name: string, ics: string): Promise<CalendarActionResult>
  removeImported(id: CalendarImportedId): Promise<CalendarActionResult>
}

/** Options fixed when the controller is created. */
export interface CalendarControllerOptions {
  /** Display zone; defaults to the browser's own IANA zone. */
  readonly timeZone: string
  /** Native workspace navigation target for a linked Session. */
  readonly onOpenSession?: (sessionId: string) => void
}

function initialState(zone: string, selectedDate: string): CalendarState {
  const [year = 0, month = 1] = selectedDate.split('-').map(Number)
  return {
    view: 'month',
    year,
    month,
    selectedDate,
    filter: 'all',
    loading: true,
    refreshing: false,
    errorKey: undefined,
    items: [],
    subscriptions: [],
    imported: [],
    selectableSessions: [],
    hostSelectableSessions: [],
    hostSnapshotLoaded: false,
    sessionLabels: {},
    allowedSessionIds: [],
    sessionDirectoryLoaded: false,
    serviceAvailable: true,
    now: '',
    hostTimeZone: zone,
    snapshotTimeZone: zone,
    occurrencesTruncated: false,
    entriesTruncated: false,
    feedback: { busy: false },
  }
}

/**
 * Drive the calendar store from one typed Remote port.
 *
 * Every load is keyed by a generation: a response that arrives after a later
 * view, month, or refresh request started is discarded, so switching the view
 * or closing the page mid-flight can never publish a stale snapshot.
 */
export class CalendarController {
  private readonly store: SnapshotStore<CalendarState>
  private readonly zone: string
  private readonly onOpenSession: (sessionId: string) => void
  private generation = 0
  private unsubscribe: (() => void) | undefined
  private readonly abort = new AbortController()
  private disposed = false
  private started = false

  /**
   * @param port - typed RPC adapter over the Host calendar Remote.
   * @param options - resolved display zone and native navigation callback.
   */
  constructor(private readonly port: CalendarPort, options: CalendarControllerOptions) {
    const selected = todayKey(new Date().toISOString(), options.timeZone)
    this.zone = options.timeZone
    this.onOpenSession = options.onOpenSession ?? (() => {})
    this.store = createSnapshotStore(initialState(options.timeZone, selected))
  }

  /** Load the first snapshot and subscribe to forwarded and streamed changes. */
  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    this.unsubscribe = this.port.onScheduleChanged(() => { void this.load() })
    void this.consume()
    void this.load()
  }

  /** Stop loading, abort the watch stream, unsubscribe, and stale every in-flight response. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.abort.abort()
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  private async consume(): Promise<void> {
    try {
      for await (const frame of this.port.watch(this.abort.signal)) {
        if (this.disposed) break
        void frame
        void this.load(true)
      }
    } catch (error: unknown) {
      // The watch carrier ended or aborted; the forwarded `schedule/changed`
      // subscription remains the fallback trigger, so no recovery is needed.
      void error
    }
  }

  /**
   * Apply the Client Session directory: display labels plus the ids the
   * workspace browser would show. The visible candidate list is always
   * re-derived from the last raw Host snapshot, so unarchiving a Session or
   * gaining a current blank Session restores it without a Host reload; an
   * archived or deleted Session disappears at once.
   *
   * When the directory gains an id the last Host snapshot does not hold — an
   * unarchive after a snapshot taken while it was archived — exactly one
   * controlled refetch is issued. A title-only change never refetches, because
   * it does not grow the id set.
   * @param labels - display labels keyed by Session id.
   * @param allowed - selectable Session ids.
   */
  setSessionDirectory(labels: Readonly<Record<string, string>>, allowed: readonly string[]): void {
    const ids = [...allowed]
    const previous = this.store.getSnapshot().allowedSessionIds
    const grew = ids.some(id => !previous.includes(id))
    this.store.update((draft) => {
      draft.sessionLabels = { ...labels }
      draft.allowedSessionIds = ids
      draft.sessionDirectoryLoaded = true
      draft.selectableSessions = intersectSessions(draft)
    })
    const state = this.store.getSnapshot()
    const missing = state.hostSnapshotLoaded && ids.some(id => !state.hostSelectableSessions.some(session => session.id === id))
    if (grew && missing) void this.load(true)
  }

  /** Build the injected face the registrations hand to their components. */
  inject(): CalendarFace {
    return {
      hooks: { calendar: this.store },
      onOpenSession: this.onOpenSession,
      setView: (view) => { this.store.update((draft) => { draft.view = view }); void this.load() },
      setFilter: (filter) => { this.store.update((draft) => { draft.filter = filter }) },
      selectDate: (dateKey) => { this.store.update((draft) => { draft.selectedDate = dateKey }) },
      stepMonth: (delta) => {
        this.store.update((draft) => {
          const total = draft.year * 12 + (draft.month - 1) + delta
          draft.year = Math.floor(total / 12)
          draft.month = (total % 12 + 12) % 12 + 1
        })
        void this.load()
      },
      goToday: () => {
        const today = todayKey(this.store.getSnapshot().now || new Date().toISOString(), this.zone)
        this.store.update((draft) => {
          const [year = 0, month = 1] = today.split('-').map(Number)
          draft.year = year
          draft.month = month
          draft.selectedDate = today
        })
        void this.load()
      },
      refresh: () => { void this.load(true) },
      clearFeedback: () => { this.store.update((draft) => { draft.feedback = { busy: false } }) },
      createTask: draft => this.createTask(draft),
      updateTask: draft => this.updateTask(draft),
      cancelTask: task => this.cancelTask(task),
      addSubscription: draft => this.addSubscription(draft),
      updateSubscription: (id, draft) => this.updateSubscription(id, draft),
      removeSubscription: id => this.removeSubscription(id),
      refreshSubscription: id => this.refreshSubscription(id),
      importIcs: (name, ics) => this.importIcs(name, ics),
      removeImported: id => this.removeImported(id),
    }
  }

  private async load(refreshing = false): Promise<void> {
    if (this.disposed) return
    const state = this.store.getSnapshot()
    const range = state.view === 'month'
      ? monthRange(state.year, state.month, this.zone)
      : listRange(state.now || new Date().toISOString(), this.zone)
    if (!isAcceptedRange(range.start, range.end)) return
    const generation = ++this.generation
    const hasItems = state.items.length > 0
    this.store.update((draft) => {
      draft.loading = !hasItems && !refreshing
      draft.refreshing = refreshing || hasItems
      draft.errorKey = undefined
    })
    try {
      const snapshot = await this.port.snapshot({ rangeStart: range.start, rangeEnd: range.end, timeZone: this.zone })
      if (generation !== this.generation || this.abort.signal.aborted) return
      this.store.update((draft) => { applySnapshot(draft, snapshot) })
    } catch {
      if (generation !== this.generation || this.abort.signal.aborted) return
      this.store.update((draft) => {
        draft.loading = false
        draft.refreshing = false
        draft.errorKey = 'error'
      })
    }
  }

  private async createTask(draft: CalendarTaskDraft): Promise<CalendarActionResult> {
    const errorKey = this.validateTask(draft, true)
    if (errorKey !== undefined) return { ok: false, key: errorKey }
    const selector = ruleDraftToSelector(draft.rule, draft.zone)
    if (selector === undefined) return { ok: false, key: 'task.invalid_selector' }
    this.setBusy(true)
    try {
      const request: CalendarCreateTaskRequest = {
        sessionId: draft.sessionId,
        title: draft.title.trim(),
        prompt: draft.prompt.trim(),
        ...selector,
      }
      const result = await this.port.createTask(request)
      if (!result.ok) return this.failTask(result.code, result.message)
      await this.reload()
      this.succeed('write.created')
      return { ok: true }
    } catch (error) {
      return this.failTransport(error)
    }
  }

  private async updateTask(draft: CalendarTaskEditDraft): Promise<CalendarActionResult> {
    const errorKey = this.validateTask(draft, false)
    if (errorKey !== undefined) return { ok: false, key: errorKey }
    this.setBusy(true)
    try {
      const change = ruleDraftToChange(draft.rule, draft.zone)
      const request: CalendarUpdateTaskRequest = {
        sessionId: draft.sessionId,
        id: draft.id,
        expected: draft.expected,
        title: draft.title.trim(),
        prompt: draft.prompt.trim(),
        ...(change === undefined ? {} : { change }),
      }
      const result = await this.port.updateTask(request)
      if (!result.ok) return this.failTask(result.code, result.message)
      await this.reload()
      this.succeed('write.updated')
      return { ok: true }
    } catch (error) {
      return this.failTransport(error)
    }
  }

  private async cancelTask(task: CalendarTask): Promise<CalendarActionResult> {
    this.setBusy(true)
    try {
      const result = await this.port.deleteTask({ sessionId: task.sessionId, id: task.id })
      if (!result.ok) return this.failTask(result.code, result.message)
      await this.reload()
      this.succeed('write.deleted')
      return { ok: true }
    } catch (error) {
      return this.failTransport(error)
    }
  }

  private async addSubscription(draft: CalendarSubscriptionDraft): Promise<CalendarActionResult> {
    this.setBusy(true)
    try {
      const result = await this.port.addSubscription({
        name: draft.name.trim(),
        url: draft.url.trim(),
        ...(draft.enabled === undefined ? {} : { enabled: draft.enabled }),
        ...(draft.refreshIntervalSeconds === undefined ? {} : { refreshIntervalSeconds: draft.refreshIntervalSeconds }),
      })
      if (!result.ok) return this.failSubscription(result.code, result.message)
      await this.reload()
      this.succeed('write.subscription')
      return { ok: true }
    } catch (error) {
      return this.failTransport(error)
    }
  }

  private async updateSubscription(id: CalendarSubscriptionId, draft: CalendarSubscriptionDraft): Promise<CalendarActionResult> {
    this.setBusy(true)
    try {
      const result = await this.port.updateSubscription({
        id,
        name: draft.name.trim(),
        url: draft.url.trim(),
        ...(draft.enabled === undefined ? {} : { enabled: draft.enabled }),
        ...(draft.refreshIntervalSeconds === undefined ? {} : { refreshIntervalSeconds: draft.refreshIntervalSeconds }),
      })
      if (!result.ok) {
        // A rejected URL change may have recorded a stored lastFailure on the
        // existing subscription, so reread before reporting.
        await this.reload()
        return this.failSubscription(result.code, result.message)
      }
      await this.reload()
      this.succeed('write.subscription')
      return { ok: true }
    } catch (error) {
      return this.failTransport(error)
    }
  }

  private async removeSubscription(id: CalendarSubscriptionId): Promise<CalendarActionResult> {
    this.setBusy(true)
    try {
      const result = await this.port.deleteSubscription({ id })
      if (!result.ok) return this.failSubscription(result.code, result.message)
      await this.reload()
      this.succeed('write.subscription')
      return { ok: true }
    } catch (error) {
      return this.failTransport(error)
    }
  }

  private async refreshSubscription(id: CalendarSubscriptionId): Promise<CalendarActionResult> {
    this.setBusy(true)
    try {
      const result = await this.port.refreshSubscription({ id })
      // Reread on both outcomes: a failed fetch records the latest stored
      // lastFailure on the subscription, which the row must show.
      await this.reload()
      if (!result.ok) return this.failSubscription(result.code, result.message)
      this.succeed('write.subscription')
      return { ok: true }
    } catch (error) {
      return this.failTransport(error)
    }
  }

  private async importIcs(name: string, ics: string): Promise<CalendarActionResult> {
    this.setBusy(true)
    try {
      const result = await this.port.importIcs({ name: name.trim(), ics })
      if (!result.ok) {
        const key = importFailureKey(result.code)
        this.fail(key, result.message)
        return { ok: false, key, detail: result.message }
      }
      await this.reload()
      this.succeed('write.updated')
      return { ok: true }
    } catch (error) {
      return this.failTransport(error)
    }
  }

  private async removeImported(id: CalendarImportedId): Promise<CalendarActionResult> {
    this.setBusy(true)
    try {
      const result = await this.port.deleteImported({ id })
      if (!result.ok) {
        // `not-found` is not in the shared import-code vocabulary; the generic
        // failure copy states that the operation did not complete.
        const key: CalendarKey = result.code === 'not-found' ? 'error' : importFailureKey(result.code)
        this.fail(key, result.message)
        return { ok: false, key, detail: result.message }
      }
      await this.reload()
      this.succeed('write.updated')
      return { ok: true }
    } catch (error) {
      return this.failTransport(error)
    }
  }

  private validateTask(draft: CalendarTaskDraft, requireSelectable: boolean): CalendarKey | undefined {
    const content = validateTitle(draft.title) ?? validatePrompt(draft.prompt)
    if (content !== undefined) return content
    // An edit keeps its own stored Session binding even when that Session is no
    // longer selectable; only a create must pick from the Host candidate list.
    if (requireSelectable && !this.store.getSnapshot().selectableSessions.some(item => item.id === draft.sessionId)) {
      return 'create.invalidSession'
    }
    return validateRuleDraft(draft.rule, draft.zone, this.store.getSnapshot().now || new Date().toISOString())
  }

  private async reload(): Promise<void> {
    await this.load()
  }

  private setBusy(busy: boolean): void {
    this.store.update((draft) => { draft.feedback = busy ? { busy: true } : { busy: false } })
  }

  private succeed(key: CalendarKey): void {
    this.store.update((draft) => { draft.feedback = { busy: false, key, ok: true } })
  }

  private fail(key: CalendarKey, detail?: string): void {
    this.store.update((draft) => { draft.feedback = { busy: false, key, ...(detail === undefined ? {} : { detail }) } })
  }

  private failTask(code: Parameters<typeof taskFailureKey>[0], message: string): CalendarActionResult {
    const key = taskFailureKey(code)
    this.fail(key, message)
    return { ok: false, key, detail: message }
  }

  private failSubscription(code: Parameters<typeof subscriptionFailureKey>[0], message: string): CalendarActionResult {
    const key = subscriptionFailureKey(code)
    this.fail(key, message)
    return { ok: false, key, detail: message }
  }

  private failTransport(error: unknown): CalendarActionResult {
    const detail = error instanceof Error ? error.message : String(error)
    this.fail('write.failed', detail)
    return { ok: false, key: 'write.failed', detail }
  }
}

/**
 * Intersect the raw Host candidates with the loaded Client Session directory.
 * Called on every Host snapshot and every directory change, so the picker
 * follows either source without waiting for the other.
 */
function intersectSessions(draft: CalendarState): CalendarSelectableSession[] {
  return draft.sessionDirectoryLoaded
    ? draft.hostSelectableSessions.filter(session => draft.allowedSessionIds.includes(session.id))
    : [...draft.hostSelectableSessions]
}

function applySnapshot(draft: CalendarState, snapshot: CalendarSnapshot): void {
  draft.loading = false
  draft.refreshing = false
  draft.errorKey = undefined
  draft.now = snapshot.now
  draft.hostTimeZone = snapshot.hostTimeZone
  draft.snapshotTimeZone = snapshot.timeZone
  draft.items = buildViewItems(snapshot)
  draft.subscriptions = [...snapshot.subscriptions]
  draft.imported = [...snapshot.importedCalendars]
  draft.hostSelectableSessions = [...snapshot.selectableSessions]
  draft.hostSnapshotLoaded = true
  draft.selectableSessions = intersectSessions(draft)
  draft.serviceAvailable = snapshot.serviceAvailable
  draft.occurrencesTruncated = snapshot.occurrencesTruncated
  draft.entriesTruncated = snapshot.entriesTruncated
}

/** Convenience used by components: filtered items from one store snapshot. */
export function visibleItems(state: Pick<CalendarState, 'items' | 'filter'>): CalendarViewItem[] {
  return filterViewItems(state.items, state.filter)
}

/** Whole seconds an every-draft represents, re-exported for the form. */
export { everyDraftSeconds }
