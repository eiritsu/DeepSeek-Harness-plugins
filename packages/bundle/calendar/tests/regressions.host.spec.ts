import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { WriteBarrier, harness } from './harness.ts'
import type { Harness } from './harness.ts'

/** Half-open display window relative to the Host clock. */
const RANGE = {
  rangeStart: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  rangeEnd: new Date(Date.now() + 89 * 86_400_000).toISOString(),
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
 * A compact `DTSTART` line value a fixed number of days from now.
 * @param days - Days from now.
 * @param hours - Hours after midnight UTC.
 * @returns the iCalendar date-time value.
 */
function stamp(days: number, hours: number): string {
  return atHour(days, hours).replace(/[-:]/g, '').replace('.000', '')
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

/** A loopback feed whose responses a case controls. */
class Feed {
  private server: Server | undefined
  body = ''
  status = 200
  delayMs = 0
  /** Requests the server received. */
  readonly requests: string[] = []
  /** Requests the server started and has not finished answering. */
  pending = 0
  /** Resolves once each accepted request has settled. */
  private readonly settlements = new Set<Promise<void>>()

  /** Response timers this server owns; every one is cleared before it closes. */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()

  /** Start listening on an ephemeral loopback port. */
  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      this.requests.push(request.url ?? '')
      this.pending += 1
      let timer: ReturnType<typeof setTimeout> | undefined
      // Both the response close and the timer reaching its write end call
      // this, so the request settles exactly once and the case can await it.
      let settledOnce = false
      let markSettled: () => void = () => {}
      const settlement = new Promise<void>((resolve) => { markSettled = resolve })
      this.settlements.add(settlement)
      const done = (): void => {
        if (settledOnce) return
        settledOnce = true
        if (timer !== undefined) { clearTimeout(timer); this.timers.delete(timer); timer = undefined }
        this.pending -= 1
        markSettled()
      }
      const send = (): void => {
        if (response.writableEnded || response.destroyed) { done(); return }
        response.writeHead(this.status)
        response.end(this.body)
        done()
      }
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

  /** Absolute loopback URL for one path. */
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

let running: Harness | undefined
let feed: Feed | undefined

afterEach(async () => {
  await running?.ctx.fiber.dispose()
  running = undefined
  await feed?.stop()
  feed = undefined
})

describe('restored subscription refresh', () => {
  it('refreshes a subscription restored from storage instead of treating it as stale', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness({ pool })
    feed = new Feed()
    await feed.start()
    feed.body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Before restart')
    const added = await first.service.addSubscription({ name: 'Work', url: feed.url() })
    expect(added.ok).toBe(true)
    await first.ctx.fiber.dispose()

    // A fresh Host has no in-memory generation for the stored row; the missing
    // key must read as the same value the running fetch started from.
    running = await harness({ pool })
    const [restored] = running.service.listSubscriptions()
    expect(restored?.name).toBe('Work')
    feed.body = ics('UID:s-1', `DTSTART:${stamp(6, 9)}`, `DTEND:${stamp(6, 10)}`, 'SUMMARY:After restart')
    const refreshed = await running.service.refreshSubscription({ id: restored!.id })
    expect(refreshed.ok).toBe(true)
    expect((await running.service.snapshot(RANGE)).entries.map(entry => entry.title)).toEqual(['After restart'])
  }, 20_000)

  it('clears a recorded failure once a later refresh succeeds', async () => {
    running = await harness()
    feed = new Feed()
    await feed.start()
    feed.status = 503
    const added = await running.service.addSubscription({ name: 'Work', url: feed.url() })
    const id = added.ok ? added.subscription.id : ('sub-x' as never)
    expect(running.service.listSubscriptions()[0]?.lastFailure).toMatchObject({ code: 'service-unavailable' })
    expect(running.service.listSubscriptions()[0]?.lastRefreshedAt).toBeUndefined()

    feed.status = 200
    feed.body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Recovered')
    const refreshed = await running.service.refreshSubscription({ id })
    expect(refreshed.ok).toBe(true)
    const [subscription] = running.service.listSubscriptions()
    expect(subscription?.lastFailure).toBeUndefined()
    expect(subscription?.lastRefreshedAt).toBeDefined()
  }, 20_000)
})

describe('serialized refresh commit', () => {
  it('does not resurrect a subscription deleted while its fetch was in flight', async () => {
    const pool = new MemoryMediaPool()
    const barrier = new WriteBarrier()
    const backend = barrier.gate(new MemoryStorageBackend(pool), 'entries')
    running = await harness({ pool, backend })
    feed = new Feed()
    await feed.start()
    feed.body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Team sync')
    const added = await running.service.addSubscription({ name: 'Work', url: feed.url() })
    const id = added.ok ? added.subscription.id : ('sub-x' as never)
    expect((await running.service.snapshot(RANGE)).entries).toHaveLength(1)

    // The next refresh's entry write is held open mid-commit.
    feed.body = ics('UID:s-2', `DTSTART:${stamp(6, 9)}`, `DTEND:${stamp(6, 10)}`, 'SUMMARY:Replacement')
    barrier.hold()
    const slow = running.service.refreshSubscription({ id })
    expect(await barrier.wait()).toBe(true)

    // A delete queues behind the held commit; its generation bump is what the
    // commit re-checks, so the entries must not come back.
    const removed = running.service.deleteSubscription({ id })
    barrier.open()
    await slow.catch(() => undefined)
    await removed

    expect(running.service.listSubscriptions()).toEqual([])
    expect((await running.service.snapshot(RANGE)).entries).toEqual([])
  }, 20_000)

  it('discards a fetch whose settings changed while it was committing', async () => {
    const pool = new MemoryMediaPool()
    const barrier = new WriteBarrier()
    const backend = barrier.gate(new MemoryStorageBackend(pool), 'entries')
    running = await harness({ pool, backend })
    feed = new Feed()
    await feed.start()
    feed.body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Original')
    const added = await running.service.addSubscription({ name: 'Work', url: feed.url() })
    const id = added.ok ? added.subscription.id : ('sub-x' as never)

    feed.body = ics('UID:s-2', `DTSTART:${stamp(6, 9)}`, `DTEND:${stamp(6, 10)}`, 'SUMMARY:Replacement')
    barrier.hold()
    const slow = running.service.refreshSubscription({ id })
    expect(await barrier.wait()).toBe(true)
    feed.body = ics('UID:s-3', `DTSTART:${stamp(7, 9)}`, `DTEND:${stamp(7, 10)}`, 'SUMMARY:Newest')
    const changed = running.service.updateSubscription({ id, url: feed.url('/newest.ics') })
    barrier.open()
    await slow.catch(() => undefined)
    await changed

    const entries = (await running.service.snapshot(RANGE)).entries
    expect(entries.map(entry => entry.title)).toEqual(['Newest'])
    expect(running.service.listSubscriptions()[0]?.url).toContain('/newest.ics')
  }, 20_000)
})

describe('local entry change notifications', () => {
  it('publishes a frame for a committed write and none for a rejected one', async () => {
    running = await harness()
    const seen: string[] = []
    const controller = new AbortController()
    const stream = running.service.watch(controller.signal)
    const collected = (async () => {
      for await (const frame of stream) {
        seen.push(frame.reason)
        if (seen.length >= 2) break
      }
    })()
    await running.service.saveEntry({ title: 'Dentist', allDay: true, date: atHour(6, 0).slice(0, 10) })
    await running.service.saveEntry({ title: '  ', allDay: false })
    const created = (await running.service.snapshot(RANGE)).entries[0]
    await running.service.deleteEntry({ id: created!.id })
    await collected
    controller.abort()
    expect(seen).toEqual(['entry-saved', 'entry-deleted'])
  }, 20_000)
})

describe('subscription truncation state', () => {
  it('records what the bounds rejected so the source is not silently partial', async () => {
    running = await harness({ config: { maxOccurrencesPerEvent: 1 } })
    feed = new Feed()
    await feed.start()
    feed.body = ics(
      'UID:s-1',
      `DTSTART:${stamp(4, 9)}`,
      `DTEND:${stamp(4, 10)}`,
      'RRULE:FREQ=DAILY;COUNT=5',
      'SUMMARY:Daily',
    )
    const added = await running.service.addSubscription({ name: 'Work', url: feed.url() })
    expect(added.ok).toBe(true)
    const [subscription] = running.service.listSubscriptions()
    // The per-event ceiling kept one of the five occurrences, and the rest are
    // reported on the subscription itself rather than only in the refresh reply.
    expect(subscription?.droppedEntryCount).toBe(4)
    expect((await running.service.snapshot(RANGE)).entries).toHaveLength(1)
    // The snapshot's own return ceiling is a different fact and stays false.
    expect((await running.service.snapshot(RANGE)).entriesTruncated).toBe(false)
  }, 20_000)
})

describe('configuration lifecycle', () => {
  it('applies a changed bound on the next fetch instead of only at start', async () => {
    running = await harness()
    feed = new Feed()
    await feed.start()
    feed.body = 'x'.repeat(4_000)
    await running.service.addSubscription({ name: 'Work', url: feed.url() })
    const id = running.service.listSubscriptions()[0]!.id
    // The running store reads the volatile field, so a form edit takes effect
    // without a Host restart.
    running.setBound('maxResponseBytes', 1_024)
    feed.body = ics('UID:s-1', `DTSTART:${stamp(5, 9)}`, `DTEND:${stamp(5, 10)}`, 'SUMMARY:Small now')
    const refreshed = await running.service.refreshSubscription({ id })
    expect(refreshed.ok).toBe(true)
    expect((await running.service.snapshot(RANGE)).entries.map(entry => entry.title)).toEqual(['Small now'])
  }, 20_000)
})

describe('negative-zone civil dates', () => {
  it('accepts a whole-day date in a zone behind UTC', async () => {
    running = await harness()
    // A fixed civil date, rendered nowhere: validity is a property of the date.
    const created = await running.service.saveEntry({ title: 'Dentist', allDay: true, date: '2026-10-06' })
    expect(created).toMatchObject({ ok: true, entry: { date: '2026-10-06' } })
    expect(await running.service.saveEntry({ title: 'Trip', allDay: true, date: '2026-02-30' }))
      .toMatchObject({ ok: false, code: 'invalid-time' })
  })

  it('selects whole-day entries by the civil dates the requested zone covers', async () => {
    running = await harness()
    await running.service.saveEntry({ title: 'First of October', allDay: true, date: '2026-10-01' })
    await running.service.saveEntry({ title: 'Last of September', allDay: true, date: '2026-09-30' })
    // October in a zone behind UTC starts on the evening of 30 September UTC,
    // so a UTC-midnight comparison would include the wrong September day.
    const snapshot = await running.service.snapshot({
      rangeStart: '2026-09-30T16:00:00.000Z',
      rangeEnd: '2026-10-31T16:00:00.000Z',
      timeZone: 'America/Los_Angeles',
    })
    expect(snapshot.entries.map(entry => entry.title)).toEqual(['Last of September', 'First of October'])
  })

  it('includes a timed entry with no end that starts on the range start', async () => {
    running = await harness()
    await running.service.saveEntry({ title: 'Instant', allDay: false, startsAt: '2026-10-01T00:00:00.000Z' })
    const snapshot = await running.service.snapshot({ rangeStart: '2026-10-01T00:00:00.000Z', rangeEnd: '2026-10-02T00:00:00.000Z' })
    expect(snapshot.entries.map(entry => entry.title)).toEqual(['Instant'])
  })
})
