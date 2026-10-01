/** Preview and apply independently recoverable configuration, bundle, and skill changes. */

import { createHash, randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { dshHomeDisplay } from '@deepseek-ai/dsh-home-paths'
import type { BackupConfigEntry, BackupImportItem, BackupOperationResult, ConfigurationSkillsArchive } from './types.ts'
import { BACKUP_FORMAT, MAX_SKILL_BYTES, createArchive, digest, parseArchive, redactConfig, resolveSkillRoots, validateArchivePath, writeSkillFile } from './archive.ts'
import type { ArchiveLimits } from './archive.ts'

/** Resolve source skill-root ids to destination roots chosen by the user. */
export type SkillRootMapping = Readonly<Record<string, string>>

/** Compare one validated archive with the current profile without changing files or selections.
 * @param ctx - Host context supplying the active configuration, bundles, and skill roots.
 * @param archive - the validated archive to compare against this profile.
 * @param rootMapping - the destination skill root id chosen for each archived source root.
 * @returns the archive id and one preview row per archived configuration, bundle, directory, and file.
 */
export async function previewImport(
  ctx: Context,
  archive: ConfigurationSkillsArchive,
  rootMapping: SkillRootMapping = {},
): Promise<BackupOperationResult> {
  const archiveId = archiveIdOf(archive)
  const items: BackupImportItem[] = []
  const configuration = ctx.configEditor.configuration()
  for (const saved of archive.configs) items.push(previewConfig(configuration, saved))
  for (const saved of archive.bundles) {
    const current = (await ctx.pluginManager.listBundles()).find(row => row.name === saved.name)
    items.push(current === undefined || current.error !== undefined
      ? item(`bundle:${saved.name}`, 'bundle', 'missing', 'The bundle is not installed or the current profile cannot resolve it.')
      : item(`bundle:${saved.name}`, 'bundle', current.enabled ? 'identical' : 'ready', current.enabled ? 'Already selected.' : 'Installed and available for selection.'))
  }
  const roots = await resolveSkillRoots(ctx)
  const mappedRoots = new Map<string, (typeof roots)[number]>()
  for (const root of archive.skillRoots) {
    const destinationId = rootMapping[root.id] ?? root.id
    const destination = roots.find(candidate => candidate.id === destinationId && candidate.kind !== 'bundled')
    if (destination !== undefined) mappedRoots.set(root.id, destination)
  }
  for (const directory of archive.skillDirectories) {
    const root = mappedRoots.get(directory.rootId)
    if (root === undefined) {
      items.push(item(`directory:${directory.rootId}:${directory.path}`, 'skill-file', 'missing', 'No destination skill root was selected.'))
      continue
    }
    try {
      const target = await inspectPath(root.path, directory.path)
      items.push(item(`directory:${directory.rootId}:${directory.path}`, 'skill-file', target === 'directory' ? 'identical' : target === 'absent' ? 'ready' : 'conflict', target === 'directory' ? 'Directory already exists.' : target === 'absent' ? 'Directory will be created.' : 'A non-directory occupies this path.'))
    } catch (error: unknown) {
      items.push(item(`directory:${directory.rootId}:${directory.path}`, 'skill-file', 'unsupported', messageOf(error)))
    }
  }
  for (const file of archive.skillFiles) {
    const root = mappedRoots.get(file.rootId)
    if (root === undefined) {
      items.push(item(`file:${file.rootId}:${file.path}`, 'skill-file', 'missing', 'No destination skill root was selected.'))
      continue
    }
    try {
      const current = await readTarget(root.path, file.path)
      const status = current === undefined ? 'ready' : digest(current) === file.sha256 ? 'identical' : 'conflict'
      items.push(item(`file:${file.rootId}:${file.path}`, 'skill-file', status, status === 'identical' ? 'The destination file already matches.' : status === 'ready' ? 'A new file will be created.' : 'A different destination file exists.'))
    } catch (error: unknown) {
      items.push(item(`file:${file.rootId}:${file.path}`, 'skill-file', 'unsupported', messageOf(error)))
    }
  }
  for (const entry of archive.unsupported) items.push(item(`unsupported:${entry.kind}:${entry.id}`, 'config', 'unsupported', entry.reason))
  return { archiveId, items }
}

/** Apply only explicitly confirmed items, continuing independent items and journaling each outcome.
 * @param ctx - Host context supplying the active configuration, bundles, and skill roots.
 * @param archiveText - the complete archive document, revalidated before any write.
 * @param confirmedItemIds - the preview row ids the operator confirmed.
 * @param expectedArchiveId - the archive id the operator previewed.
 * @param rootMapping - the destination skill root id chosen for each archived source root.
 * @param limits - optional tighter limits for one import operation.
 * @returns one row per archived item with the outcome this import produced.
 * @throws Error when the archive changed since the preview.
 */
export async function applyImport(
  ctx: Context,
  archiveText: string,
  confirmedItemIds: readonly string[],
  expectedArchiveId: string,
  rootMapping: SkillRootMapping = {},
  limits: ArchiveLimits = {},
): Promise<BackupOperationResult> {
  const archive = parseArchive(archiveText, limits)
  const archiveId = archiveIdOf(archive)
  if (archiveId !== expectedArchiveId) throw new Error('The archive changed after preview; preview it again before importing.')
  const preview = await previewImport(ctx, archive, rootMapping)
  const statuses = new Map(preview.items.map(row => [row.id, row]))
  for (const id of confirmedItemIds) {
    const row = statuses.get(id)
    if (row === undefined || !['ready', 'conflict'].includes(row.status)) throw new Error(`Import item "${id}" is not eligible for confirmation.`)
  }
  const selected = new Set(confirmedItemIds)
  const outcomes = preview.items.map(row => ({ ...row }))
  const journal: {
    format: string
    archiveId: string
    updatedAt: string
    items: Array<{ id: string; kind: BackupImportItem['kind']; status: string; detail: string }>
  } = {
    format: BACKUP_FORMAT,
    archiveId,
    updatedAt: new Date().toISOString(),
    items: outcomes.map(({ id, kind, status, detail }) => ({ id, kind, status, detail })),
  }
  await writeJournal(ctx, archiveId, journal)
  const roots = await resolveSkillRoots(ctx)
  for (const outcome of outcomes) {
    if (!selected.has(outcome.id)) continue
    journal.updatedAt = new Date().toISOString()
    journal.items = outcomes.map(({ id, kind, status, detail }) => ({ id, kind,
      status: id === outcome.id ? 'applying' : status, detail: id === outcome.id ? 'Apply started; verify or retry if the process stops.' : detail }))
    await writeJournal(ctx, archiveId, journal)
    try {
      if (outcome.id.startsWith('config:')) {
        await applyConfig(ctx, confirmedEntry(archive.configs.find(row => `config:${row.id}` === outcome.id), 'configuration'))
      } else if (outcome.id.startsWith('bundle:')) {
        await applyBundle(ctx, confirmedEntry(archive.bundles.find(row => `bundle:${row.name}` === outcome.id), 'bundle'))
      } else if (outcome.id.startsWith('directory:')) {
        const saved = confirmedEntry(
          archive.skillDirectories.find(row => `directory:${row.rootId}:${row.path}` === outcome.id), 'directory',
        )
        const root = destinationRoot(roots, saved.rootId, rootMapping)
        await createDirectory(root.path, saved.path)
      } else if (outcome.id.startsWith('file:')) {
        const saved = confirmedEntry(archive.skillFiles.find(row => `file:${row.rootId}:${row.path}` === outcome.id), 'file')
        const root = destinationRoot(roots, saved.rootId, rootMapping)
        const recoveryPath = await writeSkillFile(root.path, saved.path, Buffer.from(saved.data, 'base64'))
        outcome.detail = recoveryPath === undefined ? 'Applied; retry is safe because the content is hash-verified.'
          : `Applied; previous file retained at ${recoveryPath}.`
      }
      outcome.status = 'applied'
      if (!outcome.detail.startsWith('Applied;')) outcome.detail = 'Applied; retry is safe because the selected operation is idempotent.'
    } catch (error: unknown) {
      outcome.status = 'failed'
      outcome.detail = `Apply failed: ${messageOf(error)}`
    }
    journal.updatedAt = new Date().toISOString()
    journal.items = outcomes.map(({ id, kind, status, detail }) => ({ id, kind, status, detail }))
    await writeJournal(ctx, archiveId, journal)
  }
  const refreshed = await previewImport(ctx, archive, rootMapping)
  return { archiveId, items: outcomes.map((row) => {
    if (!selected.has(row.id) || row.status === 'unsupported') return row
    const current = refreshed.items.find(item => item.id === row.id)
    return current?.status === 'identical' ? { ...row, detail: `${row.detail} Verified.` } : row
  }), journalPath: journalDisplay(ctx, archiveId) }
}

/** Create a downloadable, explicitly selected configuration and skills archive.
 * @param ctx - Host context supplying the active configuration and skill roots.
 * @param rootIds - the skill root ids the operator selected.
 * @param limits - optional tighter limits for one export operation.
 * @returns the archive document text.
 */
export async function exportArchive(ctx: Context, rootIds: readonly string[], limits: ArchiveLimits = {}): Promise<string> {
  return JSON.stringify(await createArchive(ctx, rootIds, limits))
}

function previewConfig(configuration: ReturnType<Context['configEditor']['configuration']>, saved: BackupConfigEntry): BackupImportItem {
  const row = configuration.find(candidate => candidate.entry.options.id === saved.id)
  if (row === undefined || row.entry.options.name !== saved.packageName) return item(`config:${saved.id}`, 'config', 'missing', 'The plugin is not active in this profile.')
  const schema = row.entry.fiber?.runtime?.Config
  if (schema === undefined) return item(`config:${saved.id}`, 'config', 'unsupported', 'The active plugin Config schema is unavailable.')
  try {
    const incoming = redactConfig(schema, saved.config)
    if (stableJson(incoming.config) !== stableJson(saved.config)) return item(`config:${saved.id}`, 'config', 'unsupported', 'The archive contains a value at a schema-declared secret field.')
    const current = redactConfig(schema, row.override)
    const status = stableJson(current.config) === stableJson(saved.config) ? 'identical' : Object.keys(current.config).length > 0 ? 'conflict' : 'ready'
    return item(`config:${saved.id}`, 'config', status, status === 'identical' ? 'Configuration already matches.' : status === 'conflict' ? 'Non-secret overrides differ; confirmation is required.' : 'Configuration can be restored.')
  } catch (error: unknown) {
    return item(`config:${saved.id}`, 'config', 'unsupported', `Schema validation failed: ${messageOf(error)}`)
  }
}

async function applyConfig(ctx: Context, saved: BackupConfigEntry): Promise<void> {
  const row = ctx.configEditor.configuration().find(candidate => candidate.entry.options.id === saved.id)
  if (row === undefined || row.entry.options.name !== saved.packageName) throw new Error('The configured plugin changed after preview.')
  const schema = row.entry.fiber?.runtime?.Config
  if (schema === undefined) throw new Error('The active plugin Config schema is unavailable.')
  const source = redactConfig(schema, saved.config)
  if (stableJson(source.config) !== stableJson(saved.config)) throw new Error('Secret values are forbidden in the archive configuration.')
  const currentRedacted = redactConfig(schema, row.override)
  const nextOverride = cloneJson(saved.config)
  for (const secret of currentRedacted.secrets) {
    if (!secret.wasConfigured) continue
    const value = getPath(row.override, secret.path)
    if (value !== undefined) setPath(nextOverride, secret.path, value)
  }
  await ctx.configEditor.edit(row.entry, (_current, inherited) => mergeConfig(inherited, nextOverride))
}

async function applyBundle(ctx: Context, saved: ConfigurationSkillsArchive['bundles'][number]): Promise<void> {
  const current = (await ctx.pluginManager.listBundles()).find(row => row.name === saved.name)
  if (current === undefined || current.error !== undefined) throw new Error('Bundle is no longer installed or available.')
  if (current.enabled) return
  const result = await ctx.pluginManager.setBundleEnabled(saved.name, true)
  if (result.application !== 'applied' && result.application !== 'restart-required') {
    throw new Error(`Bundle selection was ${result.application}${result.error === undefined ? '' : `: ${result.error.diagnostic ?? result.error.code}`}.`)
  }
  const actual = (await ctx.pluginManager.listBundles()).find(row => row.name === saved.name)
  if (actual?.enabled !== true) throw new Error('Bundle selection did not become active in the profile.')
}

/** Read path metadata, treating a missing entry as absent and rethrowing other failures as an Error. */
async function lstatOptional(path: string): Promise<Stats | undefined> {
  return await lstat(path).catch((error: unknown) => {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error instanceof Error ? error : new Error(String(error))
  })
}

/** Return the archived item a confirmed outcome still maps to, or fail when the archive no longer contains it. */
function confirmedEntry<T>(entry: T | undefined, label: string): T {
  if (entry === undefined) throw new Error(`The archive no longer contains the confirmed ${label} item.`)
  return entry
}

async function inspectPath(root: string, path: string): Promise<'absent' | 'directory' | 'file' | 'other'> {
  const parts = validateArchivePath(path)
  const canonicalRoot = resolve(root)
  let current = canonicalRoot
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    const info = await lstatOptional(current)
    if (info === undefined) return 'absent'
    if (info.isSymbolicLink()) throw new Error(`Destination contains a symbolic link at ${parts.slice(0, index + 1).join('/')}.`)
    if (index < parts.length - 1 && !info.isDirectory()) return 'other'
    if (index === parts.length - 1) return info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other'
  }
  return 'absent'
}

async function readTarget(root: string, path: string): Promise<Buffer | undefined> {
  const state = await inspectPath(root, path)
  if (state === 'absent') return undefined
  if (state !== 'file') throw new Error('A non-file occupies the skill destination path.')
  const bytes = await readFile(join(root, ...validateArchivePath(path)))
  if (bytes.byteLength > MAX_SKILL_BYTES) throw new Error('Destination file exceeds the supported size.')
  return bytes
}

async function createDirectory(root: string, path: string): Promise<void> {
  const parts = validateArchivePath(path)
  const canonicalRoot = resolve(root)
  let current = canonicalRoot
  for (const part of parts) {
    current = join(current, part)
    const info = await lstatOptional(current)
    if (info === undefined) await mkdir(current, { mode: 0o700 })
    else if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Skill destination has an unsafe directory: ${part}`)
  }
}

function destinationRoot(roots: Awaited<ReturnType<typeof resolveSkillRoots>>, sourceId: string, mapping: SkillRootMapping) {
  const id = mapping[sourceId] ?? sourceId
  const root = roots.find(candidate => candidate.id === id)
  if (root === undefined) throw new Error('A destination skill root is no longer available.')
  return root
}

async function writeJournal(ctx: Context, archiveId: string, journal: unknown): Promise<string> {
  const home = ctx.profileContext.home
  const homeInfo = await lstat(home)
  if (!homeInfo.isDirectory() || homeInfo.isSymbolicLink()) throw new Error('Profile home for the import journal is not a regular directory.')
  const root = join(home, 'backups', 'configuration-and-skills', 'imports')
  let current = home
  for (const part of ['backups', 'configuration-and-skills', 'imports']) {
    current = join(current, part)
    const info = await lstatOptional(current)
    if (info === undefined) await mkdir(current, { mode: 0o700 })
    else if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Import journal path contains a non-directory or symbolic link.')
  }
  const destination = join(root, `${archiveId}.json`)
  const temporary = join(root, `.journal-${randomUUID()}.partial`)
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  try { await rename(temporary, destination) }
  catch (error: unknown) { await rm(temporary, { force: true }).catch(() => undefined); throw error }
  return destination
}

function journalDisplay(ctx: Context, archiveId: string): string {
  return `${dshHomeDisplay(ctx.profileContext.home)}/backups/configuration-and-skills/imports/${archiveId}.json`
}

function archiveIdOf(archive: ConfigurationSkillsArchive): string {
  return createHash('sha256').update(stableJson(archive)).digest('hex')
}

function item(id: string, kind: BackupImportItem['kind'], status: BackupImportItem['status'], detail: string): BackupImportItem {
  return { id, kind, status, detail }
}

function stableJson(value: unknown): string {
  const canonicalize = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(canonicalize)
    if (typeof node === 'object' && node !== null) {
      return Object.fromEntries(
        Object.entries(node).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, canonicalize(child)]),
      )
    }
    return node
  }
  return JSON.stringify(canonicalize(value))
}

function cloneJson(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function mergeConfig(base: unknown, overlay: Record<string, unknown>): Record<string, unknown> {
  const result = isRecord(base) ? cloneJson(base) : {}
  for (const [key, value] of Object.entries(overlay)) {
    result[key] = isRecord(result[key]) && isRecord(value) ? mergeConfig(result[key], value) : value
  }
  return result
}

function getPath(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>(
    (current, key) => isRecord(current) ? current[key] : Array.isArray(current) ? current[Number(key)] : undefined,
    value,
  )
}

function setPath(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let current: Record<string, unknown> | unknown[] = root
  for (const [index, part] of path.slice(0, -1).entries()) {
    const nextPart = path[index + 1]
    if (nextPart === undefined) throw new Error('setPath received a path without a final segment.')
    const next: unknown = Array.isArray(current) ? current[Number(part)] : current[part]
    if (isRecord(next) || Array.isArray(next)) {
      current = next
      continue
    }
    const child: Record<string, unknown> | unknown[] = /^\d+$/u.test(nextPart) ? [] : {}
    if (Array.isArray(current)) current[Number(part)] = child
    else current[part] = child
    current = child
  }
  const last = path.at(-1)
  if (last === undefined) return
  if (Array.isArray(current)) current[Number(last)] = value
  else current[last] = value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
