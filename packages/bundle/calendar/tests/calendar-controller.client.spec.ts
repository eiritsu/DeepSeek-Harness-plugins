import { describe, expect, it, vi } from 'vitest'
import type { ScheduleId } from '@deepseek-ai/dsh-schedule/client'
import type {
  CalendarChange, CalendarCreateTaskRequest, CalendarCreateTaskResult, CalendarImportedId, CalendarSelectableSession,
  CalendarSnapshot, CalendarSnapshotRequest, CalendarSubscription, CalendarSubscriptionId, CalendarTask,
} from '../src/types.ts'
import type { CalendarPort, CalendarTaskDraft } from '../src/client/controller.ts'
import { CalendarController } from '../src/client/controller.ts'

const flush = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }

function emptySnapshot(partial: Partial<CalendarSnapshot> = {}): CalendarSnapshot {
  return {
    now: '2026-10-05T08:00:00.000Z',
    hostTimeZone: 'UTC',
    timeZone: 'UTC',
    range: { start: '2026-10-01T00:00:00.000Z', end: '2026-10-20T00:00:00.000Z' },
    tasks: [],
    occurrences: [],
    occurrencesTruncated: false,
    entries: [],
    entriesTruncated: false,
    subscriptions: [],
    importedCalendars: [],
    selectableSessions: [{ id: 's1', live: true, updatedAt: 0, blank: false }],
    serviceAvailable: true,
    ...partial,
  }
}

function occurrence(title: string, startsAt: string): CalendarSnapshot['occurrences'][number] {
  return { taskId: 'task-1' as ScheduleId, sessionId: 's1', kind: 'at', title, startsAt, status: 'active', recurring: false }
}

function taskRecord(): CalendarTask {
  return {
    id: 'task-1' as ScheduleId,
    sessionId: 's1',
    status: 'active',
    record: {
      id: 'task-1' as ScheduleId, kind: 'at', title: 'T', prompt: 'P', scheduledAt: '2026-10-06T09:00:00.000Z',
    },
  }
}

function makePort(overrides: Partial<CalendarPort> = {}): CalendarPort {
  return {
    snapshot: async () => emptySnapshot(),
    createTask: async () => ({ ok: false, code: 'internal_error', message: 'unused' }),
    updateTask: async () => ({ ok: false, code: 'internal_error', message: 'unused' }),
    deleteTask: async () => ({ ok: false, code: 'internal_error', message: 'unused' }),
    addSubscription: async () => ({ ok: false, code: 'internal-error', message: 'unused' }),
    updateSubscription: async () => ({ ok: false, code: 'internal-error', message: 'unused' }),
    deleteSubscription: async () => ({ ok: false, code: 'internal-error', message: 'unused' }),
    refreshSubscription: async () => ({ ok: false, id: 'x' as CalendarSubscriptionId, code: 'internal-error', message: 'unused' }),
    importIcs: async () => ({ ok: false, code: 'internal-error', message: 'unused' }),
    deleteImported: async () => ({ ok: false, code: 'internal-error', message: 'unused' }),
    onScheduleChanged: () => () => {},
    watch: async function* watch(): AsyncIterable<CalendarChange> { /* no frames */ },
    ...overrides,
  }
}

const AT_DRAFT: CalendarTaskDraft = {
  sessionId: 's1',
  title: 'Review',
  prompt: 'Review the release',
  zone: 'UTC',
  rule: { kind: 'at', date: '2026-10-06', time: '09:00', weekdays: [], everyAmount: 1, everyUnit: 'hour' },
}

describe('CalendarController query lifecycle', () => {
  it('discards a stale snapshot that resolves after a newer request', async () => {
    const pending: Array<(value: CalendarSnapshot) => void> = []
    const port = makePort({ snapshot: () => new Promise<CalendarSnapshot>((resolve) => { pending.push(resolve) }) })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    const face = controller.inject()
    controller.start()
    face.stepMonth(1)
    expect(pending).toHaveLength(2)

    pending[1]!(emptySnapshot({ occurrences: [occurrence('second', '2026-11-05T09:00:00.000Z')] }))
    await flush()
    pending[0]!(emptySnapshot({ occurrences: [occurrence('first', '2026-10-05T09:00:00.000Z')] }))
    await flush()

    const state = controller.inject().hooks.calendar.getSnapshot()
    expect(state.items.map(item => item.title)).toEqual(['second'])
    controller.dispose()
  })

  it('surfaces a rejected snapshot as the page error and clears loading', async () => {
    const port = makePort({ snapshot: async () => { throw new Error('offline') } })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    controller.start()
    await flush()
    const state = controller.inject().hooks.calendar.getSnapshot()
    expect(state.errorKey).toBe('error')
    expect(state.loading).toBe(false)
    controller.dispose()
  })

  it('steps the month anchor forward and restores today through the injected face', async () => {
    const port = makePort({ snapshot: async () => emptySnapshot({ now: '2026-10-05T08:00:00.000Z' }) })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    const face = controller.inject()
    controller.start()
    await flush()
    expect(controller.inject().hooks.calendar.getSnapshot()).toMatchObject({ year: 2026, month: 10 })
    face.stepMonth(1)
    await flush()
    expect(controller.inject().hooks.calendar.getSnapshot()).toMatchObject({ year: 2026, month: 11 })
    face.goToday()
    await flush()
    expect(controller.inject().hooks.calendar.getSnapshot()).toMatchObject({ year: 2026, month: 10, selectedDate: '2026-10-05' })
    controller.dispose()
  })
})

describe('CalendarController task writes', () => {
  it('refetches after a create and reports success', async () => {
    const calls: CalendarSnapshotRequest[] = []
    const created: CalendarCreateTaskRequest[] = []
    const port = makePort({
      snapshot: async (request) => { calls.push(request); return emptySnapshot() },
      createTask: async (request): Promise<CalendarCreateTaskResult> => { created.push(request); return { ok: true, task: taskRecord() } },
    })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    controller.start()
    await flush()

    const result = await controller.inject().createTask(AT_DRAFT)
    expect(result).toEqual({ ok: true })
    expect(calls).toHaveLength(2)
    expect(created[0]).toMatchObject({ sessionId: 's1', title: 'Review', prompt: 'Review the release', at: { date: '2026-10-06', time: '09:00:00', time_zone: 'UTC' } })
    expect(controller.inject().hooks.calendar.getSnapshot().feedback).toMatchObject({ key: 'write.created', ok: true })
    controller.dispose()
  })

  it('rejects a create whose session is not selectable without reaching the Remote', async () => {
    const createTask = vi.fn()
    const controller = new CalendarController(makePort({ createTask }), { timeZone: 'UTC' })
    controller.start()
    await flush()
    const result = await controller.inject().createTask({ ...AT_DRAFT, sessionId: 'missing' })
    expect(result).toEqual({ ok: false, key: 'create.invalidSession' })
    expect(createTask).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('refetches and reports conflict detail when an update misses', async () => {
    const port = makePort({
      updateTask: async () => ({ ok: false, code: 'schedule_conflict', message: 'changed elsewhere' }),
    })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    controller.start()
    await flush()
    const result = await controller.inject().updateTask({ ...AT_DRAFT, id: 'task-1' as ScheduleId, expected: taskRecord().record })
    expect(result).toEqual({ ok: false, key: 'task.schedule_conflict', detail: 'changed elsewhere' })
    expect(controller.inject().hooks.calendar.getSnapshot().feedback.key).toBe('task.schedule_conflict')
    controller.dispose()
  })
})

describe('CalendarController subscription writes', () => {
  it('never refetches and shows the localized code when an add fails', async () => {
    let snapshots = 0
    const port = makePort({
      snapshot: async () => { snapshots += 1; return emptySnapshot() },
      addSubscription: async () => ({ ok: false, code: 'invalid-url', message: 'bad url' }),
    })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    controller.start()
    await flush()
    const result = await controller.inject().addSubscription({ name: 'Feed', url: 'not-a-url' })
    expect(result).toEqual({ ok: false, key: 'failure.invalid-url', detail: 'bad url' })
    expect(snapshots).toBe(1)
    expect(controller.inject().hooks.calendar.getSnapshot().feedback.key).toBe('failure.invalid-url')
    controller.dispose()
  })

  it('maps an import failure through the import code', async () => {
    const port = makePort({ importIcs: async () => ({ ok: false, code: 'invalid-ics', message: 'bad feed' }) })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    controller.start()
    await flush()
    const result = await controller.inject().importIcs('Feed', 'not ical')
    expect(result).toEqual({ ok: false, key: 'import.invalid-ics', detail: 'bad feed' })
    controller.dispose()
  })

  it('reports an import as a saved update rather than a subscription change', async () => {
    const port = makePort({
      importIcs: async () => ({
        ok: true,
        calendar: {
          id: 'imp-1' as CalendarImportedId, name: 'Feed', entryCount: 2, droppedEntryCount: 0,
          importedAt: '2026-10-05T00:00:00.000Z',
        },
      }),
    })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    controller.start()
    await flush()
    const result = await controller.inject().importIcs('Feed', 'BEGIN:VCALENDAR')
    expect(result).toEqual({ ok: true })
    expect(controller.inject().hooks.calendar.getSnapshot().feedback).toMatchObject({ key: 'write.updated', ok: true })
    controller.dispose()
  })

  it('disables a subscription through updateSubscription and refetches', async () => {
    const updated: CalendarSubscription = {
      id: 'sub-1' as CalendarSubscriptionId, name: 'Feed', url: 'https://example.com/f.ics', protocol: 'https', enabled: false,
      refreshIntervalSeconds: 3600, entryCount: 3, droppedEntryCount: 1, refreshing: false,
      createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    }
    const updateSubscription = vi.fn(async () => ({ ok: true as const, subscription: updated }))
    let snapshots = 0
    const port = makePort({
      snapshot: async () => { snapshots += 1; return emptySnapshot() },
      updateSubscription,
    })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    controller.start()
    await flush()
    const result = await controller.inject().updateSubscription('sub-1' as CalendarSubscriptionId, {
      name: 'Feed', url: 'https://example.com/f.ics', enabled: false, refreshIntervalSeconds: 3600,
    })
    expect(result).toEqual({ ok: true })
    expect(updateSubscription).toHaveBeenCalledWith({
      id: 'sub-1', name: 'Feed', url: 'https://example.com/f.ics', enabled: false, refreshIntervalSeconds: 3600,
    })
    expect(snapshots).toBe(2)
    controller.dispose()
  })

  it('rereads after a failed refresh so the stored lastFailure is visible', async () => {
    let snapshots = 0
    const port = makePort({
      snapshot: async () => { snapshots += 1; return emptySnapshot() },
      refreshSubscription: async () => ({
        ok: false, id: 'sub-1' as CalendarSubscriptionId, code: 'request-failed', message: 'unreachable',
      }),
    })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    controller.start()
    await flush()
    const result = await controller.inject().refreshSubscription('sub-1' as CalendarSubscriptionId)
    expect(result).toEqual({ ok: false, key: 'failure.request-failed', detail: 'unreachable' })
    expect(snapshots).toBe(2)
    controller.dispose()
  })
})

describe('CalendarController session directory', () => {
  const candidate = (id: string, updatedAt: number): CalendarSelectableSession => ({ id, live: false, updatedAt, blank: false })

  it('re-intersects without a Host reload and refetches once when an allowed Session is missing', async () => {
    let snapshots = 0
    let candidates: CalendarSelectableSession[] = [candidate('keep', 2), candidate('arch', 1)]
    const port = makePort({
      snapshot: async () => { snapshots += 1; return emptySnapshot({ selectableSessions: candidates }) },
    })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    const ids = (): string[] => controller.inject().hooks.calendar.getSnapshot().selectableSessions.map(session => session.id)
    controller.setSessionDirectory({ keep: 'Keep', arch: 'Arch' }, ['keep', 'arch'])
    controller.start()
    await flush()
    expect(ids()).toEqual(['keep', 'arch'])

    // Archive: the option disappears with no Remote read.
    controller.setSessionDirectory({ keep: 'Keep' }, ['keep'])
    expect(ids()).toEqual(['keep'])
    expect(snapshots).toBe(1)

    // Unarchive: the cached Host candidates still hold the id, so it returns
    // without a reload.
    controller.setSessionDirectory({ keep: 'Keep', arch: 'Arch' }, ['keep', 'arch'])
    expect(ids()).toEqual(['keep', 'arch'])
    expect(snapshots).toBe(1)

    // A title-only change never refetches.
    controller.setSessionDirectory({ keep: 'Keep renamed', arch: 'Arch' }, ['keep', 'arch'])
    expect(snapshots).toBe(1)

    // A newly allowed Session absent from the last Host snapshot triggers one
    // controlled refresh; the refreshed candidates then include it.
    candidates = [candidate('keep', 2), candidate('arch', 1), candidate('new', 3)]
    controller.setSessionDirectory({ keep: 'Keep', arch: 'Arch', new: 'New' }, ['keep', 'arch', 'new'])
    await flush()
    expect(snapshots).toBe(2)
    expect(ids()).toEqual(['keep', 'arch', 'new'])
    controller.dispose()
  })

  it('does not restore an archived Session when a later Host snapshot omits it until unarchive refetches', async () => {
    let snapshots = 0
    let candidates: CalendarSelectableSession[] = [candidate('keep', 2), candidate('arch', 1)]
    const port = makePort({
      snapshot: async () => { snapshots += 1; return emptySnapshot({ selectableSessions: candidates }) },
    })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    const ids = (): string[] => controller.inject().hooks.calendar.getSnapshot().selectableSessions.map(session => session.id)
    controller.setSessionDirectory({ keep: 'Keep', arch: 'Arch' }, ['keep', 'arch'])
    controller.start()
    await flush()

    // Archived before the next Host read: the fresh snapshot omits it.
    controller.setSessionDirectory({ keep: 'Keep' }, ['keep'])
    candidates = [candidate('keep', 2)]
    controller.inject().refresh()
    await flush()
    expect(ids()).toEqual(['keep'])
    expect(snapshots).toBe(2)

    // Unarchive with the cached candidates missing the id refetches, and the
    // refreshed Host snapshot returns it.
    candidates = [candidate('keep', 2), candidate('arch', 1)]
    controller.setSessionDirectory({ keep: 'Keep', arch: 'Arch' }, ['keep', 'arch'])
    await flush()
    expect(ids()).toEqual(['keep', 'arch'])
  })

  it('refetches when the sole candidate was archived and the directory restores it after an empty snapshot', async () => {
    let snapshots = 0
    let candidates: CalendarSelectableSession[] = [candidate('only', 1)]
    const port = makePort({
      snapshot: async () => { snapshots += 1; return emptySnapshot({ selectableSessions: candidates }) },
    })
    const controller = new CalendarController(port, { timeZone: 'UTC' })
    const ids = (): string[] => controller.inject().hooks.calendar.getSnapshot().selectableSessions.map(session => session.id)
    controller.setSessionDirectory({ only: 'Only' }, ['only'])
    controller.start()
    await flush()
    expect(ids()).toEqual(['only'])

    // Archiving the only candidate removes it, and the refreshed Host snapshot
    // legitimately returns no targets.
    controller.setSessionDirectory({ only: 'Only' }, [])
    candidates = []
    controller.inject().refresh()
    await flush()
    expect(ids()).toEqual([])
    expect(snapshots).toBe(2)

    // Unarchiving must refetch even though the last snapshot was empty.
    candidates = [candidate('only', 1)]
    controller.setSessionDirectory({ only: 'Only' }, ['only'])
    await flush()
    expect(ids()).toEqual(['only'])
    expect(snapshots).toBe(3)
    controller.dispose()
  })
})
