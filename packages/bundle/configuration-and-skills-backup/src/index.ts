/** Optional Host route for configuration, skill-tree, and profile selection backups. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type {} from '@deepseek-ai/dsh-client-connection'
import Schema from '@deepseek-ai/schemastery'
import { MAX_ARCHIVE_BYTES, MAX_FILES, MAX_SKILL_BYTES, parseArchive, resolveSkillRoots } from './archive.ts'
import { applyImport, exportArchive, previewImport } from './operations.ts'
import type { SkillRootMapping } from './operations.ts'
import { CONFIGURATION_BACKUP_PATH } from './routes.ts'

export { BACKUP_FORMAT, BACKUP_VERSION, MAX_ARCHIVE_BYTES, MAX_FILES, MAX_SKILL_BYTES, createArchive, parseArchive, redactConfig, resolveSkillRoots, scanRoot, validateArchivePath, writeSkillFile } from './archive.ts'
export { applyImport, exportArchive, previewImport } from './operations.ts'
export { CONFIGURATION_BACKUP_PATH } from './routes.ts'
export type * from './types.ts'

/** Loader package name. */
export const name = 'configuration-and-skills-backup'
/** Authenticated profile services used by the Host route. */
export const inject = ['connection', 'profileContext', 'configEditor', 'pluginManager', 'loader']

/** Configurable limits for one archive operation. */
export interface Config {
  /** Maximum request/response document size in bytes. */
  maxArchiveBytes?: number
  /** Maximum expanded skill bytes. */
  maxSkillBytes?: number
  /** Maximum physical files captured from selected roots. */
  maxFiles?: number
}

/** Validate local archive limits. */
export const Config: Schema<Config> = Schema.object({
  maxArchiveBytes: Schema.number().step(1).min(1024).max(MAX_ARCHIVE_BYTES).default(MAX_ARCHIVE_BYTES),
  maxSkillBytes: Schema.number().step(1).min(1).max(MAX_SKILL_BYTES).default(MAX_SKILL_BYTES),
  maxFiles: Schema.number().step(1).min(1).max(MAX_FILES).default(MAX_FILES),
})

/** Register the authenticated archive transfer route. */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: CONFIGURATION_BACKUP_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: request => handleRequest(ctx, request, config),
  }), 'configuration-and-skills-backup: authenticated route')
}

async function handleRequest(ctx: Context, request: Request, config: Config): Promise<Response> {
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action')
    if (request.method === 'GET' && action === 'roots') {
      return json({ roots: await resolveSkillRoots(ctx).then(roots => roots.map(({ id, kind, label }) => ({ id, kind, label }))) })
    }
    if (request.method === 'GET' && action === 'export') {
      const archive = await exportArchive(ctx, url.searchParams.getAll('root'), limits(config))
      if (Buffer.byteLength(archive) > (config.maxArchiveBytes ?? MAX_ARCHIVE_BYTES)) throw new Error('Backup archive exceeds the configured upload limit.')
      return new Response(archive, { headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="dsh-configuration-and-skills-backup-v1.json"',
      } })
    }
    if (request.method === 'POST' && action === 'preview') {
      const payload = await requestJson(request, (config.maxArchiveBytes ?? MAX_ARCHIVE_BYTES) * 2)
      if (!record(payload) || typeof payload['archive'] !== 'string' || !record(payload['rootMapping'])
        || !Object.values(payload['rootMapping']).every(value => typeof value === 'string')) throw new Error('Backup preview request is invalid.')
      const archive = parseArchive(payload['archive'], limits(config))
      return json(await previewImport(ctx, archive, payload['rootMapping'] as SkillRootMapping))
    }
    if (request.method === 'POST' && action === 'apply') {
      const payload = await requestJson(request, (config.maxArchiveBytes ?? MAX_ARCHIVE_BYTES) * 2)
      if (!record(payload) || typeof payload['archive'] !== 'string' || typeof payload['archiveId'] !== 'string'
        || !Array.isArray(payload['items']) || !payload['items'].every(item => typeof item === 'string')
        || !record(payload['rootMapping']) || !Object.values(payload['rootMapping']).every(value => typeof value === 'string')) {
        throw new Error('Backup import request is invalid.')
      }
      parseArchive(payload['archive'], limits(config))
      return json(await applyImport(ctx, payload['archive'], payload['items'], payload['archiveId'], payload['rootMapping'] as SkillRootMapping, limits(config)))
    }
    return json({ error: 'Unsupported backup operation.' }, 404)
  } catch (error: unknown) {
    request.signal.throwIfAborted()
    return json({ error: error instanceof Error ? error.message : String(error) }, 400)
  }
}

async function requestText(request: Request, maxBytes: number): Promise<string> {
  const bytes = await requestBytes(request, maxBytes)
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

async function requestJson(request: Request, maxBytes: number): Promise<unknown> {
  try { return JSON.parse(await requestText(request, maxBytes)) } catch (error: unknown) {
    if (error instanceof SyntaxError) throw new Error('Backup import request is not valid JSON.')
    throw error
  }
}

async function requestBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const reader = request.body?.getReader()
  if (reader === undefined) throw new Error('Backup request body is empty.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > maxBytes) {
        await reader.cancel('request size limit exceeded')
        throw new Error('Backup request exceeds the configured size limit.')
      }
      chunks.push(result.value)
    }
  } finally { reader.releaseLock() }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8' } })
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function limits(config: Config) {
  return {
    maxArchiveBytes: config.maxArchiveBytes ?? MAX_ARCHIVE_BYTES,
    maxSkillBytes: config.maxSkillBytes ?? MAX_SKILL_BYTES,
    maxFiles: config.maxFiles ?? MAX_FILES,
  }
}

/** Cordis Loader plugin entry point. */
export default { name, inject, Config, apply }
