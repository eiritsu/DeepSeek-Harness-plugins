import { Context, Service } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import ScheduleService from '../../../schedule/schedule/src/index.ts'
import { describe, expect, it, vi } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { CalendarService } from '../src/service.ts'
import { testConfig } from './harness.ts'

/** The moment both cases start, so every instant below is a fixed offset. */
const START = new Date('2026-10-05T09:00:00.000Z')

/** The instant the automation under test is due. */
const DUE = '2026-10-05T09:00:01.000Z'

/**
 * Mount the composition a calendar-created automation travels through: the real
 * agent loop, the real Host Schedule service, real storage, and the calendar.
 *
 * Model execution is held by maintenance for the whole case, so the turn opens
 * and records its inbox splice but no request leaves the process and the suite
 * needs no API key. The `session/flush` listener holds the acknowledgment open,
 * which is what makes the boundary between "the reminder reached the inbox" and
 * "the delivery was recorded" observable rather than a race.
 * @param acknowledge - `accept` registers a persistence listener that holds
 *   the acknowledgment open; `decline` registers none, so the Session store
 *   reports that no persistence backend participated.
 * @returns the calendar service and the points where the case releases the held work.
 */
async function composition(acknowledge: 'accept' | 'decline') {
  const ctx = new Context()
  const releaseMaintenance = Promise.withResolvers<undefined>()
  const releaseFlush = Promise.withResolvers<undefined>()
  const flushStarted = Promise.withResolvers<undefined>()
  let eventsAtFlush: readonly SessionEvent[] = []
  let maintenance: Promise<unknown> = Promise.resolve()
  try {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    await mountAgentLoopTestDependencies(ctx)
    const loop = await mountAgentLoopTestHarness(ctx)
    const agent = await loop.create(SessionId('calendar-delivery'))
    maintenance = agent.runMaintenance(() => releaseMaintenance.promise)
    ctx.provide('sessionController', {
      resolveAgent: vi.fn(async () => ({ agent })),
      list: vi.fn(async () => ({
        items: [{
          sessionId: agent.session.id,
          agentAvailable: true,
          running: false,
          blank: true,
          updatedAt: START.getTime(),
        }],
      })),
    } as never)

    await ctx.plugin(Storage)
    const backend = new MemoryStorageBackend(new MemoryMediaPool())
    ctx.effect(() => ctx.storage.backend.register('delivery', backend))
    ctx.effect(() => async () => { await backend.close() })
    const facility = new DomainFacility(ctx, { backend: 'delivery' })
    ctx.effect(() => {
      const unmount = ctx.storage.mount('domain', facility)
      ctx.provide('storageDomain', facility)
      return async () => { await facility.closeAll(); unmount() }
    })
    ctx.provide('sessionPersistence', {} as never)
    await ctx.plugin(ScheduleService, { deliveryHistoryDays: 30, deliveryHistoryRecords: 20 })
    // A Session flush reports whether a persistence listener participated at
    // all, so declining means registering none rather than answering false.
    if (acknowledge === 'accept') {
      ctx.on('session/flush', async (session) => {
        eventsAtFlush = session.snapshotEvents()
        flushStarted.resolve(undefined)
        // Holding the acknowledgment open is what makes the boundary between
        // "the reminder reached the inbox" and "the delivery was recorded"
        // observable rather than a race.
        await releaseFlush.promise
      })
    }

    const service = new CalendarService(ctx, testConfig())
    await service[Service.init]()
    return {
      agent,
      service,
      flushStarted,
      releaseFlush,
      eventsAtFlush: () => eventsAtFlush,
      async settle(): Promise<void> {
        releaseFlush.resolve(undefined)
        await vi.advanceTimersByTimeAsync(1_000)
      },
      async teardown(): Promise<void> {
        releaseFlush.resolve(undefined)
        agent.cancel({ kind: 'user' })
        releaseMaintenance.resolve(undefined)
        await maintenance
        await ctx.fiber.dispose()
      },
    }
  } catch (error: unknown) {
    releaseFlush.resolve(undefined)
    releaseMaintenance.resolve(undefined)
    await maintenance
    await ctx.fiber.dispose()
    vi.useRealTimers()
    throw error
  }
}

describe('calendar automation delivered into a real Session', () => {
  it('reaches the Session inbox and records the delivery only once acknowledged', async () => {
    const harness = await composition('accept')
    try {
      // The target is one second out, so the Schedule runtime's own timer
      // decides when the reminder becomes due; the case only moves the clock.
      const created = await harness.service.createTask({
        sessionId: 'calendar-delivery',
        title: 'Standup reminder',
        prompt: 'Join the standup',
        at: DUE,
      })
      expect(created.ok).toBe(true)
      const id = created.ok ? created.task.id : ('schedule-x' as never)

      await vi.advanceTimersByTimeAsync(2_000)
      await harness.flushStarted.promise

      const inserted = harness.eventsAtFlush()
        .flatMap(event => event.type === 'agent/inbox/spliced' ? event.data.inserted : [])
      // The reminder reached the Session inbox, carrying the Schedule source.
      expect(inserted).toHaveLength(1)
      expect(inserted[0]?.source).toEqual({ kind: 'schedule' })
      expect(harness.agent.inbox.nextTurn).toEqual(inserted)

      // The flush is still held, so nothing is recorded yet: a delivery is
      // only a delivery once persistence acknowledged it.
      const held = await harness.service.snapshot({
        rangeStart: '2026-10-05T00:00:00.000Z',
        rangeEnd: '2026-10-06T00:00:00.000Z',
      })
      expect(held.tasks.find(task => task.id === id)?.lastDelivery).toBeUndefined()

      await harness.settle()
      const settled = await harness.service.snapshot({
        rangeStart: '2026-10-05T00:00:00.000Z',
        rangeEnd: '2026-10-06T00:00:00.000Z',
      })
      const task = settled.tasks.find(item => item.id === id)
      expect(task?.status).toBe('inactive')
      // The receipt records the occurrence and when the inbox took it. It is
      // not a report that the Agent acted on the reminder.
      expect(task?.lastDelivery?.scheduledAt).toBe(DUE)
      expect(task?.lastDelivery?.deliveredAt).toBeDefined()
      expect(settled.occurrences.find(item => item.taskId === id)?.status).toBe('inactive')
      // Model execution was held for the whole case, so no reply was produced.
      expect(harness.agent.session.snapshotEvents().some(event => event.type === 'assistant/message')).toBe(false)
    } finally {
      await harness.teardown()
      vi.useRealTimers()
    }
  }, 30_000)

  it('keeps the automation armed when persistence declines the delivery', async () => {
    const harness = await composition('decline')
    try {
      const created = await harness.service.createTask({
        sessionId: 'calendar-delivery',
        title: 'Standup reminder',
        prompt: 'Join the standup',
        at: DUE,
      })
      const id = created.ok ? created.task.id : ('schedule-x' as never)

      // No persistence listener participates, so the runtime's own flush
      // returns false and the reminder is retried rather than recorded.
      await vi.advanceTimersByTimeAsync(5_000)

      const snapshot = await harness.service.snapshot({
        rangeStart: '2026-10-05T00:00:00.000Z',
        rangeEnd: '2026-10-06T00:00:00.000Z',
      })
      const task = snapshot.tasks.find(item => item.id === id)
      // An unacknowledged delivery is not a delivery: the task stays armed and
      // records no receipt.
      expect(task?.status).toBe('active')
      expect(task?.lastDelivery).toBeUndefined()
    } finally {
      await harness.teardown()
      vi.useRealTimers()
    }
  }, 30_000)
})
