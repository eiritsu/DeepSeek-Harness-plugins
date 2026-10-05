// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { registerCalendarSurfaces } from '../src/client/register.ts'
import type { CalendarFace, CalendarState } from '../src/client/controller.ts'

function initialState(): CalendarState {
  return {
    view: 'month', year: 2026, month: 10, selectedDate: '2026-10-05', filter: 'all',
    loading: false, refreshing: false, errorKey: undefined, items: [], subscriptions: [], imported: [],
    selectableSessions: [], hostSelectableSessions: [], hostSnapshotLoaded: false, sessionLabels: {},
    allowedSessionIds: [], sessionDirectoryLoaded: false, serviceAvailable: true, now: '2026-10-05T00:00:00.000Z',
    hostTimeZone: 'UTC', snapshotTimeZone: 'UTC', occurrencesTruncated: false, entriesTruncated: false,
    feedback: { busy: false },
  }
}

function face(): CalendarFace {
  return {
    hooks: { calendar: createSnapshotStore(initialState()) },
    onOpenSession: () => {},
    setView: () => {}, setFilter: () => {}, selectDate: () => {}, stepMonth: () => {}, goToday: () => {},
    refresh: () => {}, clearFeedback: () => {},
    createTask: async () => ({ ok: true }), updateTask: async () => ({ ok: true }), cancelTask: async () => ({ ok: true }),
    addSubscription: async () => ({ ok: true }), updateSubscription: async () => ({ ok: true }),
    removeSubscription: async () => ({ ok: true }), refreshSubscription: async () => ({ ok: true }),
    importIcs: async () => ({ ok: true }), removeImported: async () => ({ ok: true }),
  }
}

async function bench(served: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'main': { kind: 'keyed', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const whileServed = vi.fn((namespaces: readonly string[], register: (current: ReadonlySet<string>) => () => void) => {
    const dispose = served ? register(new Set(namespaces)) : undefined
    return () => { dispose?.() }
  })
  ctx.provide('configForms', { whileServed } as never)
  const fiber = ctx.plugin({
    inject: ['slots', 'locale', 'configForms'],
    apply: (scope) => { registerCalendarSurfaces(scope, face()) },
  })
  await fiber.await()
  return { ctx, slots, fiber, whileServed }
}

describe('calendar surface registration', () => {
  it('registers the centre panel, sidebar entry, and bundle config page with the exact keys', async () => {
    const { slots, fiber, whileServed } = await bench(true)
    expect(whileServed).toHaveBeenCalledWith(['calendar'], expect.any(Function))
    expect(slots.entries('main')[0]?.options).toMatchObject({ key: 'calendar' })
    expect(slots.entries('sidebar.panellist')[0]?.options).toMatchObject({ id: 'calendar', order: 30 })
    expect(slots.entries('plugins.bundle.config')[0]?.options).toMatchObject({ key: '@deepseek-ai/dsh-calendar' })
    await fiber.dispose()
  })

  it('removes every registration when the plugin fiber is disposed', async () => {
    const { slots, fiber } = await bench(true)
    expect(slots.entries('main')).toHaveLength(1)
    await fiber.dispose()
    expect(slots.entries('main')).toHaveLength(0)
    expect(slots.entries('sidebar.panellist')).toHaveLength(0)
    expect(slots.entries('plugins.bundle.config')).toHaveLength(0)
  })

  it('skips the bundle config page when its namespace is not served', async () => {
    const { slots, fiber } = await bench(false)
    expect(slots.entries('main')).toHaveLength(1)
    expect(slots.entries('sidebar.panellist')).toHaveLength(1)
    expect(slots.entries('plugins.bundle.config')).toHaveLength(0)
    await fiber.dispose()
  })
})
