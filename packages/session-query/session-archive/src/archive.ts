/** Provider-neutral, versioned archive transfer for durable Sessions. */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import type { Stats } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AttachmentStore, FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Context } from '@deepseek-ai/cordis'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import yauzl from 'yauzl'
import type { Entry as ZipEntry, ZipFile } from 'yauzl'
import { KNOWN_SESSION_EVENT_TYPES, SESSION_FORMAT_VERSION, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import type { SessionFormatArtifact, SessionFormatEvent, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { assertSessionCanContinue, readSessionLogText, serializeSessionLog, sessionLogAttachmentRefs, sessionLogFileEntryPath, sessionLogImageEntryPath, SESSION_LOG_FILENAME } from './session-log.ts'
import type { SessionArchiveZipEntry } from './session-log.ts'
import { streamSessionArchiveEntries } from './zip.ts'
import type { SessionArchiveCompressionLevel } from './zip.ts'

/** Complete archive format id. */
export const SESSION_ARCHIVE_FORMAT = 'dsh-session-archive'
/** Current archive envelope version. */
export const SESSION_ARCHIVE_VERSION = 1
/** Default compressed request limit. */
export const DEFAULT_MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
/** Default total expanded-entry limit. */
export const DEFAULT_MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
/** Default maximum one Session's JSONL size. */
export const DEFAULT_MAX_SESSION_LOG_BYTES = 128 * 1024 * 1024
/** Default maximum one normalized image object. */
export const DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES = 16 * 1024 * 1024
/** Maximum entries accepted in one archive. */
const MAX_ARCHIVE_ENTRIES = 65_534

/** Operations required from the mounted Host services. */
export interface SessionArchiveDeps {
  readonly sessionPersistence: SessionPersistence | undefined
  readonly attachments: AttachmentStore | undefined
  readonly sessions: {
    get(id: SessionId): { readonly id: SessionId } | undefined
    flush(session: { readonly id: SessionId }): Promise<boolean>
  } | undefined
  readonly workspaceRegistry: Pick<WorkspaceRegistry, 'resolveByPath'> | undefined
  readonly journalRoot: string | undefined
}

/** Mounted services after fail-loud dependency resolution. */
export interface SessionArchiveReady {
  readonly sessionPersistence: SessionPersistence
  readonly attachments: AttachmentStore
  readonly sessions: SessionArchiveDeps['sessions']
  readonly workspaceRegistry: SessionArchiveDeps['workspaceRegistry']
  readonly journalRoot: string | undefined
}

/** One entry in the versioned provider-neutral manifest. */
interface SessionArchiveManifestEntry {
  readonly id: string
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

interface SessionArchiveManifest {
  readonly format: typeof SESSION_ARCHIVE_FORMAT
  readonly archiveVersion: typeof SESSION_ARCHIVE_VERSION
  readonly sessionFormatVersion: number
  readonly sessions: readonly SessionArchiveManifestEntry[]
}

interface StagedEntry {
  readonly path: string
  readonly file: string
  readonly bytes: number
}

interface StagedArchive {
  readonly root: string
  readonly entries: ReadonlyMap<string, StagedEntry>
  cleanup(): Promise<void>
}

interface ImportedSession {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly path: string
  readonly inheritedEventCount: number
}

interface RestorePlan {
  readonly sessions: readonly ImportedSession[]
  readonly images: ReadonlyMap<string, ImageAttachmentRef>
  readonly files: ReadonlyMap<string, FileAttachmentRef>
  readonly imageEntries: ReadonlyMap<string, StagedEntry>
  readonly fileEntries: ReadonlyMap<string, StagedEntry>
}

interface RestoreJournal {
  readonly format: typeof SESSION_ARCHIVE_FORMAT
  readonly fingerprint: string
  updatedAt: string
  attachments: Record<string, 'stored' | 'failed'>
  sessions: Record<string, 'in-progress' | 'imported' | 'failed'>
  workspaces: Record<string, 'attached' | 'failed'>
}

/** One attachment or Session outcome in an import report. */
export interface SessionArchiveImportOutcome {
  readonly id: string
  readonly kind: 'image' | 'file' | 'attachment' | 'session' | 'workspace'
  readonly status: 'stored' | 'imported' | 'already-imported' | 'attached' | 'failed' | 'not-started'
  readonly detail: string
}

/** Per-item result; the operation does not claim a cross-Session transaction. */
export interface SessionArchiveRestoreResult {
  readonly importedSessionIds: readonly SessionId[]
  readonly importedSessions: number
  readonly outcomes: readonly SessionArchiveImportOutcome[]
  readonly partial: boolean
  readonly journalPath: string
}

/** Resolve the optional persistence, attachment, and live Session services from a Host context.
 * @param ctx - Host context that may provide Session persistence and attachments.
 * @returns The available archive providers; missing required providers remain undefined for the caller to reject.
 */
export function sessionArchiveDeps(ctx: Context): SessionArchiveDeps {
  const profile = ctx.get('profileContext') as { readonly home?: string } | undefined
  return {
    sessionPersistence: ctx.get('sessionPersistence'),
    attachments: ctx.get('attachments'),
    sessions: ctx.get('sessions'),
    workspaceRegistry: ctx.get('workspaceRegistry'),
    journalRoot: profile?.home === undefined ? undefined : join(profile.home, 'session-archive', 'imports'),
  }
}

/** Yield Session logs and each referenced image or file as versioned archive entries.
 * @param deps - Persistence and attachment providers used to read the archive contents.
 * @param limits - Maximum byte counts for each Session log and image attachment.
 * @param signal - Optional cancellation signal checked while reading Sessions and attachments.
 * @returns An async sequence of Session, attachment, and manifest ZIP entries.
 */
export async function* sessionArchiveEntries(
  deps: SessionArchiveReady,
  limits: { readonly maxSessionLogBytes?: number; readonly maxImageAttachmentBytes?: number } = {},
  signal?: AbortSignal,
): AsyncGenerator<SessionArchiveZipEntry> {
  signal?.throwIfAborted()
  const snapshots = await deps.sessionPersistence.list({ ...(signal === undefined ? {} : { signal }) })
  const maxSessionLogBytes = limits.maxSessionLogBytes ?? DEFAULT_MAX_SESSION_LOG_BYTES
  const maxImageAttachmentBytes = limits.maxImageAttachmentBytes ?? DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES
  const manifestSessions: SessionArchiveManifestEntry[] = []
  const seenAttachments = new Set<string>()
  for (const [index, snapshot] of snapshots.entries()) {
    signal?.throwIfAborted()
    const id = snapshot.header.id
    const live = deps.sessions?.get(id)
    if (live !== undefined) await deps.sessions?.flush(live)
    const content = await readSessionLogText(deps.sessionPersistence, id, signal)
    if (content === undefined) throw new Error(`session "${id}" disappeared during archive export`)
    const logBytes = Buffer.from(content)
    if (logBytes.byteLength > maxSessionLogBytes) throw new Error(`session "${id}" exceeds the archive log-size limit`)
    const entryPath = sessionArchivePath(index)
    manifestSessions.push({
      id: String(id),
      path: entryPath,
      bytes: logBytes.byteLength,
      sha256: `sha256:${createHash('sha256').update(logBytes).digest('hex')}`,
    })
    yield { path: entryPath, content }
    const refs = sessionLogAttachmentRefs(content)
    for (const ref of refs.images.values()) {
      signal?.throwIfAborted()
      const path = sessionLogImageEntryPath(ref)
      if (seenAttachments.has(path)) continue
      if (ref.bytes > maxImageAttachmentBytes) throw new Error(`image attachment "${String(ref.attachmentId)}" exceeds the archive image-size limit`)
      const stored = await deps.attachments.readImage(ref, signal)
      if (stored.data.byteLength > maxImageAttachmentBytes) throw new Error(`image attachment "${String(ref.attachmentId)}" exceeds the archive image-size limit`)
      const imageDigest = createHash('sha256').update(stored.data).digest('hex')
      if (stored.data.byteLength !== ref.bytes || `sha256:${imageDigest}` !== String(ref.attachmentId)) {
        throw new Error(`image attachment "${String(ref.attachmentId)}" failed export verification`)
      }
      seenAttachments.add(path)
      yield { path, data: stored.data }
    }
    for (const ref of refs.files.values()) {
      signal?.throwIfAborted()
      const path = sessionLogFileEntryPath(ref)
      if (seenAttachments.has(path)) continue
      seenAttachments.add(path)
      yield { path, chunks: verifiedFileChunks(ref, deps.attachments.readFileStream(ref, signal)) }
    }
  }
  const manifest: SessionArchiveManifest = {
    format: SESSION_ARCHIVE_FORMAT,
    archiveVersion: SESSION_ARCHIVE_VERSION,
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    sessions: manifestSessions,
  }
  yield { path: 'manifest.json', content: `${JSON.stringify(manifest)}\n` }
}

/** Compress a complete Session archive into a browser-readable stream.
 * @param deps - Persistence and attachment providers used to read the archive contents.
 * @param compressionLevel - ZIP compression level applied to each entry.
 * @param signal - Cancellation signal for archive reads and stream production.
 * @param limits - Maximum Session log, image attachment, and compressed archive byte counts.
 * @returns A stream of ZIP bytes without buffering the complete archive.
 */
export function streamSessionArchive(
  deps: SessionArchiveReady,
  compressionLevel: SessionArchiveCompressionLevel,
  signal: AbortSignal,
  limits: { readonly maxSessionLogBytes?: number; readonly maxImageAttachmentBytes?: number; readonly maxArchiveBytes?: number } = {},
): ReadableStream<Uint8Array> {
  const stream = streamSessionArchiveEntries(sessionArchiveEntries(deps, limits, signal), compressionLevel, signal)
  const maxArchiveBytes = limits.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES
  const reader = stream.getReader()
  let bytes = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) { controller.close(); return }
        bytes += result.value.byteLength
        if (bytes > maxArchiveBytes) {
          await reader.cancel(new Error('archive exceeds the compressed-byte limit'))
          controller.error(new Error('archive exceeds the compressed-byte limit'))
          return
        }
        controller.enqueue(result.value)
      } catch (error: unknown) {
        controller.error(error)
      }
    },
    async cancel(reason) { await reader.cancel(reason) },
  }, { highWaterMark: 1 })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertArchivePath(path: string): void {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0')
    || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error('archive contains an invalid entry path')
  }
}

async function stageZip(
  body: ReadableStream<Uint8Array> | null,
  compressedLimit: number,
  expandedLimit: number,
  signal: AbortSignal,
): Promise<StagedArchive> {
  if (body === null) throw new Error('archive request body is empty')
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-archive-'))
  const archivePath = join(root, 'archive.zip')
  const entries = new Map<string, StagedEntry>()
  let zipFile: ZipFile | undefined
  let expandedBytes = 0
  try {
    let compressedBytes = 0
    const compressedMeter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        compressedBytes += chunk.byteLength
        if (compressedBytes > compressedLimit) { callback(new Error('archive exceeds the compressed-byte limit')); return }
        callback(null, chunk)
      },
    })
    await pipeline(Readable.from(bodyChunks(body, signal)), compressedMeter, createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }), { signal })

    zipFile = await openZip(archivePath)
    if (zipFile.entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('archive contains too many entries')
    const seen = new Set<string>()
    let index = 0
    while (true) {
      signal.throwIfAborted()
      const entry = await nextZipEntry(zipFile)
      if (entry === undefined) break
      assertArchivePath(entry.fileName)
      if (seen.has(entry.fileName)) throw new Error('archive contains a duplicate entry path')
      seen.add(entry.fileName)
      if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0
        || entry.uncompressedSize > expandedLimit - expandedBytes) {
        throw new Error('archive exceeds the expanded-byte limit')
      }
      const target = join(root, `${String(index).padStart(8, '0')}.entry`)
      const entryBytes = await stageZipEntry(zipFile, entry, target, signal, expandedLimit - expandedBytes)
      expandedBytes += entryBytes
      entries.set(entry.fileName, { path: entry.fileName, file: target, bytes: entryBytes })
      index += 1
    }
    return {
      root,
      entries,
      cleanup: async () => {
        await rm(root, { recursive: true, force: true })
      },
    }
  } catch (error: unknown) {
    zipFile?.close()
    await rm(root, { recursive: true, force: true })
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    zipFile?.close()
  }
}

async function* bodyChunks(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const reader = body.getReader()
  const cancel = (): void => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const result = await reader.read()
      if (result.done) return
      yield result.value
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, {
      autoClose: false,
      lazyEntries: true,
      validateEntrySizes: true,
      strictFileNames: true,
    }, (error, zip) => {
      if (error !== null) reject(error)
      else resolve(zip)
    })
  })
}

function nextZipEntry(zip: ZipFile): Promise<ZipEntry | undefined> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: ZipEntry): void => { cleanup(); resolve(entry) }
    const onEnd = (): void => { cleanup(); resolve(undefined) }
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const cleanup = (): void => {
      zip.off('entry', onEntry)
      zip.off('end', onEnd)
      zip.off('error', onError)
    }
    zip.once('entry', onEntry)
    zip.once('end', onEnd)
    zip.once('error', onError)
    zip.readEntry()
  })
}

async function stageZipEntry(
  zip: ZipFile,
  entry: ZipEntry,
  target: string,
  signal: AbortSignal,
  expandedLimit: number,
): Promise<number> {
  const source = await new Promise<import('node:stream').Readable>((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error !== null) reject(error)
      else resolve(stream)
    })
  })
  let bytes = 0
  let checksum = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength
      if (bytes > expandedLimit) { callback(new Error('archive exceeds the expanded-byte limit')); return }
      checksum = crc32(chunk, checksum)
      callback(null, chunk)
    },
  })
  await pipeline(source, meter, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal })
  if (bytes !== entry.uncompressedSize) throw new Error(`archive entry "${entry.fileName}" has an inconsistent expanded size`)
  if ((checksum >>> 0) !== (entry.crc32 >>> 0)) throw new Error(`archive entry "${entry.fileName}" failed CRC validation`)
  return bytes
}

async function readStaged(entry: StagedEntry, maxBytes: number): Promise<Uint8Array> {
  if (entry.bytes > maxBytes) throw new Error(`archive entry "${entry.path}" exceeds its size limit`)
  return new Uint8Array(await readFile(entry.file))
}

async function digestFile(path: string): Promise<{ readonly digest: string; readonly bytes: number }> {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(path)) {
    const data = chunk as Uint8Array
    bytes += data.byteLength
    hash.update(data)
  }
  return { digest: hash.digest('hex'), bytes }
}

function sessionArchivePath(index: number): string {
  return `sessions/${String(index).padStart(8, '0')}/${SESSION_LOG_FILENAME}`
}

/** One archived session log's decoded header, events, and inherited row count. */
interface ParsedSessionLog {
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly inheritedEventCount: number
}

function parseLog(text: string, id: string): ParsedSessionLog {
  if (!text.endsWith('\n')) throw new Error(`session "${id}" log has no final newline`)
  const lines = text.slice(0, -1).split('\n')
  if (lines.length === 0 || lines.some(line => line === '')) throw new Error(`session "${id}" log has an empty row`)
  const firstLine = lines[0]
  if (firstLine === undefined) throw new Error(`session "${id}" log has an empty row`)
  let first: unknown
  try { first = JSON.parse(firstLine) } catch { throw new Error(`session "${id}" header is invalid JSON`) }
  if (!isRecord(first) || first['type'] !== 'session' || first['id'] !== id
    || first['version'] !== SESSION_FORMAT_VERSION || !Number.isSafeInteger(first['createdAt'])
    || typeof first['isSeeded'] !== 'boolean') {
    throw new Error(`session "${id}" header is invalid or uses an unsupported format`)
  }
  const { type: sessionType, ...headerValue } = first
  void sessionType
  const events: SessionFormatEvent[] = []
  for (const [index, line] of lines.slice(1).entries()) {
    let value: unknown
    try { value = JSON.parse(line) } catch { throw new Error(`session "${id}" event ${index} is invalid JSON`) }
    if (!isRecord(value) || value['seq'] !== index) throw new Error(`session "${id}" event sequence is not contiguous`)
    events.push(value as SessionFormatEvent)
  }
  const seedMarkers = events.filter(event => event.type === 'session/end-seed'
    && isRecord(event.data) && event.data['inherited'] === true)
  const inheritedEventCount = seedMarkers.at(-1)?.seq ?? 0
  if (first['isSeeded'] && seedMarkers.length === 0) throw new Error(`seeded session "${id}" has no inherited marker`)
  if (!first['isSeeded'] && seedMarkers.length > 0) throw new Error(`unseeded session "${id}" has an inherited marker`)
  const artifact: SessionFormatArtifact = {
    header: headerValue as SessionFormatHeader,
    inheritedEventCount,
    events,
  }
  restoreReleasedV4Artifact(artifact, KNOWN_SESSION_EVENT_TYPES)
  assertSessionCanContinue(id, events)
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id: brandString<SessionId>(id),
    createdAt: first['createdAt'] as number,
    ...(typeof first['cwd'] === 'string' ? { cwd: first['cwd'] } : {}),
    ...(typeof first['parentSession'] === 'string' ? { parentSession: brandString<SessionId>(first['parentSession']) } : {}),
    isSeeded: first['isSeeded'],
    ...(first['origin'] === 'subagent' ? { origin: 'subagent' } : {}),
    delegationDepth: first['delegationDepth'] as number,
    ...(typeof first['agentPreset'] === 'string' ? { agentPreset: first['agentPreset'] } : {}),
  }
  return {
    header,
    events: events as SessionEvent[],
    inheritedEventCount,
  }
}

async function validateArchive(
  staged: StagedArchive,
  options: { readonly maxSessionLogBytes: number; readonly maxImageBytes: number },
  signal: AbortSignal,
): Promise<RestorePlan> {
  const manifestEntry = staged.entries.get('manifest.json')
  if (manifestEntry === undefined) throw new Error('archive is missing manifest.json')
  const manifestBytes = await readStaged(manifestEntry, 4 * 1024 * 1024)
  let manifestValue: unknown
  try { manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes)) } catch { throw new Error('archive manifest is invalid JSON') }
  if (!isRecord(manifestValue) || manifestValue['format'] !== SESSION_ARCHIVE_FORMAT
    || manifestValue['archiveVersion'] !== SESSION_ARCHIVE_VERSION
    || manifestValue['sessionFormatVersion'] !== SESSION_FORMAT_VERSION
    || !Array.isArray(manifestValue['sessions'])) {
    throw new Error('archive format or version is unsupported')
  }
  const sessions: ImportedSession[] = []
  const images = new Map<string, ImageAttachmentRef>()
  const files = new Map<string, FileAttachmentRef>()
  const expectedPaths = new Set(['manifest.json'])
  const imageEntries = new Map<string, StagedEntry>()
  const fileEntries = new Map<string, StagedEntry>()
  const sessionIds = new Set<string>()
  for (const [index, value] of manifestValue['sessions'].entries()) {
    signal.throwIfAborted()
    if (!isRecord(value) || typeof value['id'] !== 'string' || typeof value['path'] !== 'string'
      || !Number.isSafeInteger(value['bytes']) || (value['bytes'] as number) < 0
      || typeof value['sha256'] !== 'string') {
      throw new Error('archive manifest contains an invalid Session entry')
    }
    const id = value['id']
    const path = value['path']
    if (sessionIds.has(id) || path !== sessionArchivePath(index)) throw new Error('archive manifest contains a duplicate or misplaced Session')
    sessionIds.add(id)
    const entry = staged.entries.get(path)
    if (entry === undefined) throw new Error(`archive is missing Session log "${id}"`)
    expectedPaths.add(path)
    if (entry.bytes !== value['bytes']) throw new Error(`Session log "${id}" has an invalid byte count`)
    const logDigest = await digestFile(entry.file)
    if (value['sha256'] !== `sha256:${logDigest.digest}`) throw new Error(`Session log "${id}" failed digest verification`)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await readStaged(entry, options.maxSessionLogBytes))
    const { header, events, inheritedEventCount } = parseLog(text, id)
    sessions.push({ id: brandString<SessionId>(id), header, events, path, inheritedEventCount })
    const refs = sessionLogAttachmentRefs(text)
    for (const ref of refs.images.values()) {
      const key = String(ref.attachmentId)
      const previous = images.get(key)
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(ref)) throw new Error('archive contains conflicting metadata for one image')
      images.set(key, ref)
      const assetPath = sessionLogImageEntryPath(ref)
      imageEntries.set(key, requireEntry(staged.entries, assetPath))
      expectedPaths.add(assetPath)
    }
    for (const ref of refs.files.values()) {
      const key = `${String(ref.attachmentId)}\0${ref.name}`
      files.set(key, ref)
      const assetPath = sessionLogFileEntryPath(ref)
      fileEntries.set(key, requireEntry(staged.entries, assetPath))
      expectedPaths.add(assetPath)
    }
  }
  for (const path of staged.entries.keys()) if (!expectedPaths.has(path)) throw new Error(`archive contains an unreferenced entry "${path}"`)
  for (const [key, ref] of images) {
    const entry = imageEntries.get(key)
    if (entry === undefined || entry.bytes !== ref.bytes || entry.bytes > options.maxImageBytes) {
      throw new Error(`image attachment "${key}" is missing or has invalid length`)
    }
    const result = await digestFile(entry.file)
    if (result.bytes !== ref.bytes || `sha256:${result.digest}` !== key) throw new Error(`image attachment "${key}" failed digest verification`)
  }
  for (const [key, ref] of files) {
    const entry = fileEntries.get(key)
    if (entry === undefined || entry.bytes !== ref.bytes) throw new Error(`file attachment "${key}" is missing or has invalid length`)
    const result = await digestFile(entry.file)
    if (result.bytes !== ref.bytes || `sha256:${result.digest}` !== String(ref.attachmentId)) {
      throw new Error(`file attachment "${key}" failed digest verification`)
    }
  }
  return { sessions, images, files, imageEntries, fileEntries }
}

function requireEntry(entries: ReadonlyMap<string, StagedEntry>, path: string): StagedEntry {
  const entry = entries.get(path)
  if (entry === undefined) throw new Error(`archive is missing referenced attachment "${path}"`)
  return entry
}

async function archiveFingerprint(staged: StagedArchive): Promise<string> {
  const hash = createHash('sha256')
  for (const entry of [...staged.entries.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    const digest = await digestFile(entry.file)
    hash.update(`${entry.path}\0${digest.bytes}\0${digest.digest}\n`)
  }
  return hash.digest('hex')
}

async function lstatOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error: unknown) {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error
  }
}

async function ensureJournalDirectory(root: string): Promise<void> {
  const home = dirname(dirname(root))
  const homeInfo = await lstat(home)
  if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink()) throw new Error('Harness home for Session archive journal is not a regular directory.')
  let current = home
  for (const part of ['session-archive', 'imports']) {
    current = join(current, part)
    const info = await lstatOrUndefined(current)
    if (info === undefined) {
      await mkdir(current, { mode: 0o700 }).catch((error: unknown) => {
        if (codeOf(error) !== 'EEXIST') throw error
      })
    }
    const createdOrExisting = await lstat(current)
    if (!createdOrExisting.isDirectory() || createdOrExisting.isSymbolicLink()) {
      throw new Error('Session archive journal path contains a non-directory or symbolic link.')
    }
  }
}

async function readJournal(path: string, fingerprint: string): Promise<RestoreJournal | undefined> {
  const info = await lstatOrUndefined(path)
  if (info === undefined) return undefined
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Session archive journal is not a regular file.')
  let value: unknown
  try { value = JSON.parse(await readFile(path, 'utf8')) } catch { throw new Error('Session archive journal is invalid JSON.') }
  if (!isRecord(value) || value['format'] !== SESSION_ARCHIVE_FORMAT || value['fingerprint'] !== fingerprint
    || !isRecord(value['attachments']) || !isRecord(value['sessions']) || typeof value['updatedAt'] !== 'string') {
    throw new Error('Session archive journal has unsupported or inconsistent fields.')
  }
  const attachments: Record<string, 'stored' | 'failed'> = {}
  for (const [id, status] of Object.entries(value['attachments'])) {
    if (status !== 'stored' && status !== 'failed') throw new Error('Session archive journal has an invalid attachment status.')
    attachments[id] = status
  }
  const sessions: Record<string, 'in-progress' | 'imported' | 'failed'> = {}
  for (const [id, status] of Object.entries(value['sessions'])) {
    if (status !== 'in-progress' && status !== 'imported' && status !== 'failed') throw new Error('Session archive journal has an invalid Session status.')
    sessions[id] = status
  }
  const workspaces: Record<string, 'attached' | 'failed'> = {}
  if (value['workspaces'] !== undefined) {
    if (!isRecord(value['workspaces'])) throw new Error('Session archive journal has invalid workspace outcomes.')
    for (const [id, status] of Object.entries(value['workspaces'])) {
      if (status !== 'attached' && status !== 'failed') throw new Error('Session archive journal has an invalid workspace status.')
      workspaces[id] = status
    }
  }
  return { format: SESSION_ARCHIVE_FORMAT, fingerprint, updatedAt: value['updatedAt'], attachments, sessions, workspaces }
}

async function attachSessionToWorkspace(
  registry: SessionArchiveDeps['workspaceRegistry'],
  header: SessionHeader,
  id: SessionId,
): Promise<{ readonly status: 'attached' | 'failed'; readonly detail: string }> {
  if (header.cwd === undefined) {
    return { status: 'failed', detail: 'Session has no cwd; it remains unassigned and must be placed in a Workspace manually.' }
  }
  if (registry === undefined) {
    return { status: 'failed', detail: 'WorkspaceRegistry is unavailable; retry after enabling the Workspace provider.' }
  }
  let workspace
  try {
    workspace = await registry.resolveByPath(header.cwd)
  } catch (error: unknown) {
    return { status: 'failed', detail: `Session cwd does not resolve to an existing directory: ${messageOf(error)}` }
  }
  if (workspace === undefined) {
    return { status: 'failed', detail: 'No existing Workspace matches the Session cwd; create or select that Workspace, then retry.' }
  }
  try {
    await workspace.attachSession(id)
    return { status: 'attached', detail: `Attached to existing Workspace "${workspace.title}".` }
  } catch (error: unknown) {
    return { status: 'failed', detail: `Workspace attachment failed: ${messageOf(error)}` }
  }
}

async function writeJournal(root: string, path: string, journal: RestoreJournal): Promise<void> {
  await ensureJournalDirectory(root)
  journal.updatedAt = new Date().toISOString()
  const temporary = join(root, `.session-archive-${randomUUID()}.partial`)
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  try { await rename(temporary, path) }
  catch (error: unknown) {
    try { await rm(temporary, { force: true }) }
    catch (cleanupError: unknown) {
      throw new AggregateError([error, cleanupError], 'Session archive journal replacement failed and its temporary file could not be removed.')
    }
    throw error
  }
}

function sameImageReference(left: ImageAttachmentRef, right: ImageAttachmentRef): boolean {
  return stableJson(left) === stableJson(right)
}

function sameFileReference(left: FileAttachmentRef, right: FileAttachmentRef): boolean {
  return stableJson(left) === stableJson(right)
}

function stableJson(value: unknown): string {
  const canonicalize = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(canonicalize)
    if (typeof node === 'object' && node !== null) {
      return Object.fromEntries(Object.entries(node).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]))
    }
    return node
  }
  return JSON.stringify(canonicalize(value))
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function sessionMatchesArchive(persistence: SessionPersistence, session: ImportedSession): Promise<boolean> {
  const stored = await readSessionLogText(persistence, session.id)
  if (stored === undefined) return false
  return stored === serializeSessionLog(session.header, session.events)
}

async function* fileChunks(path: string): AsyncIterable<Uint8Array> {
  for await (const chunk of createReadStream(path)) yield chunk as Uint8Array
}

async function* verifiedFileChunks(ref: FileAttachmentRef, source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of source) {
    bytes += chunk.byteLength
    hash.update(chunk)
    yield chunk
  }
  if (bytes !== ref.bytes || `sha256:${hash.digest('hex')}` !== String(ref.attachmentId)) {
    throw new Error(`file attachment "${String(ref.attachmentId)}" failed export verification`)
  }
}

/** Validate an archive, store referenced attachments, and import Session logs independently.
 * @param deps - Persistence and attachment providers that receive the restored data.
 * @param body - Incoming ZIP byte stream, or null when the request has no body.
 * @param limits - Compressed archive, expanded archive, Session log, and image size limits.
 * @param signal - Cancellation signal checked during validation and import.
 * @returns Per-item outcomes, imported Session IDs, and a journal path; partial writes are not rolled back.
 */
export async function restoreSessionArchive(
  deps: SessionArchiveReady,
  body: ReadableStream<Uint8Array> | null,
  limits: {
    readonly maxArchiveBytes: number
    readonly maxExpandedBytes: number
    readonly maxSessionLogBytes: number
    readonly maxImageBytes: number
  },
  signal: AbortSignal,
): Promise<SessionArchiveRestoreResult> {
  const staged = await stageZip(body, limits.maxArchiveBytes, limits.maxExpandedBytes, signal)
  try {
    const plan = await validateArchive(staged, {
      maxSessionLogBytes: limits.maxSessionLogBytes,
      maxImageBytes: limits.maxImageBytes,
    }, signal)
    if (deps.journalRoot === undefined) throw new Error('Session archive import requires an owned Harness home for its retry journal.')
    const journalRoot = deps.journalRoot
    const fingerprint = await archiveFingerprint(staged)
    await ensureJournalDirectory(journalRoot)
    const journalPath = join(journalRoot, `${fingerprint}.json`)
    return await withFileLock(journalPath, async () => {
      const journal = await readJournal(journalPath, fingerprint) ?? {
        format: SESSION_ARCHIVE_FORMAT,
        fingerprint,
        updatedAt: new Date().toISOString(),
        attachments: {},
        sessions: {},
        workspaces: {},
      }
      const outcomes: SessionArchiveImportOutcome[] = []
      const alreadyImported = new Set<string>()
      const journalDisplayPath = `$DSH_HOME/session-archive/imports/${fingerprint}.json`
      for (const session of plan.sessions) {
        signal.throwIfAborted()
        const existing = await deps.sessionPersistence.stat(session.id, { signal })
        if (existing === undefined) continue
        if (journal.sessions[String(session.id)] === undefined
        || !await sessionMatchesArchive(deps.sessionPersistence, session)) {
          throw new Error(`Session "${session.id}" already exists and does not match this archive journal; no Session was imported.`)
        }
        alreadyImported.add(String(session.id))
        journal.sessions[String(session.id)] = 'imported'
      }
      await writeJournal(journalRoot, journalPath, journal)

      // Attachments are immutable references inside Session events. Publish and
      // verify every object before creating any Session that can refer to it.
      let activeAttachment: SessionArchiveImportOutcome = { id: 'attachments', kind: 'attachment', status: 'not-started', detail: 'Not started.' }
      try {
        for (const [key, ref] of plan.images) {
          activeAttachment = { id: key, kind: 'image', status: 'not-started', detail: 'Not started.' }
          signal.throwIfAborted()
          const entry = requireEntry(staged.entries, sessionLogImageEntryPath(ref))
          const saved = await deps.attachments.saveImage({
            data: await readStaged(entry, limits.maxImageBytes), mediaType: ref.mediaType,
            ...(ref.name === undefined ? {} : { name: ref.name }),
          })
          if (!sameImageReference(saved, ref)) throw new Error(`official saveImage produced a different reference for image "${key}"`)
          journal.attachments[`image:${key}`] = 'stored'
          outcomes.push({ id: key, kind: 'image', status: 'stored', detail: 'Saved and verified through AttachmentStore.saveImage.' })
          await writeJournal(journalRoot, journalPath, journal)
        }
        for (const [key, ref] of plan.files) {
          activeAttachment = { id: key, kind: 'file', status: 'not-started', detail: 'Not started.' }
          signal.throwIfAborted()
          const entry = requireEntry(staged.entries, sessionLogFileEntryPath(ref))
          const saved = await deps.attachments.saveFileStream({ data: fileChunks(entry.file), name: ref.name, signal })
          if (!sameFileReference(saved, ref)) throw new Error(`official saveFileStream produced a different reference for file "${key}"`)
          journal.attachments[`file:${key}`] = 'stored'
          outcomes.push({ id: key, kind: 'file', status: 'stored', detail: 'Saved and verified through AttachmentStore.saveFileStream.' })
          await writeJournal(journalRoot, journalPath, journal)
        }
      } catch (error: unknown) {
        const message = messageOf(error)
        if (activeAttachment.kind !== 'attachment') {
          journal.attachments[`${activeAttachment.kind}:${activeAttachment.id}`] = 'failed'
          await writeJournal(journalRoot, journalPath, journal)
        }
        outcomes.push({ ...activeAttachment, status: 'failed', detail: message })
        const attempted = new Set(outcomes.map(outcome => `${outcome.kind}:${outcome.id}`))
        for (const key of plan.images.keys()) if (!attempted.has(`image:${key}`)) {
          outcomes.push({ id: key, kind: 'image', status: 'not-started', detail: 'A previous attachment failed.' })
        }
        for (const key of plan.files.keys()) if (!attempted.has(`file:${key}`)) {
          outcomes.push({ id: key, kind: 'file', status: 'not-started', detail: 'A previous attachment failed.' })
        }
        return {
          importedSessionIds: [], importedSessions: 0,
          outcomes: [
            ...outcomes,
            ...plan.sessions.map(({ id }) => ({ id: String(id), kind: 'session' as const, status: 'not-started' as const, detail: 'No Session was written because an attachment could not be reproduced exactly.' })),
          ], partial: true, journalPath: journalDisplayPath,
        }
      }

      const imported: SessionId[] = []
      for (const session of plan.sessions) {
        signal.throwIfAborted()
        const id = String(session.id)
        if (alreadyImported.has(id)) {
          imported.push(session.id)
          outcomes.push({ id, kind: 'session', status: 'already-imported', detail: 'Existing Session log matches the validated archive content.' })
        } else {
          journal.sessions[id] = 'in-progress'
          await writeJournal(journalRoot, journalPath, journal)
          let handle: Awaited<ReturnType<SessionPersistence['create']>> | undefined
          try {
            handle = await deps.sessionPersistence.create(session.header, {
              signal,
              inheritedEventCount: SessionLogOffset(session.inheritedEventCount),
            })
            await handle.append(session.events, { signal })
            await handle.flush({ signal })
            await handle.close()
            handle = undefined
            const stored = await readSessionLogText(deps.sessionPersistence, session.id, signal)
            if (stored === undefined || stored !== serializeSessionLog(session.header, session.events)) {
              throw new Error('persistence read-back differs from the validated archive content')
            }
            journal.sessions[id] = 'imported'
            imported.push(session.id)
            outcomes.push({ id, kind: 'session', status: 'imported', detail: 'Imported with one complete append batch and verified by read-back.' })
            await writeJournal(journalRoot, journalPath, journal)
          } catch (error: unknown) {
            let detail = messageOf(error)
            if (handle !== undefined) {
              try { await handle.close() }
              catch (closeError: unknown) { detail += `; write handle close failed: ${messageOf(closeError)}` }
            }
            journal.sessions[id] = 'failed'
            outcomes.push({ id, kind: 'session', status: 'failed', detail })
            await writeJournal(journalRoot, journalPath, journal)
            continue
          }
        }

        const workspaceResult = await attachSessionToWorkspace(deps.workspaceRegistry, session.header, session.id)
        journal.workspaces[id] = workspaceResult.status === 'attached' ? 'attached' : 'failed'
        outcomes.push({ id, kind: 'workspace', ...workspaceResult })
        await writeJournal(journalRoot, journalPath, journal)
      }
      return {
        importedSessionIds: imported, importedSessions: imported.length, outcomes,
        partial: outcomes.some(outcome => outcome.status === 'failed' || outcome.status === 'not-started'),
        journalPath: journalDisplayPath,
      }
    }, { waitMs: 60_000 })
  } finally {
    await staged.cleanup()
  }
}
