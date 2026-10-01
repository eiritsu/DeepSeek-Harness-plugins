/** SQLite persistence for applications that need one authoritative Session database. */

/* oxlint-disable typescript/require-await -- DatabaseSync backs the asynchronous persistence API. */

import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset as Offset } from '@deepseek-ai/dsh-session'
import {
  assertContiguous,
  assertStoredId,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistence,
  SessionPersistenceCorruptionError,
  SessionPersistenceNotFoundError,
  SessionPersistenceRevision,
  SessionReadOnlyError,
  validateStoredEvents,
} from '@deepseek-ai/dsh-session-persistence'
import type {
  SessionAccess,
  SessionHandle,
  SessionHandleAppendOptions,
  SessionHandleFlushOptions,
  SessionHandleReadOptions,
  SessionHandleReadResult,
  SessionPersistenceCreateOptions,
  SessionPersistenceListOptions,
  SessionPersistenceOpenOptions,
  SessionPersistenceSnapshot,
  SessionPersistenceStatOptions,
} from '@deepseek-ai/dsh-session-persistence'

/** Current SQLite database layout. This package starts with a new schema lineage. */
export const SCHEMA_VERSION = 1

/** Provider configuration. */
export interface Config {
  /** SQLite database path, or `:memory:` for tests. */
  readonly path: string
}

/** Loader schema for provider configuration. */
export const Config: z<Config> = z.object({ path: z.string().required() })

interface MetadataRow {
  readonly id: string
  readonly header_json: string
  readonly inherited_event_count: number
  readonly event_count: number
  readonly revision: number
}

interface EventRow {
  readonly seq: number
  readonly event_json: string
}

function stringColumn(row: Record<string, SQLOutputValue>, column: string): string {
  const value = row[column]
  if (typeof value !== 'string') throw new Error(`SQLite column ${column} is not text`)
  return value
}

function integerColumn(row: Record<string, SQLOutputValue>, column: string): number {
  const value = row[column]
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`SQLite column ${column} is not a safe integer`)
  return value
}

function metadataRow(row: Record<string, SQLOutputValue>): MetadataRow {
  return {
    id: stringColumn(row, 'id'),
    header_json: stringColumn(row, 'header_json'),
    inherited_event_count: integerColumn(row, 'inherited_event_count'),
    event_count: integerColumn(row, 'event_count'),
    revision: integerColumn(row, 'revision'),
  }
}

function eventRow(row: Record<string, SQLOutputValue>): EventRow {
  return { seq: integerColumn(row, 'seq'), event_json: stringColumn(row, 'event_json') }
}

interface PendingSession {
  readonly header: SessionHeader
  readonly inheritedEventCount: Offset
  readonly token: string
}

/** Freeze one JSON event graph after validation. */
function freezeEvent(event: SessionEvent): void {
  const pending: object[] = [event]
  while (pending.length > 0) {
    const value = pending.pop()
    if (value === undefined) continue
    Object.freeze(value)
    for (const key in value) {
      const child = (value as Record<string, unknown>)[key]
      if (child !== null && typeof child === 'object') pending.push(child)
    }
  }
}

/** Check whether a recorded process still exists on this host. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true
    throw error
  }
}

/** One SQLite-backed handle. */
class SqliteSessionHandle implements SessionHandle {
  private closed = false
  private closing: Promise<void> | undefined
  private chain: Promise<void> = Promise.resolve()
  private buffered: SessionEvent[] = []
  private cursor: number
  private materialized: boolean

  constructor(
    private readonly owner: SqliteSessionPersistence,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly access: SessionAccess,
    readonly inheritedEventCount: Offset,
    cursor: number,
    materialized: boolean,
    readonly token: string,
  ) {
    this.cursor = cursor
    this.materialized = materialized
  }

  /** Read a validated slice from the authoritative database. */
  async read(offset = 0, length = Number.MAX_SAFE_INTEGER, options?: SessionHandleReadOptions): Promise<SessionHandleReadResult> {
    this.assertOpen('read')
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError('read offset must be a non-negative safe integer')
    if (!Number.isSafeInteger(length) || length < 0) throw new TypeError('read length must be a non-negative safe integer')
    options?.signal?.throwIfAborted()
    const stored = this.owner.readStored(this.id)
    if (stored === undefined) {
      if (!this.owner.hasPending(this.id)) throw new SessionPersistenceNotFoundError(this.id)
      return { eventState: 'detached', events: [] }
    }
    const events = stored.events.slice(offset, offset + length)
    for (const event of events) freezeEvent(event)
    return { eventState: 'shared-frozen', events }
  }

  /** Append one contiguous batch in a durable transaction. */
  async append(events: readonly SessionEvent[], options?: SessionHandleAppendOptions): Promise<void> {
    this.assertOpen('append')
    const batch = materializeAppendBatch(events)
    await this.enqueue(async () => {
      options?.signal?.throwIfAborted()
      if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'append')
      this.cursor = this.owner.persistBatch(this.header, this.inheritedEventCount, this.cursor, batch, this.materialized)
      this.materialized = true
    })
  }

  /** Materialize an empty session and drain routed live events. */
  async flush(options?: SessionHandleFlushOptions): Promise<void> {
    this.assertOpen('flush')
    await this.enqueue(async () => {
      options?.signal?.throwIfAborted()
      if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'flush')
      if (this.buffered.length > 0) {
        const batch = materializeAppendBatch(this.buffered)
        this.cursor = this.owner.persistBatch(this.header, this.inheritedEventCount, this.cursor, batch, this.materialized)
        this.buffered = []
        this.materialized = true
      } else if (!this.materialized) {
        this.owner.persistHeader(this.header, this.inheritedEventCount)
        this.materialized = true
      }
    })
  }

  /** Close the handle and release its writer lease. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      let failure: unknown
      try {
        if (this.access === 'write') await this.enqueue(async () => {
          if (this.buffered.length === 0) return
          const batch = materializeAppendBatch(this.buffered)
          this.cursor = this.owner.persistBatch(this.header, this.inheritedEventCount, this.cursor, batch, this.materialized)
          this.buffered = []
          this.materialized = true
        })
      } catch (error: unknown) {
        failure = error
      }
      this.closed = true
      this.owner.releaseHandle(this)
      if (this.access === 'write') this.owner.releaseLease(this.id, this.token)
      if (failure !== undefined) {
        throw failure instanceof Error ? failure : new Error(typeof failure === 'string' ? failure : 'Closing the SQLite session handle failed.')
      }
    })()
    return this.closing
  }

  /** `await using` support. */
  [Symbol.asyncDispose](): Promise<void> { return this.close() }

  /** Queue handle mutations and live-event drains in call order. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation)
    this.chain = result.then(() => undefined, () => undefined)
    return result
  }

  /** Retain one routed Session event until the next flush. */
  enqueueLive(event: SessionEvent): void {
    this.buffered.push(structuredClone(event))
  }

  /** Refuse operations after close begins. */
  private assertOpen(operation: string): void {
    if (this.closed || this.closing !== undefined) throw new SessionHandleClosedError(this.id, operation)
  }
}

/** SQLite durable Session provider. */
class SqliteSessionPersistence extends SessionPersistence {
  static Config = Config
  override readonly name = 'session-persistence-sqlite'
  private readonly database: DatabaseSync
  private readonly path: string
  private readonly tokenPrefix = randomUUID()
  private readonly writers = new Map<SessionId, SqliteSessionHandle>()
  private readonly handles = new Set<SqliteSessionHandle>()
  private readonly pending = new Map<SessionId, PendingSession>()
  private tokenCounter = 0

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.path = config.path === ':memory:' ? config.path : resolve(config.path)
    if (this.path !== ':memory:') {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
      const fd = openSync(this.path, 'a', 0o600)
      closeSync(fd)
    }
    this.database = new DatabaseSync(this.path)
    try {
      this.configure()
    } catch (error: unknown) {
      this.database.close()
      throw error
    }
    this.install(ctx)
  }

  /** Create a process-local session and reserve its single-writer lease. */
  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const snapshot = materializeCreateHeader(header)
    assertVersion(snapshot)
    const inherited = SessionLogOffset(options?.inheritedEventCount ?? 0)
    if (snapshot.isSeeded && options?.inheritedEventCount === undefined) throw new Error('seeded session header requires an inherited event count')
    if (!snapshot.isSeeded && inherited !== 0) throw new Error('unseeded session header inherited event count must be 0')
    const existing = this.database.prepare('SELECT id FROM dsh_session_metadata WHERE id = ?').get(snapshot.id)
    if (existing !== undefined || this.pending.has(snapshot.id)) throw new SessionAlreadyExistsError(snapshot.id)
    const token = this.acquireLease(snapshot.id)
    const pending: PendingSession = { header: snapshot, inheritedEventCount: inherited, token }
    this.pending.set(snapshot.id, pending)
    return this.adopt(new SqliteSessionHandle(this, snapshot.id, snapshot, 'write', inherited, 0, false, token))
  }

  /** Open a stored session for reading or exclusive writing. */
  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const stored = this.readStored(id)
    if (stored === undefined) {
      const pending = this.pending.get(id)
      if (pending === undefined || access === 'write') {
        if (access === 'write' && pending !== undefined) throw new SessionAlreadyOwnedError(id)
        throw new SessionPersistenceNotFoundError(id)
      }
      return this.adopt(new SqliteSessionHandle(this, id, pending.header, 'read', pending.inheritedEventCount, 0, false, ''))
    }
    const token = access === 'write' ? this.acquireLease(id) : ''
    const current = access === 'write' ? this.readStored(id) : stored
    if (current === undefined) {
      if (access === 'write') this.releaseLease(id, token)
      throw new SessionPersistenceNotFoundError(id)
    }
    return this.adopt(new SqliteSessionHandle(
      this, id, current.header, access, current.inheritedEventCount, current.events.length, true, token,
    ))
  }

  /** Flush all currently owned writers. */
  async flush(): Promise<void> {
    const failures: unknown[] = []
    for (const writer of [...this.writers.values()]) {
      try { await writer.flush() } catch (error: unknown) {
        if (error instanceof SessionHandleClosedError) continue
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'SQLite session persistence flush failed')
  }

  /** Observe one stored header without reading event bodies. */
  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    options?.signal?.throwIfAborted()
    const row = this.metadata(id)
    if (row !== undefined) return this.snapshot(row)
    const pending = this.pending.get(id)
    return pending === undefined ? undefined : {
      header: pending.header,
      revision: SessionPersistenceRevision(`sqlite:${pending.token}`),
    }
  }

  /** List durable sessions and this process's unmaterialized creations. */
  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    options?.signal?.throwIfAborted()
    const rows = this.database.prepare('SELECT id, header_json, inherited_event_count, event_count, revision FROM dsh_session_metadata ORDER BY id').all().map(metadataRow)
    const snapshots = rows.map(row => this.snapshot(row))
    const ids = new Set(rows.map(row => row.id))
    for (const [id, pending] of this.pending) {
      if (!ids.has(id)) snapshots.push({ header: pending.header, revision: SessionPersistenceRevision(`sqlite:${pending.token}`) })
    }
    return snapshots
  }

  /**
   * Read and validate one complete stored Session.
   * @param id - Session identity to load.
   * @returns validated header, inherited event count, and ordered events, or `undefined` when absent.
   */
  readStored(id: SessionId): { header: SessionHeader; inheritedEventCount: Offset; events: SessionEvent[] } | undefined {
    const row = this.metadata(id)
    if (row === undefined) return undefined
    let value: unknown
    try { value = JSON.parse(row.header_json) } catch (error: unknown) {
      throw new SessionPersistenceCorruptionError(`stored session "${id}" contains invalid header JSON`, { cause: error })
    }
    const header = materializeCreateHeader(value as SessionHeader)
    assertStoredId(id, header)
    assertVersion(header, { kind: 'sqlite', path: this.path })
    const rows = this.database.prepare('SELECT seq, event_json FROM dsh_session_events WHERE session_id = ? ORDER BY seq').all(id).map(eventRow)
    if (rows.length !== row.event_count) throw new SessionPersistenceCorruptionError(`stored session "${id}" event count mismatch`, { cause: new Error('event count mismatch') })
    const events: SessionEvent[] = rows.map((eventRow, index) => {
      if (eventRow.seq !== index) throw new SessionPersistenceCorruptionError(`stored session "${id}" has non-contiguous event rows`, { cause: new Error('non-contiguous event rows') })
      try { return JSON.parse(eventRow.event_json) as SessionEvent } catch (error: unknown) {
        throw new SessionPersistenceCorruptionError(`stored session "${id}" contains invalid event JSON`, { cause: error })
      }
    })
    assertContiguous(id, events, 0)
    validateStoredEvents(header, events, { kind: 'sqlite', path: this.path })
    return { header, inheritedEventCount: SessionLogOffset(row.inherited_event_count), events }
  }

  /**
   * Materialize header and append rows in one transaction.
   * @param header - immutable Session header.
   * @param inherited - inherited event prefix length.
   * @param cursor - next expected event sequence number.
   * @param events - contiguous events to append.
   * @param materialized - whether the metadata row already exists.
   * @returns the next sequence number after the appended events.
   */
  persistBatch(header: SessionHeader, inherited: Offset, cursor: number, events: readonly SessionEvent[], materialized: boolean): number {
    assertContiguous(header.id, events, cursor)
    this.transaction(() => {
      if (!materialized) this.insertHeader(header, inherited)
      const stored = this.metadata(header.id)
      if (stored === undefined) throw new SessionPersistenceNotFoundError(header.id)
      if (stored.event_count !== cursor) throw new Error(`session "${header.id}": expected seq ${stored.event_count}, received ${cursor}`)
      const insert = this.database.prepare('INSERT INTO dsh_session_events(session_id, seq, event_json) VALUES (?, ?, ?)')
      for (const event of events) insert.run(header.id, event.seq, JSON.stringify(event))
      this.database.prepare('UPDATE dsh_session_metadata SET event_count = ?, revision = revision + 1, updated_at = ? WHERE id = ?')
        .run(cursor + events.length, String(Date.now()), header.id)
    })
    this.pending.delete(header.id)
    return cursor + events.length
  }

  /**
   * Materialize an empty created Session.
   * @param header - immutable Session header.
   * @param inherited - inherited event prefix length.
   */
  persistHeader(header: SessionHeader, inherited: Offset): void {
    this.transaction(() =>{  this.insertHeader(header, inherited) })
    this.pending.delete(header.id)
  }

  /**
   * Release one handle and its database writer lease.
   * @param handle - handle whose local ownership is ending.
   */
  releaseHandle(handle: SqliteSessionHandle): void {
    this.handles.delete(handle)
    if (handle.access === 'write' && this.writers.get(handle.id) === handle) this.writers.delete(handle.id)
    if (handle.access === 'write' && !this.database.prepare('SELECT id FROM dsh_session_metadata WHERE id = ?').get(handle.id)) this.pending.delete(handle.id)
  }

  /**
   * Remove this writer's lease after its handle closes.
   * @param id - leased Session identity.
   * @param token - owner token that must match the lease row.
   */
  releaseLease(id: SessionId, token: string): void {
    this.database.prepare('DELETE FROM dsh_session_writer_leases WHERE session_id = ? AND owner_token = ?').run(id, token)
  }

  /**
   * Whether a Session remains process-local and unmaterialized.
   * @param id - Session identity to check.
   * @returns whether this provider has a pending create intent for the Session.
   */
  hasPending(id: SessionId): boolean { return this.pending.has(id) }

  private metadata(id: SessionId): MetadataRow | undefined {
    return this.database.prepare('SELECT id, header_json, inherited_event_count, event_count, revision FROM dsh_session_metadata WHERE id = ?').get(id) as MetadataRow | undefined
  }

  private snapshot(row: MetadataRow): SessionPersistenceSnapshot {
    const stored = this.readStoredHeader(row)
    return { header: stored, revision: SessionPersistenceRevision(`sqlite:${String(row.revision)}`), eventCount: row.event_count }
  }

  private readStoredHeader(row: MetadataRow): SessionHeader {
    let value: unknown
    try { value = JSON.parse(row.header_json) } catch (error: unknown) {
      throw new SessionPersistenceCorruptionError(`stored session "${row.id}" contains invalid header JSON`, { cause: error })
    }
    const header = materializeCreateHeader(value as SessionHeader)
    assertStoredId(row.id as SessionId, header)
    assertVersion(header, { kind: 'sqlite', path: this.path })
    return header
  }

  private insertHeader(header: SessionHeader, inherited: Offset): void {
    this.database.prepare(`INSERT INTO dsh_session_metadata(id, header_json, updated_at, inherited_event_count, event_count, revision)
      VALUES (?, ?, ?, ?, 0, 1)`).run(header.id, JSON.stringify(header), String(Date.now()), inherited)
  }

  private acquireLease(id: SessionId): string {
    const token = `${this.tokenPrefix}:${++this.tokenCounter}`
    this.transaction(() => {
      this.reapLease(id)
      const current = this.database.prepare('SELECT owner_pid FROM dsh_session_writer_leases WHERE session_id = ?').get(id) as { owner_pid: number } | undefined
      if (current !== undefined) throw new SessionAlreadyOwnedError(id)
      this.database.prepare('INSERT INTO dsh_session_writer_leases(session_id, owner_pid, owner_token) VALUES (?, ?, ?)').run(id, process.pid, token)
    })
    return token
  }

  private reapLease(id: SessionId): void {
    const current = this.database.prepare('SELECT owner_pid, owner_token FROM dsh_session_writer_leases WHERE session_id = ?').get(id) as { owner_pid: number; owner_token: string } | undefined
    if (current !== undefined && !isProcessAlive(current.owner_pid)) {
      this.database.prepare('DELETE FROM dsh_session_writer_leases WHERE session_id = ? AND owner_token = ?').run(id, current.owner_token)
    }
  }

  private transaction(operation: () => void): void {
    this.database.exec('BEGIN IMMEDIATE')
    try { operation(); this.database.exec('COMMIT') }
    catch (error: unknown) { this.database.exec('ROLLBACK'); throw error }
  }

  private adopt(handle: SqliteSessionHandle): SqliteSessionHandle {
    this.handles.add(handle)
    if (handle.access === 'write') this.writers.set(handle.id, handle)
    return handle
  }

  private install(ctx: Context): void {
    ctx.on('session/event', (session, event) => this.writers.get(session.id)?.enqueueLive(event))
    ctx.on('session/flush', session => this.writers.get(session.id)?.flush())
    ctx.on('session/disposed', (session) => {
      this.writers.get(session.id)?.close().catch((error: unknown) => {
        ctx.logger.warn(`session-persistence-sqlite: final flush for "${session.id}" failed: ${String(error)}`)
      })
    })
    ctx.effect(() => async () => {
      const failures: unknown[] = []
      for (const handle of [...this.handles]) {
        try { await handle.close() } catch (error: unknown) { failures.push(error) }
      }
      this.database.close()
      if (failures.length > 0) throw new AggregateError(failures, 'SQLite persistence disposal failed')
    }, 'SQLite Session persistence')
  }

  private configure(): void {
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;')
    const { user_version: version } = this.database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (!Number.isSafeInteger(version) || version < 0 || version > SCHEMA_VERSION) {
      throw new Error(`unsupported SQLite schema version ${String(version)}`)
    }
    const existing = this.database.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view', 'trigger', 'index') AND name NOT LIKE 'sqlite_%'").all()
    if (version === 0 && existing.length > 0) throw new Error('unversioned SQLite database is not empty')
    if (version === SCHEMA_VERSION) {
      const tables = existing.map(row => (row as { name: string }).name).sort()
      if (tables.join(',') !== 'dsh_session_events,dsh_session_metadata,dsh_session_writer_leases') {
        throw new Error('SQLite schema version 1 has an unexpected table set')
      }
      const expected = new Map([
        ['dsh_session_metadata', 'event_count,header_json,id,inherited_event_count,revision,updated_at'],
        ['dsh_session_events', 'event_json,seq,session_id'],
        ['dsh_session_writer_leases', 'owner_pid,owner_token,session_id'],
      ])
      for (const [table, columns] of expected) {
        const actual = (this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
          .map(column => column.name).sort().join(',')
        if (actual !== columns) throw new Error(`SQLite schema version 1 has unexpected columns in ${table}`)
      }
      return
    }
    this.transaction(() => {
      this.database.exec(`CREATE TABLE IF NOT EXISTS dsh_session_metadata (
        id TEXT PRIMARY KEY, header_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        inherited_event_count INTEGER NOT NULL, event_count INTEGER NOT NULL, revision INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_session_events (
        session_id TEXT NOT NULL REFERENCES dsh_session_metadata(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(session_id, seq)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_session_writer_leases (
        session_id TEXT PRIMARY KEY, owner_pid INTEGER NOT NULL, owner_token TEXT NOT NULL
      ) STRICT;`)
      this.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    })
  }
}

export default SqliteSessionPersistence
