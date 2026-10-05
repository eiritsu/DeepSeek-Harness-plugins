/** Host calendar tests: real Session store, real domain storage, optional real Schedule service. */
import { Context, Service } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import type { KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { vi } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import ScheduleService from '../../../schedule/schedule/src/index.ts'
import AgentRegistry from '../../../core/agent/src/index.ts'
import SystemPrompt from '../../../core/system-prompt/src/index.ts'
import ToolRuntime from '../../../core/tools/src/index.ts'
import { CalendarService } from '../src/service.ts'
import type { Config } from '../src/config.ts'

/** Raw numeric defaults a case starts from. */
const DEFAULTS: Record<keyof Config, number> = {
  fetchTimeoutMs: 1_000,
  maxResponseBytes: 65_536,
  defaultRefreshIntervalSeconds: 3_600,
  minRefreshIntervalSeconds: 1,
  maxRefreshIntervalSeconds: 86_400,
  retentionDays: 90,
  maxEventsPerSubscription: 100,
  maxOccurrencesPerEvent: 500,
  maxExpansionIterations: 5_000,
  maxOccurrencesPerSubscription: 2_000,
  expansionHorizonDays: 180,
  maxImportedCalendars: 5,
  maxEntriesPerSnapshot: 500,
  maxOccurrencesPerTask: 200,
  maxOccurrences: 1_000,
}

/** The config object the service reads, plus the write path a case drives. */
export interface LiveConfig {
  /** The object handed to the service constructor. */
  readonly config: Config
  /** Change one bound, which is what a configuration-form edit does. */
  set(field: keyof Config, value: number): void
}

/**
 * Build the volatile accessors the service reads, plus the write path.
 *
 * `Volatile` exposes only `get()`, so each field reads the map below it. The
 * object is written field by field rather than assembled through a cast, so a
 * bound added to the plugin's configuration is a compile error here until the
 * fixture supplies it.
 * @param overrides - Numbers replacing the defaults.
 * @returns the config object and a setter for one bound.
 */
export function buildConfig(overrides: Partial<Record<keyof Config, number>>): LiveConfig {
  const values: Record<keyof Config, number> = { ...DEFAULTS, ...overrides }
  const read = (field: keyof Config): number => values[field]
  const set = (field: keyof Config, value: number): void => { values[field] = value }
  return {
    config: {
      fetchTimeoutMs: { get: () => read('fetchTimeoutMs') },
      maxResponseBytes: { get: () => read('maxResponseBytes') },
      defaultRefreshIntervalSeconds: { get: () => read('defaultRefreshIntervalSeconds') },
      minRefreshIntervalSeconds: { get: () => read('minRefreshIntervalSeconds') },
      maxRefreshIntervalSeconds: { get: () => read('maxRefreshIntervalSeconds') },
      retentionDays: { get: () => read('retentionDays') },
      maxEventsPerSubscription: { get: () => read('maxEventsPerSubscription') },
      maxOccurrencesPerEvent: { get: () => read('maxOccurrencesPerEvent') },
      maxExpansionIterations: { get: () => read('maxExpansionIterations') },
      maxOccurrencesPerSubscription: { get: () => read('maxOccurrencesPerSubscription') },
      expansionHorizonDays: { get: () => read('expansionHorizonDays') },
      maxImportedCalendars: { get: () => read('maxImportedCalendars') },
      maxEntriesPerSnapshot: { get: () => read('maxEntriesPerSnapshot') },
      maxOccurrencesPerTask: { get: () => read('maxOccurrencesPerTask') },
      maxOccurrences: { get: () => read('maxOccurrences') },
    },
    set,
  }
}

/**
 * Wrap numbers in the volatile accessors the service reads.
 * @param overrides - Numbers replacing the defaults.
 * @returns the config object.
 */
export function testConfig(overrides: Partial<Record<keyof Config, number>> = {}): Config {
  return buildConfig(overrides).config
}

/**
 * A barrier a case can hold open in front of one storage primitive.
 *
 * The store's writes are serialized, so a deterministic test needs a way to
 * stop a commit in the middle of its entry replacement and observe what a
 * concurrent delete or settings change does around it.
 */
export class WriteBarrier {
  private waiters: (() => void)[] = []
  private held = false

  /** Hold the next matching writes until `open()` is called. */
  hold(): void {
    this.held = true
  }

  /** Let the held writes proceed. */
  open(): void {
    this.held = false
    const waiting = this.waiters
    this.waiters = []
    for (const resolve of waiting) resolve()
  }

  /**
   * Wait until at least one write is being held.
   * @param timeoutMs - Give up after this long.
   * @returns whether a write reached the barrier.
   */
  async wait(timeoutMs = 2_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (!this.held || this.waiters.length === 0) {
      if (Date.now() > deadline) return false
      await new Promise((resolve) => { setTimeout(resolve, 5) })
    }
    return true
  }

  /**
   * Wrap a backend so writes to one table wait at this barrier.
   *
   * The parameter is the concrete in-memory backend, whose `kv` facet is
   * declared, so the wrapped unit is read without a narrowing assertion.
   * @param backend - Backend whose writes are gated.
   * @param table - Table name to gate.
   * @returns the gated backend.
   */
  gate(backend: MemoryStorageBackend, table: string): StorageBackend {
    const wait = (): Promise<void> => new Promise<void>((resolve) => { this.waiters.push(resolve) })
    return {
      close: () => backend.close(),
      kv: {
        open: async (descriptor: KvUnitDescriptor): Promise<KvUnit> => {
          const unit = await backend.kv.open(descriptor)
          if (descriptor.name !== 'calendar') return unit
          const backup = unit.backupRecord?.bind(unit)
          return {
            loadAll: () => unit.loadAll(),
            putRecord: async (name, key, value) => {
              if (name === table && this.held) await wait()
              await unit.putRecord(name, key, value)
            },
            deleteRecord: async (name, key) => {
              if (name === table && this.held) await wait()
              await unit.deleteRecord(name, key)
            },
            setGlobal: value => unit.setGlobal(value),
            close: () => unit.close(),
            ...(backup === undefined ? {} : { backupRecord: backup }),
          }
        },
      },
    }
  }
}

/** One Session a case makes visible to the optional Session controller. */
export interface HarnessSession {
  readonly id: string
  readonly cwd?: string
  readonly updatedAt?: number
  readonly blank?: boolean
  /** Coarse durable origin; a subagent Session must never be selectable. */
  readonly origin?: 'subagent'
}

/** Options a harness case controls. */
export interface HarnessOptions {
  /** Run with the official Schedule service mounted; the default is without it. */
  readonly schedule?: boolean
  /** Session identities the optional Session controller lists. */
  readonly listedSessions?: readonly string[]
  /** Session identities with the metadata the controller returns. */
  readonly sessions?: readonly HarnessSession[]
  /** Session ids the optional Workspace registry reports as archived. */
  readonly archivedSessionIds?: readonly string[]
  /** Replaces the Session controller's list read, e.g. to hold it pending. */
  readonly listSessions?: (signal?: AbortSignal) => Promise<readonly HarnessSession[]>
  /** Media pool carried across a simulated restart. */
  readonly pool?: MemoryMediaPool
  /** Backend the case supplies instead of the in-memory default. */
  readonly backend?: StorageBackend
  /** Config overrides applied to the calendar row. */
  readonly config?: Partial<Record<keyof Config, number>>
  /** Context hook for cases that need to observe or replace a service. */
  readonly onContext?: (ctx: Context) => void
}

/** Everything a case needs to drive the calendar service. */
export interface Harness {
  readonly ctx: Context
  readonly service: CalendarService
  readonly pool: MemoryMediaPool
  readonly domain: DomainFacility
  /**
   * Change one configuration value on the running service.
   *
   * The service reads each bound through its volatile accessor, so a case that
   * assigns here exercises the same path a configuration-form edit takes.
   * @param key - Bound to change.
   * @param value - New value.
   */
  setBound(key: keyof Config, value: number): void
  /** Create a live Session through the real Session store. */
  liveSession(id: string): SessionId
}

/**
 * Mount the calendar service over real storage with or without the optional
 * Schedule service, so a case exercises real composition rather than a
 * hand-built context.
 * @param options - Which optional services this case runs with.
 * @returns the context, service, storage pool, and configuration.
 */
export async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Storage)
  const pool = options.pool ?? new MemoryMediaPool()
  const backend = options.backend ?? new MemoryStorageBackend(pool)
  ctx.effect(() => ctx.storage.backend.register('fixture', backend))
  ctx.effect(() => async () => { await backend.close() })
  const facility = new DomainFacility(ctx, { backend: 'fixture' })
  ctx.effect(() => {
    const unmount = ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    return async () => { await facility.closeAll(); unmount() }
  })
  const listed: HarnessSession[] = [...(options.sessions ?? options.listedSessions?.map(id => ({ id })) ?? [])]
  const listSessions = options.listSessions
  const archivedIds = options.archivedSessionIds ?? []
  ctx.provide('workspaceRegistry', {
    get archivedSessionIds() { return archivedIds.map(id => SessionId(id)) },
  } as never)
  ctx.provide('sessionController', {
    list: vi.fn(async (signal?: AbortSignal) => {
      const rows = listSessions === undefined ? listed : await listSessions(signal)
      return {
        items: rows.map(item => ({
          sessionId: SessionId(item.id),
          agentAvailable: false,
          running: false,
          blank: item.blank ?? true,
          updatedAt: item.updatedAt ?? 0,
          ...(item.origin === undefined ? {} : { origin: item.origin }),
          ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
        })),
      }
    }),
    resolveAgent: vi.fn(async () => { throw new Error('missing Session') }),
  } as never)
  // The Schedule service flushes only when persistence acknowledges a delivery,
  // which the store reports through whether a listener participated at all. A
  // case that needs a real delivery supplies its own Agent instead.
  ctx.on('session/flush', () => {
    // A registered listener is the acknowledgment this fixture stands for.
  })
  ctx.provide('sessionPersistence', {} as never)
  if (options.schedule === true) {
    await ctx.plugin(ScheduleService, { deliveryHistoryDays: 30, deliveryHistoryRecords: 20 })
  }
  options.onContext?.(ctx)
  const live = buildConfig(options.config ?? {})
  const service = new CalendarService(ctx, live.config)
  await service[Service.init]()
  return {
    ctx,
    service,
    pool,
    domain: facility,
    setBound: (field, value) => { live.set(field, value) },
    liveSession(id: string): SessionId {
      return ctx.sessions.create(SessionId(id)).id
    },
  }
}
