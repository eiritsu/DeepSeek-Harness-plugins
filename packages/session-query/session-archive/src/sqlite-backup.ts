/** Convert an explicitly selected frozen Desktop SQLite backup to archive v1. */

import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { zipSync } from 'fflate'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import { createSessionFormatCatalogWithChildren, historicalSessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import type { SessionFormatArtifact, SessionFormatHeader, SessionFormatJsonValue } from '@deepseek-ai/dsh-session-format'
import { historicalChildCatalogSource } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { SESSION_ARCHIVE_FORMAT, SESSION_ARCHIVE_VERSION, DEFAULT_MAX_ARCHIVE_BYTES, DEFAULT_MAX_EXPANDED_BYTES, DEFAULT_MAX_SESSION_LOG_BYTES, DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES } from './archive.ts'
import { assertSessionCanContinue, serializeSessionLog, sessionLogAttachmentRefs, sessionLogFileEntryPath, sessionLogImageEntryPath, SESSION_LOG_FILENAME } from './session-log.ts'

const SQLITE_SCHEMA_VERSION = 2
const SOURCE_SESSION_FORMAT_VERSION = 3
const DEFAULT_MAX_SESSION_COUNT = 10_000
const DEFAULT_MAX_EVENT_COUNT = 1_000_000
const DEFAULT_MAX_INPUT_JSON_BYTES = 256 * 1024 * 1024

/** Resource limits for an offline conversion; source counts and JSON bytes are checked before row materialization. */
export interface SqliteBackupArchiveLimits {
  /** Maximum source database file size, in bytes. */
  readonly maxSourceBytes?: number
  /** Maximum total expanded logs and attachment bytes, in bytes. */
  readonly maxExpandedBytes?: number
  /** Maximum compressed archive size, in bytes. */
  readonly maxArchiveBytes?: number
  /** Maximum one converted Session log, in bytes. */
  readonly maxSessionLogBytes?: number
  /** Maximum one image object, in bytes. */
  readonly maxImageAttachmentBytes?: number
  /** Maximum number of Sessions retained during conversion. */
  readonly maxSessionCount?: number
  /** Maximum number of event rows retained during conversion. */
  readonly maxEventCount?: number
  /** Maximum combined UTF-8 bytes of source header and event JSON text. */
  readonly maxInputJsonBytes?: number
}

interface SourceSession {
  readonly id: string
  readonly header: SessionFormatHeader
  readonly inheritedEventCount: number
  readonly eventCount: number
  readonly rows: readonly { readonly seq: number; readonly value: unknown }[]
}

interface ManifestSession {
  readonly id: string
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

/** Convert one selected frozen Desktop schema-2, Session-v3 SQLite backup to archive v1.
 * @param backupPath - Explicit path to a closed SQLite backup file; WAL sidecars are refused.
 * @param attachmentRoot - Explicit root containing `objects/` and `file-objects/` content-addressed directories.
 * @param limits - Optional byte and row-count bounds; defaults match the Session archive transfer limits and
 * documented converter caps.
 * @param signal - Optional cancellation checked between database and attachment operations.
 * @returns Complete archive v1 ZIP bytes, or throws without changing the source or any destination provider.
 * Session and event counts are checked before rows are retained; event rows are iterated rather than loaded
 * with one unbounded query result.
 */
export async function convertDesktopSqliteBackupToArchive(
  backupPath: string,
  attachmentRoot: string,
  limits: SqliteBackupArchiveLimits = {},
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const maxSourceBytes = limits.maxSourceBytes ?? DEFAULT_MAX_EXPANDED_BYTES
  const maxExpandedBytes = limits.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES
  const maxArchiveBytes = limits.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES
  const maxSessionLogBytes = limits.maxSessionLogBytes ?? DEFAULT_MAX_SESSION_LOG_BYTES
  const maxImageAttachmentBytes = limits.maxImageAttachmentBytes ?? DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES
  const maxSessionCount = limits.maxSessionCount ?? DEFAULT_MAX_SESSION_COUNT
  const maxEventCount = limits.maxEventCount ?? DEFAULT_MAX_EVENT_COUNT
  const maxInputJsonBytes = limits.maxInputJsonBytes ?? DEFAULT_MAX_INPUT_JSON_BYTES
  const declaredLimits = {
    maxSourceBytes,
    maxExpandedBytes,
    maxArchiveBytes,
    maxSessionLogBytes,
    maxImageAttachmentBytes,
    maxSessionCount,
    maxEventCount,
    maxInputJsonBytes,
  }
  for (const [name, value] of Object.entries(declaredLimits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
  }
  signal?.throwIfAborted()
  const selectedSourcePath = resolve(backupPath)
  const selectedAttachmentPath = resolve(attachmentRoot)
  const sourceStat = await lstat(selectedSourcePath)
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('SQLite backup must be a regular file, not a symbolic link')
  if (sourceStat.size > maxSourceBytes) throw new Error('SQLite backup exceeds the source-size limit')
  const sourcePath = await realpath(selectedSourcePath)
  const attachmentPath = await realpath(selectedAttachmentPath)
  for (const suffix of ['-wal', '-shm']) {
    try {
      await lstat(`${sourcePath}${suffix}`)
      throw new Error(`offline SQLite backup has a ${suffix.slice(1).toUpperCase()} sidecar; create a closed backup first`)
    } catch (error: unknown) {
      if (!isNotFound(error)) throw error
    }
  }
  const sourceDigest = await hashFile(sourcePath)
  const privateRoot = await mkdtemp(join(tmpdir(), 'dsh-sqlite-archive-'))
  const copyPath = join(privateRoot, `${randomUUID()}.sqlite`)
  let database: DatabaseSync | undefined
  try {
    await copyFile(sourcePath, copyPath)
    signal?.throwIfAborted()
    database = new DatabaseSync(copyPath, { readOnly: true })
    const sessions = readSourceSessions(database, { maxSessionCount, maxEventCount, maxInputJsonBytes })
    if (sessions.length === 0) throw new Error('SQLite backup contains no Sessions')
    const archive = await buildArchive(sessions, attachmentPath, {
      maxExpandedBytes, maxSessionLogBytes, maxImageAttachmentBytes,
    }, signal)
    database.close()
    database = undefined
    if (await hashFile(sourcePath) !== sourceDigest) throw new Error('SQLite backup changed during conversion')
    signal?.throwIfAborted()
    const result = zipSync(archive.entries, { level: 0 })
    if (result.byteLength > maxArchiveBytes) throw new Error('converted archive exceeds the compressed-byte limit')
    return result
  } finally {
    database?.close()
    await rm(privateRoot, { recursive: true, force: true })
  }
}

function readSourceSessions(database: DatabaseSync, limits: Pick<SqliteBackupArchiveLimits, 'maxSessionCount' | 'maxEventCount' | 'maxInputJsonBytes'>): SourceSession[] {
  const maxInputJsonBytes = limits.maxInputJsonBytes ?? DEFAULT_MAX_INPUT_JSON_BYTES
  const version = (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (version !== SQLITE_SCHEMA_VERSION) throw new Error(`unsupported Desktop SQLite schema version ${version}; expected ${SQLITE_SCHEMA_VERSION}`)
  const check = database.prepare('PRAGMA quick_check').get() as { quick_check: string }
  if (check.quick_check !== 'ok') throw new Error(`SQLite integrity check failed: ${check.quick_check}`)
  const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(row => row.name))
  for (const table of ['dsh_session_metadata', 'dsh_session_events', 'dsh_session_store_metadata']) {
    if (!tables.has(table)) throw new Error(`SQLite backup is missing table ${table}`)
  }
  const metadataCount = (database.prepare('SELECT COUNT(*) AS count FROM dsh_session_metadata').get() as { count: number }).count
  if (metadataCount > (limits.maxSessionCount ?? DEFAULT_MAX_SESSION_COUNT)) throw new Error('SQLite backup exceeds the Session-count limit')
  const eventCount = (database.prepare('SELECT COUNT(*) AS count FROM dsh_session_events').get() as { count: number }).count
  if (eventCount > (limits.maxEventCount ?? DEFAULT_MAX_EVENT_COUNT)) throw new Error('SQLite backup exceeds the event-count limit')
  const inputJsonBytes = (database.prepare(`
    SELECT
      (SELECT COALESCE(SUM(length(CAST(header_json AS BLOB))), 0) FROM dsh_session_metadata)
      + (SELECT COALESCE(SUM(length(CAST(event_json AS BLOB))), 0) FROM dsh_session_events) AS bytes
  `).get() as { bytes: number }).bytes
  if (!Number.isSafeInteger(inputJsonBytes) || inputJsonBytes < 0 || inputJsonBytes > maxInputJsonBytes) {
    throw new Error('SQLite backup exceeds the input-JSON byte limit')
  }
  const metadataRows = database
    .prepare('SELECT id, header_json, inherited_event_count, event_count FROM dsh_session_metadata ORDER BY id')
    .all() as Array<{
    id: string
    header_json: string
    inherited_event_count: number
    event_count: number
  }>
  const grouped = new Map<string, Array<{ seq: number; value: unknown }>>()
  const eventRows = database.prepare('SELECT session_id, seq, event_json FROM dsh_session_events ORDER BY session_id, seq')
  for (const row of eventRows.iterate() as Iterable<{ session_id: string; seq: number; event_json: string }>) {
    const rows = grouped.get(row.session_id) ?? []
    rows.push({ seq: row.seq, value: parseJson(row.event_json, `Session ${row.session_id} event row ${row.seq}`) })
    grouped.set(row.session_id, rows)
  }
  const sessions = metadataRows.map((row) => {
    if (typeof row.id !== 'string' || !Number.isSafeInteger(row.inherited_event_count) || row.inherited_event_count < 0
      || !Number.isSafeInteger(row.event_count) || row.event_count < 0) throw new Error('SQLite backup contains invalid Session metadata')
    const rawHeader = parseJson(row.header_json, `Session ${row.id} header`)
    if (!isRecord(rawHeader) || rawHeader.version !== SOURCE_SESSION_FORMAT_VERSION || rawHeader.id !== row.id) {
      throw new Error(`Session ${row.id} is not a supported version-3 header or its id does not match the database key`)
    }
    const physical = { type: 'session', ...rawHeader }
    const header = historicalSessionFormatCatalog.createRestore(physical, { recovery: 'strict', validation: 'current' }).header
    const rows = grouped.get(row.id) ?? []
    if (rows.length !== row.event_count) throw new Error(`Session ${row.id} event count does not match its metadata`)
    for (let index = 0; index < rows.length; index++) {
      const item = rows[index]
      if (item === undefined || item.seq !== index || !isRecord(item.value) || item.value.seq !== index) {
        throw new Error(`Session ${row.id} event rows are not dense and sequence-matched`)
      }
    }
    return { id: row.id, header, inheritedEventCount: row.inherited_event_count, eventCount: row.event_count, rows }
  })
  const sessionIds = new Set(metadataRows.map(row => row.id))
  for (const id of grouped.keys()) if (!sessionIds.has(id)) throw new Error(`SQLite backup contains events for missing Session ${id}`)
  return sessions
}

async function buildArchive(
  sessions: readonly SourceSession[], attachmentRoot: string,
  limits: Required<Pick<SqliteBackupArchiveLimits, 'maxExpandedBytes' | 'maxSessionLogBytes' | 'maxImageAttachmentBytes'>>,
  signal?: AbortSignal,
): Promise<{ readonly entries: Record<string, Uint8Array> }> {
  const byId = new Map(sessions.map(session => [session.id, session]))
  const historical = new Map<string, SessionFormatArtifact>()
  const childFacts = new Map<string, SessionFormatJsonValue[]>()
  for (const session of sessions) {
    signal?.throwIfAborted()
    const restore = historicalSessionFormatCatalog.createRestore({ type: 'session', ...session.header }, { recovery: 'strict', validation: 'current' })
    for (const row of session.rows) restore.decodeRow(row.value)
    const artifact = restore.finish()
    if (artifact.inheritedEventCount !== session.inheritedEventCount) throw new Error(`Session ${session.id} inherited event count does not match the frozen database metadata`)
    assertSessionCanContinue(session.id, artifact.events)
    historical.set(session.id, artifact)
    if (artifact.header.origin === 'subagent' && artifact.header.parentSession !== undefined) {
      if (!byId.has(artifact.header.parentSession)) throw new Error(`Session ${session.id} has a missing direct parent ${artifact.header.parentSession}`)
      const facts = childFacts.get(artifact.header.parentSession) ?? []
      facts.push(historicalChildCatalogSource(artifact))
      childFacts.set(artifact.header.parentSession, facts)
    }
  }
  const files: Record<string, Uint8Array> = {}
  const manifestSessions: ManifestSession[] = []
  let expandedBytes = 0
  const add = (path: string, data: Uint8Array): void => {
    const prior = files[path]
    if (prior !== undefined) {
      if (Buffer.compare(prior, data) !== 0) throw new Error(`conflicting archive entry ${path}`)
      return
    }
    expandedBytes += data.byteLength
    if (expandedBytes > limits.maxExpandedBytes) throw new Error('converted archive exceeds the expanded-byte limit')
    files[path] = data
  }
  for (const [index, session] of sessions.entries()) {
    signal?.throwIfAborted()
    const source = historical.get(session.id)
    if (source === undefined) throw new Error(`missing historical Session ${session.id}`)
    const restore = createSessionFormatCatalogWithChildren(childFacts.get(session.id) ?? []).createRestore(
      { type: 'session', ...source.header }, { recovery: 'strict', validation: 'current' },
    )
    for (const row of session.rows) restore.decodeRow(row.value)
    const artifact = restore.finish()
    assertSessionCanContinue(session.id, artifact.events)
    const header = toSessionHeader(artifact.header)
    const events = artifact.events as readonly SessionEvent[]
    const log = Buffer.from(serializeSessionLog(header, events))
    if (log.byteLength > limits.maxSessionLogBytes) throw new Error(`Session ${session.id} exceeds the converted log-size limit`)
    const path = `sessions/${String(index).padStart(8, '0')}/${SESSION_LOG_FILENAME}`
    add(path, log)
    manifestSessions.push({ id: session.id, path, bytes: log.byteLength, sha256: `sha256:${digest(log)}` })
    const refs = sessionLogAttachmentRefs(log.toString('utf8'))
    for (const ref of refs.images.values()) {
      const entryPath = sessionLogImageEntryPath(ref)
      const data = await readObject(attachmentRoot, 'objects', String(ref.attachmentId), ref.bytes, limits.maxImageAttachmentBytes)
      checkDigest(data, String(ref.attachmentId), entryPath)
      add(entryPath, data)
    }
    for (const ref of refs.files.values()) {
      const entryPath = sessionLogFileEntryPath(ref)
      const data = await readObject(attachmentRoot, 'file-objects', String(ref.attachmentId), ref.bytes, limits.maxExpandedBytes)
      checkDigest(data, String(ref.attachmentId), entryPath)
      add(entryPath, data)
    }
  }
  const manifest = {
    format: SESSION_ARCHIVE_FORMAT, archiveVersion: SESSION_ARCHIVE_VERSION,
    sessionFormatVersion: SESSION_FORMAT_VERSION, sessions: manifestSessions,
  }
  add('manifest.json', Buffer.from(`${JSON.stringify(manifest)}\n`))
  return { entries: files }
}

async function readObject(root: string, directory: 'objects' | 'file-objects', id: string, bytes: number, maxBytes: number): Promise<Uint8Array> {
  const hex = digestHex(id)
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes) throw new Error(`attachment ${id} exceeds its byte limit`)
  const path = join(root, directory, hex.slice(0, 2), hex)
  let info: Awaited<ReturnType<typeof lstat>>
  try { info = await lstat(path) } catch (error: unknown) {
    if (isNotFound(error)) throw new Error(`attachment object ${id} is missing`)
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink() || info.size !== bytes) throw new Error(`attachment object ${id} is missing or has the wrong size`)
  if (await realpath(path) !== path) throw new Error(`attachment object ${id} is not stored at its canonical path`)
  const data = await readFile(path)
  if (data.byteLength !== bytes) throw new Error(`attachment object ${id} changed while reading`)
  return data
}

function toSessionHeader(header: SessionFormatHeader): SessionHeader {
  if (header.version !== SESSION_FORMAT_VERSION) throw new Error(`migration did not produce Session format ${SESSION_FORMAT_VERSION}`)
  return {
    version: SESSION_FORMAT_VERSION,
    id: brandString<SessionId>(header.id),
    createdAt: header.createdAt,
    ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
    ...(header.parentSession === undefined ? {} : { parentSession: brandString<SessionId>(header.parentSession) }),
    isSeeded: header.isSeeded,
    ...(header.origin === undefined ? {} : { origin: header.origin }),
    delegationDepth: header.delegationDepth,
    ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
  }
}

function parseJson(value: string, subject: string): unknown {
  try { return JSON.parse(value) } catch { throw new Error(`${subject} is not valid JSON`) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function digest(data: Uint8Array): string { return createHash('sha256').update(data).digest('hex') }
function digestHex(id: string): string {
  const match = /^sha256:([0-9a-f]{64})$/u.exec(id)
  if (match?.[1] === undefined) throw new Error(`unsupported attachment id ${id}`)
  return match[1]
}
function checkDigest(data: Uint8Array, id: string, path: string): void {
  if (`sha256:${digest(data)}` !== id) throw new Error(`attachment ${id} failed digest verification at ${path}`)
}
async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk)
  return hash.digest('hex')
}
function isNotFound(error: unknown): boolean { return isRecord(error) && error.code === 'ENOENT' }
