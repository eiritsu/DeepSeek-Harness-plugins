/** Host plugin for provider-neutral full Session archive import and export. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import type { SessionArchiveCompressionLevel } from './zip.ts'
import { DEFAULT_SESSION_ARCHIVE_COMPRESSION_LEVEL } from './zip.ts'
import {
  DEFAULT_MAX_ARCHIVE_BYTES,
  DEFAULT_MAX_EXPANDED_BYTES,
  DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES,
  DEFAULT_MAX_SESSION_LOG_BYTES,
  restoreSessionArchive,
  sessionArchiveDeps,
  streamSessionArchive,
} from './archive.ts'
import { convertDesktopSqliteBackupToArchive } from './sqlite-backup.ts'
import type { SqliteBackupArchiveLimits } from './sqlite-backup.ts'
import {
  SESSION_ARCHIVE_PATH, SESSION_ARCHIVE_SQLITE_IMPORT_PATH, SESSION_ARCHIVE_SQLITE_LIST_PATH,
} from './routes.ts'

export { convertDesktopSqliteBackupToArchive } from './sqlite-backup.ts'
export type { SqliteBackupArchiveLimits } from './sqlite-backup.ts'

export {
  DEFAULT_MAX_ARCHIVE_BYTES,
  DEFAULT_MAX_EXPANDED_BYTES,
  DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES,
  DEFAULT_MAX_SESSION_LOG_BYTES,
  SESSION_ARCHIVE_FORMAT,
  SESSION_ARCHIVE_VERSION,
  restoreSessionArchive,
  sessionArchiveDeps,
  sessionArchiveEntries,
  streamSessionArchive,
} from './archive.ts'
export type { SessionArchiveDeps, SessionArchiveReady, SessionArchiveImportOutcome, SessionArchiveRestoreResult } from './archive.ts'
export type { SessionArchiveCompressionLevel } from './zip.ts'
export {
  SESSION_ARCHIVE_PATH, SESSION_ARCHIVE_ROUTE,
  SESSION_ARCHIVE_SQLITE_IMPORT_PATH, SESSION_ARCHIVE_SQLITE_IMPORT_ROUTE,
  SESSION_ARCHIVE_SQLITE_LIST_PATH, SESSION_ARCHIVE_SQLITE_LIST_ROUTE,
} from './routes.ts'

export const name = 'session-archive'
export const inject = ['connection', 'profileContext', 'sessionPersistence', 'attachments', 'sessions']

/** Bounded transfer and compression policy. */
export interface Config {
  /** Compression level used when exporting Session logs. */
  readonly compressionLevel?: SessionArchiveCompressionLevel
  /** Maximum compressed archive size accepted for import or produced by export, in bytes. */
  readonly maxArchiveBytes?: number
  /** Maximum expanded archive size accepted during import, in bytes. */
  readonly maxExpandedBytes?: number
  /** Maximum size of one Session log accepted for import or included in export, in bytes. */
  readonly maxSessionLogBytes?: number
  /** Maximum size of one image attachment accepted during import or included in export, in bytes. */
  readonly maxImageAttachmentBytes?: number
  /** Maximum source SQLite backup file size accepted for offline conversion, in bytes. */
  readonly maxSourceBytes?: number
  /** Maximum number of Sessions accepted in one offline conversion. */
  readonly maxSessionCount?: number
  /** Maximum number of event rows accepted in one offline conversion. */
  readonly maxEventCount?: number
  /** Maximum combined UTF-8 bytes of source header and event JSON text. */
  readonly maxInputJsonBytes?: number
}

/** Validate Session archive resource limits. */
export const Config: Schema<Config> = Schema.object({
  compressionLevel: Schema.number()
    .step(1).min(0).max(9)
    .default(DEFAULT_SESSION_ARCHIVE_COMPRESSION_LEVEL) as Schema<SessionArchiveCompressionLevel>,
  maxArchiveBytes: Schema.number().step(1).min(1).default(DEFAULT_MAX_ARCHIVE_BYTES),
  maxExpandedBytes: Schema.number().step(1).min(1).default(DEFAULT_MAX_EXPANDED_BYTES),
  maxSessionLogBytes: Schema.number().step(1).min(1).default(DEFAULT_MAX_SESSION_LOG_BYTES),
  maxImageAttachmentBytes: Schema.number().step(1).min(1).default(DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES),
  maxSourceBytes: Schema.number().step(1).min(1),
  maxSessionCount: Schema.number().step(1).min(1),
  maxEventCount: Schema.number().step(1).min(1),
  maxInputJsonBytes: Schema.number().step(1).min(1),
})

/** Register the authenticated Host archive transfer endpoint. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: SESSION_ARCHIVE_PATH,
    methods: ['GET', 'HEAD', 'POST'],
    requestBody: 'buffered',
    fetch: request => sessionArchiveResponse(ctx, request, config),
  }), 'session-archive: authenticated route')
  ctx.effect(() => ctx.connection.fetch.register({
    path: SESSION_ARCHIVE_SQLITE_LIST_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => listSqliteBackupsResponse(request),
  }), 'session-archive: SQLite backup listing route')
  ctx.effect(() => ctx.connection.fetch.register({
    path: SESSION_ARCHIVE_SQLITE_IMPORT_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => importSqliteBackupResponse(ctx, request, config),
  }), 'session-archive: SQLite backup import route')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function sessionArchiveResponse(ctx: Context, request: Request, config: Config): Promise<Response> {
  const deps = sessionArchiveDeps(ctx)
  if (deps.sessionPersistence === undefined || deps.attachments === undefined) {
    return json({ error: 'Session archive is unavailable: Session persistence or attachments are not mounted.' }, 503)
  }
  const ready = {
    sessionPersistence: deps.sessionPersistence,
    attachments: deps.attachments,
    sessions: deps.sessions,
    workspaceRegistry: deps.workspaceRegistry,
    journalRoot: deps.journalRoot,
  }
  if (request.method === 'HEAD') return new Response(null, { status: 200 })
  if (request.method === 'GET') {
    return new Response(streamSessionArchive(
      ready,
      config.compressionLevel ?? 6,
      request.signal,
      {
        maxSessionLogBytes: config.maxSessionLogBytes ?? DEFAULT_MAX_SESSION_LOG_BYTES,
        maxImageAttachmentBytes: config.maxImageAttachmentBytes ?? DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES,
        maxArchiveBytes: config.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES,
      },
    ), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="dsh-sessions-archive-v1.zip"',
      },
    })
  }
  try {
    const result = await restoreSessionArchive(ready, request.body, {
      maxArchiveBytes: config.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES,
      maxExpandedBytes: config.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES,
      maxSessionLogBytes: config.maxSessionLogBytes ?? DEFAULT_MAX_SESSION_LOG_BYTES,
      maxImageBytes: config.maxImageAttachmentBytes ?? DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES,
    }, request.signal)
    return json(result)
  } catch (error: unknown) {
    request.signal.throwIfAborted()
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message }, 400)
  }
}

async function listSqliteBackupsResponse(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json()
    if (!isRecord(body) || typeof body.directory !== 'string' || !isAbsolute(body.directory)) {
      return json({ error: 'Choose an absolute backup directory with the Host directory picker.' }, 400)
    }
    const selected = await lstat(body.directory)
    if (!selected.isDirectory() || selected.isSymbolicLink()) {
      return json({ error: 'The selected backup path is not a regular directory.' }, 400)
    }
    const directory = await realpath(body.directory)
    const entries = await readdir(directory, { withFileTypes: true })
    const files: { readonly name: string; readonly path: string; readonly bytes: number }[] = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.sqlite')) continue
      const path = join(directory, entry.name)
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) continue
      files.push({ name: entry.name, path, bytes: info.size })
    }
    files.sort((left, right) => left.name.localeCompare(right.name))
    return json({ files })
  } catch (error: unknown) {
    request.signal.throwIfAborted()
    return json({ error: errorMessage(error) }, 400)
  }
}

async function importSqliteBackupResponse(ctx: Context, request: Request, config: Config): Promise<Response> {
  try {
    const body: unknown = await request.json()
    if (!isRecord(body) || typeof body.backupPath !== 'string' || !isAbsolute(body.backupPath)
      || typeof body.attachmentRoot !== 'string' || !isAbsolute(body.attachmentRoot)) {
      return json({ error: 'Choose a SQLite backup and attachment directory with the Host directory picker.' }, 400)
    }
    const deps = sessionArchiveDeps(ctx)
    if (deps.sessionPersistence === undefined || deps.attachments === undefined) {
      return json({ error: 'Session archive is unavailable: Session persistence or attachments are not mounted.' }, 503)
    }
    const ready = {
      sessionPersistence: deps.sessionPersistence,
      attachments: deps.attachments,
      sessions: deps.sessions,
      workspaceRegistry: deps.workspaceRegistry,
      journalRoot: deps.journalRoot,
    }
    request.signal.throwIfAborted()
    const limits: SqliteBackupArchiveLimits = {
      ...(config.maxSourceBytes === undefined ? {} : { maxSourceBytes: config.maxSourceBytes }),
      ...(config.maxSessionCount === undefined ? {} : { maxSessionCount: config.maxSessionCount }),
      ...(config.maxEventCount === undefined ? {} : { maxEventCount: config.maxEventCount }),
      ...(config.maxInputJsonBytes === undefined ? {} : { maxInputJsonBytes: config.maxInputJsonBytes }),
      maxExpandedBytes: config.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES,
      maxArchiveBytes: config.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES,
      maxSessionLogBytes: config.maxSessionLogBytes ?? DEFAULT_MAX_SESSION_LOG_BYTES,
      maxImageAttachmentBytes: config.maxImageAttachmentBytes ?? DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES,
    }
    const archive = await convertDesktopSqliteBackupToArchive(body.backupPath, body.attachmentRoot, limits, request.signal)
    const result = await restoreSessionArchive(ready, byteStream(archive), {
      maxArchiveBytes: config.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES,
      maxExpandedBytes: config.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES,
      maxSessionLogBytes: config.maxSessionLogBytes ?? DEFAULT_MAX_SESSION_LOG_BYTES,
      maxImageBytes: config.maxImageAttachmentBytes ?? DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES,
    }, request.signal)
    return json({ ...result, sourceFormat: 'desktop-sqlite-v2' })
  } catch (error: unknown) {
    request.signal.throwIfAborted()
    return json({ error: errorMessage(error) }, 400)
  }
}

function byteStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) { controller.enqueue(bytes); controller.close() },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Cordis plugin entry point for the authenticated Session archive route. */
export default { name, inject, Config, apply }
