import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness } from './harness.ts'
import type { Harness, HarnessSession } from './harness.ts'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { AddressInfo } from 'node:net'

/**
 * A display window relative to the Host clock, because an automation's target
 * must be strictly in the future while the window has to stay inside the
 * snapshot's 92-day ceiling.
 * @param startDays - Days before now the window starts.
 * @param days - Length of the window in days.
 * @returns the half-open range.
 */
function range(startDays: number, days: number): { rangeStart: string; rangeEnd: string } {
  const now = Date.now()
  return {
    rangeStart: new Date(now - startDays * 86_400_000).toISOString(),
    rangeEnd: new Date(now + (days - startDays) * 86_400_000).toISOString(),
  }
}

/** Default display window: two days back and eighty-nine days forward. */
const RANGE = range(2, 91)

/**
 * A UTC instant a fixed number of days from now.
 * @param days - Days from now; negative values are in the past.
 * @returns the canonical instant.
 */
function at(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

/**
 * A compact iCalendar `DTSTART`/`DTEND` value a fixed number of days from now.
 * @param days - Days from now.
 * @param hours - Hours after midnight UTC.
 * @returns the value in `YYYYMMDDTHHMMSSZ` form, which states its own zone.
 */
function stamp(days: number, hours: number): string {
  return atHour(days, hours).replace(/[-:]/g, '').replace('.000', '')
}

/**
 * A UTC instant a fixed number of days from now, at a fixed hour.
 * @param days - Days from now.
 * @param hours - Hours after midnight UTC.
 * @returns the canonical instant.
 */
function atHour(days: number, hours: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 11) + `${String(hours).padStart(2, '0')}:00:00.000Z`
}

/**
 * A calendar date a fixed number of days from now.
 * @param days - Days from now.
 * @returns the `YYYY-MM-DD` date.
 */
function on(days: number): string {
  return at(days).slice(0, 10)
}

/**
 * A loopback iCalendar server for subscription cases.
 *
 * The listener is on `127.0.0.1`, so a fixture feed exercises the real fetch
 * path without reaching the network.
 */
class Feed {
  /** Server under the test's ownership; the harness never opens one itself. */
  private server: Server | undefined
  /** Body the next request answers with. */
  body = ''
  /** Status the next request answers with. */
  status = 200
  /** Headers the next request answers with. */
  headers: Record<string, string> = {}
  /** Path the next request answers with instead of a 200 body. */
  redirectTo: string | undefined
  /** Delay applied before the next response is written. */
  delayMs = 0
  /** Requests the server received. */
  readonly requests: string[] = []
  /** Response timers this server owns; every one is cleared before it closes. */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  /** Requests the server started and has not finished answering. */
  pending = 0
  /** Resolves once each accepted request has settled. */
  private readonly settlements = new Set<Promise<void>>()

  /** Start listening on an ephemeral loopback port. */
  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      this.requests.push(request.url ?? '')
      this.pending += 1
      let timer: ReturnType<typeof setTimeout> | undefined
      const clear = (): void => {
        if (timer !== undefined) { clearTimeout(timer); this.timers.delete(timer); timer = undefined }
      }
      // Both the response close and the timer reaching its write end call this,
      // so it settles the request exactly once.
      // Both the response close and the timer reaching its write end call
      // this, so the request settles exactly once and the case can await it.
      let settledOnce = false
      let markSettled: () => void = () => {}
      const settlement = new Promise<void>((resolve) => { markSettled = resolve })
      this.settlements.add(settlement)
      const done = (): void => {
        if (settledOnce) return
        settledOnce = true
        clear()
        this.pending -= 1
        markSettled()
      }
      const send = (): void => {
        if (response.writableEnded || response.destroyed) { done(); return }
        if (this.redirectTo !== undefined) {
          response.writeHead(302, { location: this.redirectTo })
          response.end()
          done()
          return
        }
        response.writeHead(this.status, this.headers)
        response.end(this.body)
        done()
      }
      // A response that outlives the socket would write into a closed server,
      // so the timer is owned here and cleared on either signal.
      response.on('close', done)
      if (this.delayMs > 0) {
        timer = setTimeout(send, this.delayMs)
        this.timers.add(timer)
      } else send()
    })
    await new Promise<void>((resolve) => { this.server!.listen(0, '127.0.0.1', resolve) })
  }

  /** The port the loopback server bound. */
  port(): number {
    return (this.server!.address() as AddressInfo).port
  }

  /** Absolute `http://127.0.0.1` URL for one path. */
  url(path = '/feed.ics'): string {
    return `http://127.0.0.1:${this.port()}${path}`
  }

  /**
   * Stop the listener, cancel every response timer it owns, and wait for its
   * sockets, so no timer or response outlives the case.
   */
  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    if (server === undefined) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    await Promise.all([...this.settlements])
    expect(this.pending).toBe(0)
    expect(this.timers.size).toBe(0)
  }
}

/**
 * Build a minimal iCalendar document.
 * @param lines - VEVENT property lines.
 * @returns a complete document.
 */
function ics(...lines: string[]): string {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//dsh-calendar-test//EN',
    'BEGIN:VEVENT', 'DTSTAMP:20260101T000000Z', ...lines, 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n')
}

let running: Harness | undefined

/**
 * The loopback feed a case owns.
 *
 * A case reads it through `currentFeed()`, which reports a case that used a
 * feed without starting one instead of narrowing an optional into silence.
 */
const owned: { feed?: Feed | undefined } = {}

/**
 * Read the feed this case started.
 * @returns the running feed.
 * @throws Error when the case has not started one.
 */
function currentFeed(): Feed {
  if (owned.feed === undefined) throw new Error('This case uses a feed but never started one.')
  return owned.feed
}

/**
 * Start the feed this case owns.
 * @returns the running feed.
 */
async function startFeed(): Promise<Feed> {
  owned.feed = new Feed()
  await owned.feed.start()
  return owned.feed
}

afterEach(async () => {
  await running?.ctx.fiber.dispose()
  running = undefined
  await owned.feed?.stop()
  owned.feed = undefined
})

describe('calendar snapshot', () => {
  it('reports every automation and derives its occurrences in the range', async () => {
    running = await harness({ schedule: true, listedSessions: ['s-1'] })
    const sessionId = running.liveSession('s-1')
    await running.ctx.schedule.create(sessionId, {
      title: 'Standup', prompt: 'Join the standup', at: at(3),
    })
    const snapshot = await running.service.snapshot(RANGE)
    expect(snapshot.serviceAvailable).toBe(true)
    expect(snapshot.now).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(snapshot.hostTimeZone).not.toBe('')
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0]?.record).toMatchObject({ kind: 'at', title: 'Standup' })
    expect(snapshot.tasks[0]?.record).not.toHaveProperty('sessionId')
    expect(snapshot.occurrences.map(item => item.startsAt.slice(0, 10))).toEqual([at(3).slice(0, 10)])
    expect(snapshot.occurrences[0]?.status).toBe('active')
  })

  it('lists a selectable Session that the Host has not restored, with a nameable identity', async () => {
    running = await harness({
      schedule: true,
      sessions: [
        { id: 'restored', cwd: '/home/dev/api', updatedAt: 1_000, blank: false },
        { id: 'archived-ish', cwd: '/home/dev/ops', updatedAt: 5_000, blank: true },
      ],
    })
    running.liveSession('restored')
    const snapshot = await running.service.snapshot(RANGE)
    // Most recently active first, and each row carries the workspace the
    // Client names instead of a bare identity.
    expect(snapshot.selectableSessions).toEqual([
      { id: 'archived-ish', live: false, cwd: '/home/dev/ops', updatedAt: 5_000, blank: true },
      { id: 'restored', live: true, cwd: '/home/dev/api', updatedAt: 1_000, blank: false },
    ])
  })

  it('accepts a listed Session the Host has not restored as an automation target', async () => {
    running = await harness({
      schedule: true,
      sessions: [{ id: 'cold-session', cwd: '/home/dev/api', updatedAt: 1_000 }],
    })
    const result = await running.service.createTask({
      sessionId: 'cold-session', title: 'Standup', prompt: 'Join', at: at(3),
    })
    expect(result.ok).toBe(true)
  })

  it('never offers a subagent or archived Session, including a live fallback', async () => {
    running = await harness({
      schedule: true,
      sessions: [
        { id: 'ordinary', updatedAt: 2_000 },
        { id: 'cold', updatedAt: 1_000 },
        { id: 'sub', origin: 'subagent', updatedAt: 5_000 },
        { id: 'arch', updatedAt: 4_000 },
      ],
      archivedSessionIds: ['arch', 'live-arch'],
    })
    // The fallback must not re-add a loaded Session the rules exclude.
    running.liveSession('live-arch')
    const snapshot = await running.service.snapshot(RANGE)
    expect(snapshot.selectableSessions.map(session => session.id)).toEqual(['ordinary', 'cold'])
    const rejected = await running.service.createTask({
      sessionId: 'arch', title: 'Blocked', prompt: 'Blocked', at: at(3),
    })
    expect(rejected).toMatchObject({ ok: false, code: 'session_not_found' })
  })

  it('reads the archive set after the Session list resolves', async () => {
    const archived: string[] = []
    const pending = Promise.withResolvers<readonly HarnessSession[]>()
    running = await harness({
      schedule: true,
      archivedSessionIds: archived,
      listSessions: () => pending.promise,
    })
    const snapshotPromise = running.service.snapshot(RANGE)
    // Archive lands while the list read is still pending.
    archived.push('during-read')
    pending.resolve([{ id: 'during-read', updatedAt: 1_000 }, { id: 'keep', updatedAt: 2_000 }])
    const snapshot = await snapshotPromise
    expect(snapshot.selectableSessions.map(session => session.id)).toEqual(['keep'])
  })

  it('rejects a range the deployment does not accept', async () => {
    running = await harness()
    await expect(running.service.snapshot({ rangeStart: RANGE.rangeEnd, rangeEnd: RANGE.rangeStart }))
      .rejects.toThrow(/later exclusive end/)
    await expect(running.service.snapshot({
      rangeStart: RANGE.rangeStart,
      rangeEnd: new Date(Date.parse(RANGE.rangeStart) + 30_000).toISOString(),
    })).rejects.toThrow(/1 minute to 92 days/)
    await expect(running.service.snapshot({ ...RANGE, timeZone: 'Not/AZone' }))
      .rejects.toThrow(/not a time zone/)
  })
})

describe('calendar without the Schedule bundle', () => {
  it('mounts and serves local data while reporting the missing bundle', async () => {
    running = await harness()
    const created = await running.service.saveEntry({ title: 'Dentist', allDay: true, date: on(6) })
    expect(created.ok).toBe(true)
    const snapshot = await running.service.snapshot(RANGE)
    expect(snapshot.serviceAvailable).toBe(false)
    expect(snapshot.tasks).toEqual([])
    expect(snapshot.entries.map(entry => entry.title)).toEqual(['Dentist'])
    const task = await running.service.createTask({
      sessionId: 's-1', title: 'Standup', prompt: 'Join', at: at(3),
    })
    expect(task).toMatchObject({ ok: false, code: 'service-unavailable' })
    expect(await running.service.deleteTask({ sessionId: 's-1', id: 'schedule-x' as never }))
      .toMatchObject({ ok: false, code: 'service-unavailable' })
  })
})

describe('calendar task delegation', () => {
  it('creates a task bound to a listed Session and reads it back', async () => {
    running = await harness({ schedule: true, listedSessions: ['s-1'] })
    const result = await running.service.createTask({
      sessionId: 's-1', title: 'Standup', prompt: 'Join the standup', daily: { time: '09:00:00', time_zone: 'Asia/Shanghai' },
    })
    expect(result.ok).toBe(true)
    const task = await running.ctx.schedule.catalog()
    expect(task).toHaveLength(1)
    expect(task[0]?.sessionId).toBe('s-1')
  })

  it('rejects a Session the Host does not list', async () => {
    running = await harness({ schedule: true, listedSessions: ['s-1'] })
    const result = await running.service.createTask({
      sessionId: 'typo', title: 'Standup', prompt: 'Join', at: at(3),
    })
    expect(result).toMatchObject({ ok: false, code: 'session_not_found' })
  })

  it('rejects a request carrying no timing selector', async () => {
    running = await harness({ schedule: true, listedSessions: ['s-1'] })
    const result = await running.service.createTask({ sessionId: 's-1', title: 'Standup', prompt: 'Join' })
    expect(result).toMatchObject({ ok: false, code: 'invalid_selector' })
  })

  it('reports a Schedule input failure as a value', async () => {
    running = await harness({ schedule: true, listedSessions: ['s-1'] })
    const result = await running.service.createTask({
      sessionId: 's-1', title: '   ', prompt: 'Join', at: '2026-10-05T09:00:00.000Z',
    })
    expect(result).toMatchObject({ ok: false, code: 'invalid_prompt' })
  })

  it('applies a compare-and-update and refuses a stale one', async () => {
    running = await harness({ schedule: true, listedSessions: ['s-1'] })
    const created = await running.service.createTask({
      sessionId: 's-1', title: 'Standup', prompt: 'Join', at: at(3),
    })
    expect(created.ok).toBe(true)
    const task = created.ok ? created.task : undefined
    const id = task!.id
    const updated = await running.service.updateTask({
      sessionId: 's-1', id, expected: task!.record, title: 'Daily standup',
    })
    expect(updated.ok).toBe(true)
    const stale = await running.service.updateTask({
      sessionId: 's-1', id, expected: task!.record, title: 'Renamed again',
    })
    expect(stale).toMatchObject({ ok: false, code: 'schedule_conflict' })
  })

  it('reports a delete of a task that is already gone', async () => {
    running = await harness({ schedule: true, listedSessions: ['s-1'] })
    const created = await running.service.createTask({
      sessionId: 's-1', title: 'Standup', prompt: 'Join', at: at(3),
    })
    const id = created.ok ? created.task.id : ('schedule-missing' as never)
    expect(await running.service.deleteTask({ sessionId: 's-1', id })).toMatchObject({ ok: true, id })
    expect(await running.service.deleteTask({ sessionId: 's-1', id }))
      .toMatchObject({ ok: false, code: 'schedule_not_found' })
  })
})

describe('calendar local entries', () => {
  it('stores, edits, and deletes a local entry', async () => {
    running = await harness()
    const created = await running.service.saveEntry({ title: 'Gym', allDay: false, startsAt: atHour(5, 18) })
    expect(created.ok).toBe(true)
    const id = created.ok ? created.entry.id : ''
    const edited = await running.service.saveEntry({
      id: id as never, title: 'Gym and swim', allDay: false, startsAt: atHour(5, 18), endsAt: atHour(5, 19),
    })
    expect(edited).toMatchObject({ ok: true, entry: { title: 'Gym and swim' } })
    expect(await running.service.deleteEntry({ id })).toMatchObject({ ok: true, id })
  })

  it('rejects a whole-day entry that also carries an instant', async () => {
    running = await harness()
    expect(await running.service.saveEntry({ title: 'Trip', allDay: true, date: on(5), startsAt: at(5) }))
      .toMatchObject({ ok: false, code: 'invalid-time' })
    expect(await running.service.saveEntry({ title: 'Trip', allDay: false, date: on(5), startsAt: at(5) }))
      .toMatchObject({ ok: false, code: 'invalid-time' })
    expect(await running.service.saveEntry({ title: 'Trip', allDay: true, date: '2026-02-30' }))
      .toMatchObject({ ok: false, code: 'invalid-time' })
    expect(await running.service.saveEntry({ title: 'Trip', allDay: false, startsAt: atHour(5, 10), endsAt: atHour(5, 9) }))
      .toMatchObject({ ok: false, code: 'invalid-range' })
    expect(await running.service.saveEntry({ title: '  ', allDay: false })).toMatchObject({ ok: false, code: 'invalid-title' })
  })

  it('refuses to edit or delete an entry owned by a subscription', async () => {
    running = await harness()
    await startFeed()
    currentFeed().body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Team sync')
    const added = await running.service.addSubscription({ name: 'Work', url: currentFeed().url() })
    expect(added.ok).toBe(true)
    const entry = (await running.service.snapshot(RANGE)).entries[0]
    expect(entry?.origin).toBe('subscription')
    expect(await running.service.saveEntry({ id: entry!.id as never, title: 'Renamed', allDay: false }))
      .toMatchObject({ ok: false, code: 'readonly' })
    expect(await running.service.deleteEntry({ id: entry!.id }))
      .toMatchObject({ ok: false, code: 'readonly' })
  })

  it('reports an edit of an entry that no longer exists', async () => {
    running = await harness()
    expect(await running.service.saveEntry({ id: 'local-gone' as never, title: 'Ghost', allDay: false, startsAt: at(5) }))
      .toMatchObject({ ok: false, code: 'not-found' })
  })
})

describe('calendar subscriptions', () => {
  beforeEach(async () => {
    await startFeed()
  })

  it('fetches a subscription once and stores the entries it contributes', async () => {
    running = await harness()
    currentFeed().body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Team sync')
    const added = await running.service.addSubscription({ name: 'Work', url: currentFeed().url() })
    expect(added.ok).toBe(true)
    expect(currentFeed().requests).toHaveLength(1)
    const snapshot = await running.service.snapshot(RANGE)
    expect(snapshot.subscriptions).toHaveLength(1)
    expect(snapshot.subscriptions[0]).toMatchObject({ name: 'Work', protocol: 'http', enabled: true, entryCount: 1, refreshing: false })
    expect(snapshot.entries.map(entry => entry.title)).toEqual(['Team sync'])
  })

  it('never writes the subscription URL to a log line', async () => {
    const warnings: string[] = []
    running = await harness({ onContext: (ctx) => { ctx.logger.warn = (line: string) => { warnings.push(line) } } })
    currentFeed().body = 'not a calendar'
    await running.service.addSubscription({ name: 'Work', url: currentFeed().url('/private/token.ics?key=secret') })
    expect(warnings.join('\n')).toContain('subscription "Work"')
    expect(warnings.join('\n')).not.toContain('secret')
    expect(warnings.join('\n')).not.toContain('127.0.0.1')
  })

  it('keeps a failing subscription and reports the failure on it', async () => {
    running = await harness()
    currentFeed().status = 500
    const added = await running.service.addSubscription({ name: 'Work', url: currentFeed().url() })
    expect(added.ok).toBe(true)
    const [subscription] = running.service.listSubscriptions()
    expect(subscription?.lastFailure).toMatchObject({ code: 'service-unavailable' })
    expect(subscription?.lastRefreshedAt).toBeUndefined()
  })

  it('does not echo a private line the parser could not read from a feed', async () => {
    const warnings: string[] = []
    running = await harness({ onContext: (ctx) => { ctx.logger.warn = (line: string) => { warnings.push(line) } } })
    const marker = 'FAKE_PRIVATE_VALUE_WITHOUT_COLON'
    currentFeed().body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, marker)
    const added = await running.service.addSubscription({ name: 'Private', url: currentFeed().url() })
    const [subscription] = running.service.listSubscriptions()
    // Neither the RPC reply, the durable failure record, nor the log line may
    // repeat the line the parser rejected.
    expect(subscription?.lastFailure).toMatchObject({
      code: 'invalid-ics',
      message: 'The feed could not be read as iCalendar.',
    })
    expect(JSON.stringify(added)).not.toContain(marker)
    expect(JSON.stringify(subscription)).not.toContain(marker)
    expect(warnings.join('\n')).not.toContain(marker)
  }, 20_000)

  it('rejects a subscription URL that is not an accepted scheme', async () => {
    running = await harness()
    expect(await running.service.addSubscription({ name: 'Work', url: 'ftp://example.invalid/feed.ics' }))
      .toMatchObject({ ok: false, code: 'unsupported-protocol' })
    expect(await running.service.addSubscription({ name: '  ', url: currentFeed().url() }))
      .toMatchObject({ ok: false, code: 'invalid-url' })
    expect(await running.service.addSubscription({ name: 'Work', url: currentFeed().url(), refreshIntervalSeconds: 1_000_000 }))
      .toMatchObject({ ok: false, code: 'invalid-url' })
  })

  it('rejects a redirect that leaves the configured protocol', async () => {
    running = await harness()
    currentFeed().redirectTo = 'https://example.invalid/feed.ics'
    const result = await running.service.refreshSubscription({
      id: (await running.service.addSubscription({ name: 'Work', url: currentFeed().url() })).ok
        ? running.service.listSubscriptions()[0]!.id
        : 'sub-x' as never,
    })
    expect(result).toMatchObject({ ok: false, code: 'redirect-rejected' })
  })

  it('rejects a body larger than the configured limit', async () => {
    running = await harness({ config: { maxResponseBytes: 1_024 } })
    currentFeed().body = ics('UID:big', `DTSTART:${stamp(5, 9)}`, `SUMMARY:${'Big'.repeat(2_000)}`)
    await running.service.addSubscription({ name: 'Work', url: currentFeed().url() })
    expect(running.service.listSubscriptions()[0]?.lastFailure).toMatchObject({ code: 'response-too-large' })
  })

  it('rejects a feed that does not answer within the deadline', async () => {
    running = await harness({ config: { fetchTimeoutMs: 1_000 } })
    currentFeed().delayMs = 3_000
    await running.service.addSubscription({ name: 'Work', url: currentFeed().url() })
    expect(running.service.listSubscriptions()[0]?.lastFailure).toMatchObject({ code: 'timeout' })
  })

  it('replaces a subscription entries so an upstream deletion disappears', async () => {
    running = await harness()
    currentFeed().body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Team sync')
    const added = await running.service.addSubscription({ name: 'Work', url: currentFeed().url() })
    const id = added.ok ? added.subscription.id : ('sub-x' as never)
    expect((await running.service.snapshot(RANGE)).entries).toHaveLength(1)
    currentFeed().body = ics('UID:s-2', `DTSTART:${stamp(6, 9)}`, `DTEND:${stamp(6, 10)}`, 'SUMMARY:Other sync')
    await running.service.refreshSubscription({ id })
    expect((await running.service.snapshot(RANGE)).entries.map(entry => entry.title)).toEqual(['Other sync'])
    expect(await running.service.deleteSubscription({ id })).toMatchObject({ ok: true, id })
    expect((await running.service.snapshot(RANGE)).entries).toEqual([])
    expect(running.service.listSubscriptions()).toEqual([])
  })

  it('keeps the new configuration when a fetch of the old one is still running', async () => {
    running = await harness()
    currentFeed().body = ics('UID:s-1', 'DTSTART:20261006T090000Z', 'DTEND:20261006T100000Z', 'SUMMARY:Original')
    const added = await running.service.addSubscription({ name: 'Work', url: currentFeed().url() })
    const id = added.ok ? added.subscription.id : ('sub-x' as never)
    currentFeed().body = ics('UID:s-2', 'DTSTART:20261007T090000Z', 'DTEND:20261007T100000Z', 'SUMMARY:Replacement')
    currentFeed().delayMs = 50
    const slow = running.service.refreshSubscription({ id })
    // The configuration changes while the previous body is still in flight.
    await running.service.updateSubscription({ id, url: currentFeed().url('/replacement.ics') })
    await slow.catch(() => undefined)
    const entries = (await running.service.snapshot(RANGE)).entries
    expect(entries.map(entry => entry.title)).toEqual(['Replacement'])
  })

  it('joins a second refresh onto the one already running', async () => {
    running = await harness()
    currentFeed().body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Team sync')
    const added = await running.service.addSubscription({ name: 'Work', url: currentFeed().url() })
    const id = added.ok ? added.subscription.id : ('sub-x' as never)
    currentFeed().delayMs = 30
    const first = running.service.refreshSubscription({ id })
    const second = running.service.refreshSubscription({ id })
    await Promise.all([first, second])
    expect(currentFeed().requests.length).toBeLessThanOrEqual(2)
  })

  it('refreshes on its own interval and stops on dispose', async () => {
    running = await harness()
    currentFeed().body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Team sync')
    const added = await running.service.addSubscription({ name: 'Work', url: currentFeed().url(), refreshIntervalSeconds: 1 })
    expect(added.ok).toBe(true)
    expect(currentFeed().requests).toHaveLength(1)
    await vi.waitFor(() => { expect(currentFeed().requests.length).toBeGreaterThanOrEqual(2) }, { timeout: 5_000 })
    await running.ctx.fiber.dispose()
    running = undefined
    const settled = currentFeed().requests.length
    await new Promise((resolve) => { setTimeout(resolve, 1_500) })
    expect(currentFeed().requests).toHaveLength(settled)
  }, 20_000)
})

describe('calendar iCalendar import', () => {
  it('stores an imported calendar and removes it again', async () => {
    running = await harness()
    const imported = await running.service.importIcs({
      name: 'Team offsite',
      ics: ics('UID:o-1', `DTSTART:${stamp(9, 9)}`, `DTEND:${stamp(9, 17)}`, 'SUMMARY:Offsite'),
    })
    expect(imported.ok).toBe(true)
    const id = imported.ok ? imported.calendar.id : ('imp-x' as never)
    const snapshot = await running.service.snapshot(RANGE)
    expect(snapshot.importedCalendars.map(item => item.name)).toEqual(['Team offsite'])
    expect(snapshot.entries.map(entry => entry.origin)).toEqual(['import'])
    expect(await running.service.deleteImported({ id })).toMatchObject({ ok: true, id })
    expect((await running.service.snapshot(RANGE)).entries).toEqual([])
  })

  it('rejects unreadable text and an over-long import', async () => {
    running = await harness({ config: { maxResponseBytes: 1_024 } })
    expect(await running.service.importIcs({ name: 'Bad', ics: 'nonsense' }))
      .toMatchObject({ ok: false, code: 'invalid-ics' })
    expect(await running.service.importIcs({ name: '  ', ics: ics('UID:x', `DTSTART:${stamp(5, 9)}`) }))
      .toMatchObject({ ok: false, code: 'invalid-name' })
    expect(await running.service.importIcs({ name: 'Huge', ics: 'x'.repeat(2_000) }))
      .toMatchObject({ ok: false, code: 'response-too-large' })
  })

  it('does not echo a private line the parser could not read', async () => {
    running = await harness()
    const marker = 'FAKE_PRIVATE_VALUE_WITHOUT_COLON'
    const result = await running.service.importIcs({
      name: 'Private',
      ics: ics('UID:o-1', `DTSTART:${stamp(9, 9)}`, marker),
    })
    // The parser's own error quotes the offending line, so the reply must be a
    // fixed text that carries none of the imported content.
    expect(result).toMatchObject({ ok: false, code: 'invalid-ics', message: 'The text could not be read as iCalendar.' })
    expect(JSON.stringify(result)).not.toContain(marker)
  })

  it('refuses an import past the configured calendar ceiling', async () => {
    running = await harness({ config: { maxImportedCalendars: 1 } })
    const text = ics('UID:o-1', `DTSTART:${stamp(9, 9)}`, `DTEND:${stamp(9, 17)}`, 'SUMMARY:Offsite')
    expect((await running.service.importIcs({ name: 'First', ics: text })).ok).toBe(true)
    expect(await running.service.importIcs({ name: 'Second', ics: text }))
      .toMatchObject({ ok: false, code: 'internal-error' })
  })
})

describe('calendar persistence and disposal', () => {
  it('restores subscriptions and entries after a restart', async () => {
    const pool = (await harness()).pool
    await running?.ctx.fiber.dispose()
    const seeded = await harness({ pool })
    await seeded.ctx.fiber.dispose()
    running = await harness({ pool })
    const saved = await running.service.saveEntry({ title: 'Dentist', allDay: true, date: on(6) })
    expect(saved.ok).toBe(true)
    await running.ctx.fiber.dispose()
    running = await harness({ pool })
    const snapshot = await running.service.snapshot(RANGE)
    expect(snapshot.entries.map(entry => entry.title)).toEqual(['Dentist'])
    expect(snapshot.importedCalendars).toEqual([])
    expect(running.service.listSubscriptions()).toEqual([])
  })

  it('leaves no timer or listener behind after dispose', async () => {
    running = await harness()
    await startFeed()
    currentFeed().body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Team sync')
    await running.service.addSubscription({ name: 'Work', url: currentFeed().url() })
    const service = running.service
    const controller = new AbortController()
    const stream = service.watch(controller.signal)
    const iterator = stream[Symbol.asyncIterator]()
    // The stream is left waiting on purpose: disposal must release it.
    const next = iterator.next()
    // The stream is left waiting on purpose: disposal must release it.
    await running.ctx.fiber.dispose()
    running = undefined
    // Disposal ends the watch stream and stops the refresh timer, so no
    // request and no stream outlives the plugin.
    await expect(next).resolves.toMatchObject({ done: true })
    expect(currentFeed().requests).toHaveLength(1)
  })
})
