/** Portable, bounded configuration and physical skill-tree archive operations. */

import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { redactSecrets } from '@deepseek-ai/dsh-settings'
import type Schema from '@deepseek-ai/schemastery'
import type {
  BackupConfigEntry,
  BackupSkillFile,
  BackupSkillRoot,
  ConfigurationSkillsArchive,
} from './types.ts'

/** Archive format identifier. */
export const BACKUP_FORMAT = 'dsh-configuration-and-skills-backup'
/** Current portable archive version. */
export const BACKUP_VERSION = 1
/** Maximum JSON upload or download size. */
export const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024
/** Maximum expanded skill bytes retained in one archive. */
export const MAX_SKILL_BYTES = 64 * 1024 * 1024
/** Maximum number of archived files. */
export const MAX_FILES = 20_000

/** Byte, expansion, and entry limits applied before import writes. */
export interface ArchiveLimits {
  readonly maxArchiveBytes?: number
  readonly maxSkillBytes?: number
  readonly maxFiles?: number
}

/** A skill root with its local-only filesystem location. */
export interface ResolvedBackupRoot extends BackupSkillRoot {
  readonly path: string
}

/** Reject unsafe or ambiguous archive-relative paths.
 * @param path - one archive-relative path, using `/` separators.
 * @returns the path's validated segments.
 * @throws Error when the path is absolute, non-portable, or holds an unsafe segment.
 */
export function validateArchivePath(path: string): string[] {
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0')) {
    throw new Error(`Archive path is not relative and portable: ${path}`)
  }
  const parts = path.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..' || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(part))) {
    throw new Error(`Archive path contains an unsafe segment: ${path}`)
  }
  return parts
}

/** Decode and fully verify a portable archive before any import-side write.
 * @param text - complete UTF-8 archive document.
 * @param limits - optional tighter limits for one import operation.
 * @returns a fully validated archive; no filesystem changes are made.
 */
export function parseArchive(text: string, limits: ArchiveLimits = {}): ConfigurationSkillsArchive {
  const maxArchiveBytes = limits.maxArchiveBytes ?? MAX_ARCHIVE_BYTES
  const maxSkillBytes = limits.maxSkillBytes ?? MAX_SKILL_BYTES
  const maxFiles = limits.maxFiles ?? MAX_FILES
  if (Buffer.byteLength(text, 'utf8') > maxArchiveBytes) throw new Error('Backup archive exceeds the upload limit.')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('Backup archive is not valid JSON.') }
  if (!record(value) || !exactKeys(value, ['format', 'version', 'createdAt', 'configs', 'bundles', 'skillRoots', 'skillDirectories', 'skillFiles', 'unsupported'])
    || value['format'] !== BACKUP_FORMAT || value['version'] !== BACKUP_VERSION
    || typeof value['createdAt'] !== 'string' || !Number.isFinite(Date.parse(value['createdAt']))) {
    throw new Error('Backup archive format or version is unsupported.')
  }
  const configs = array(value['configs'], 'configs').map(parseConfig)
  const bundles = array(value['bundles'], 'bundles').map(parseBundle)
  const skillRoots = array(value['skillRoots'], 'skillRoots').map(parseRoot)
  const skillDirectories = array(value['skillDirectories'], 'skillDirectories').map(parseDirectory)
  const skillFiles = array(value['skillFiles'], 'skillFiles').map(parseSkillFile)
  const unsupported = array(value['unsupported'], 'unsupported').map(parseUnsupported)
  unique(configs.map(row => row.id), 'configuration id')
  unique(bundles.map(row => row.name), 'bundle name')
  unique(skillRoots.map(row => row.id), 'skill root id')
  const rootIds = new Set(skillRoots.map(row => row.id))
  const directoryKeys = skillDirectories.map(row => JSON.stringify([row.rootId, row.path]))
  unique(directoryKeys, 'skill directory path')
  for (const directory of skillDirectories) {
    validateArchivePath(directory.path)
    if (!rootIds.has(directory.rootId)) throw new Error(`Skill directory refers to unknown root "${directory.rootId}".`)
  }
  const fileKeys = new Set<string>()
  let expandedBytes = 0
  if (skillFiles.length > maxFiles) throw new Error('Backup archive contains too many skill files.')
  for (const file of skillFiles) {
    validateArchivePath(file.path)
    if (!rootIds.has(file.rootId)) throw new Error(`Skill file refers to unknown root "${file.rootId}".`)
    const key = JSON.stringify([file.rootId, file.path])
    if (fileKeys.has(key)) throw new Error(`Backup archive contains duplicate skill path "${file.path}".`)
    fileKeys.add(key)
    const data = decodeBase64(file.data)
    if (data.byteLength !== file.bytes || digest(data) !== file.sha256) throw new Error(`Skill file integrity check failed: ${file.path}`)
    expandedBytes += data.byteLength
    if (expandedBytes > maxSkillBytes) throw new Error('Backup archive exceeds the expanded skill limit.')
  }
  for (const file of skillFiles) {
    const parts = file.path.split('/')
    for (let index = 1; index < parts.length; index++) {
      if (fileKeys.has(JSON.stringify([file.rootId, parts.slice(0, index).join('/')]))) {
        throw new Error(`Backup archive has a file/directory path collision at "${parts.slice(0, index).join('/')}".`)
      }
    }
  }
  for (const directory of skillDirectories) {
    if (fileKeys.has(JSON.stringify([directory.rootId, directory.path]))) throw new Error(`Backup archive has a file/directory path collision at "${directory.path}".`)
    const parts = directory.path.split('/')
    for (let index = 1; index < parts.length; index++) {
      if (fileKeys.has(JSON.stringify([directory.rootId, parts.slice(0, index).join('/')]))) {
        throw new Error(`Backup archive has a file/directory path collision at "${parts.slice(0, index).join('/')}".`)
      }
    }
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: value['createdAt'], configs, bundles, skillRoots, skillDirectories, skillFiles, unsupported }
}

/** Build a safe snapshot of active plugin overrides and explicitly chosen skill roots.
 * @param ctx - Host context supplying the active configuration and loader entries.
 * @param selectedRootIds - the skill root ids the operator chose to include.
 * @param limits - optional tighter limits for one export operation.
 * @returns an archive holding the redacted configuration, bundle enablement, and the chosen skill files.
 */
export async function createArchive(
  ctx: Context,
  selectedRootIds: readonly string[],
  limits: ArchiveLimits = {},
): Promise<ConfigurationSkillsArchive> {
  const maxArchiveBytes = limits.maxArchiveBytes ?? MAX_ARCHIVE_BYTES
  const maxSkillBytes = limits.maxSkillBytes ?? MAX_SKILL_BYTES
  const maxFiles = limits.maxFiles ?? MAX_FILES
  const rootList = await resolveSkillRoots(ctx)
  unique([...selectedRootIds], 'selected root id')
  const selected = selectedRootIds.map((id) => {
    const root = rootList.find(item => item.id === id)
    if (root === undefined) throw new Error(`Selected skill root "${id}" is no longer available.`)
    return root
  })
  await rejectOverlappingRoots(selected)
  const configs: BackupConfigEntry[] = []
  const unsupported: ConfigurationSkillsArchive['unsupported'] = []
  const configured = ctx.configEditor.configuration()
  const activeIds = new Set(configured.map(row => row.entry.options.id))
  for (const { entry, override } of configured) {
    if (Object.keys(override).length === 0) continue
    const schema = entry.fiber?.runtime?.Config
    if (!isSchema(schema) || typeof schema.toJSON !== 'function') {
      unsupported.push({ kind: 'unknown-schema', id: entry.options.id, reason: 'Active Config schema is unavailable.' })
      continue
    }
    try {
      const redacted = redactConfig(schema, override)
      configs.push({
        id: entry.options.id,
        packageName: entry.options.name,
        config: redacted.config,
        secrets: redacted.secrets,
      })
    } catch (error: unknown) {
      unsupported.push({ kind: 'non-json-config', id: entry.options.id, reason: messageOf(error) })
    }
  }
  for (const patch of readProfilePatches('dsh', ctx.profileContext)) {
    if (patch.config === undefined || patch.id === undefined || activeIds.has(patch.id)) continue
    unsupported.push({ kind: 'inactive-config', id: patch.id, reason: 'Inactive plugin Config schema is not loaded; its raw values were not archived.' })
  }
  const bundles = (await ctx.pluginManager.listBundles())
    .filter(row => row.enabled)
    .map(row => ({ name: row.name, ...(row.version === undefined ? {} : { version: row.version }) }))
  const skillRoots = selected.map(({ path: _path, ...row }) => row)
  const skillDirectories: ConfigurationSkillsArchive['skillDirectories'] = []
  const skillFiles: BackupSkillFile[] = []
  let expandedBytes = 0
  for (const root of selected) {
    const tree = await scanTree(root.path, { maxSkillBytes, maxFiles })
    skillDirectories.push(...tree.directories.map(path => ({ rootId: root.id, path })))
    for (const file of tree.files) {
      expandedBytes += file.bytes
      if (expandedBytes > maxSkillBytes) throw new Error('Selected skill roots exceed the expanded archive limit.')
      skillFiles.push({ rootId: root.id, ...file })
      if (skillFiles.length > maxFiles) throw new Error('Selected skill roots contain too many files.')
    }
  }
  const archive: ConfigurationSkillsArchive = {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(),
    configs, bundles, skillRoots, skillDirectories, skillFiles, unsupported,
  }
  const serialized = JSON.stringify(archive)
  if (Buffer.byteLength(serialized) > maxArchiveBytes) throw new Error('Backup archive exceeds the upload limit.')
  return parseArchive(serialized, limits)
}

/** Reject fields the active schema cannot account for before secret redaction. */
export function validateDeclaredConfigFields(schema: unknown, value: unknown): void {
  const visit = (nodes: SchemaNode[], current: unknown, path: string): void => {
    const expanded = nodes.flatMap(node => node.type === 'transform' && node.inner ? [node.inner]
      : node.type === 'union' || node.type === 'intersect' ? node.list ?? [] : [node])
    if (Array.isArray(current)) {
      const arrays = expanded.filter(node => node.type === 'array' && node.inner)
      const tuples = expanded.filter(node => node.type === 'tuple' && node.list)
      if (arrays.length === 0 && tuples.length === 0 && current.length > 0) throw new Error(`Schema does not declare array values at ${path}.`)
      current.forEach((entry, index) => {
        const childSchemas = arrays.flatMap(node => node.inner ? [node.inner] : [])
        childSchemas.push(...tuples.flatMap(node => node.list?.[index] ? [node.list[index]] : []))
        if (childSchemas.length === 0) throw new Error(`Schema does not declare array index ${path}[${index}].`)
        visit(childSchemas, entry, `${path}[${index}]`)
      })
      return
    }
    if (!isObject(current)) return
    const objects = expanded.filter(node => node.type === 'object')
    const dictionaries = expanded.filter(node => node.type === 'dict')
    if (objects.length === 0 && dictionaries.length === 0) {
      if (Object.keys(current).length > 0) throw new Error(`Schema does not declare object fields at ${path}.`)
      return
    }
    for (const [key, childValue] of Object.entries(current)) {
      const childSchemas = objects.flatMap(node => node.dict?.[key] ? [node.dict[key]] : [])
      childSchemas.push(...dictionaries.flatMap(node => node.inner ? [node.inner] : []))
      if (childSchemas.length === 0) throw new Error(`Schema does not declare configuration field ${path}.${key}.`)
      visit(childSchemas, childValue, `${path}.${key}`)
    }
  }
  if (!isSchema(schema)) throw new Error('Config schema is unavailable.')
  visit([schema], value, '$')
}

/** Validate a config override against its schema and remove declared secret values.
 * @param schema - the active plugin's declared Config schema.
 * @param value - the operator's current override value.
 * @returns the secret-free configuration and the secret paths that were configured.
 * @throws Error when the override does not match the declared schema.
 */
export function redactConfig(schema: unknown, value: unknown): Pick<BackupConfigEntry, 'config' | 'secrets'> {
  validateDeclaredConfigFields(schema, value)
  if (!isSchema(schema)) throw new Error('Config schema is unavailable.')
  const redacted = redactSecrets(schema as Schema<never>, value)
  return {
    config: jsonObject(redacted.value),
    secrets: redacted.secrets.map(secret => ({ path: secret.path, wasConfigured: secret.set })),
  }
}

/** Resolve configured filesystem roots without exposing paths in archive metadata.
 * @param ctx - Host context supplying the loader's skill-filesystem entries and the profile facts.
 * @returns every configured skill root with its resolved filesystem path.
 */
export async function resolveSkillRoots(ctx: Context): Promise<ResolvedBackupRoot[]> {
  const roots: ResolvedBackupRoot[] = []
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name !== '@deepseek-ai/dsh-skill-filesystem') continue
    const config = plainRecord(entry.options.config)
    const providerId = entry.options.id
    if (config['includeDefaultRoots'] !== false) {
      const dshHome = resolveDshHome(stringOrUndefined(config['dshHome']))
      const agentsHome = resolve(expandHomePath(stringOrUndefined(config['agentsHome'])
        ?? process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents')))
      addRoot(roots, providerId, 'dsh-user', join(dshHome, 'skills'), 'Harness user skills')
      addRoot(roots, providerId, 'agents-user', join(agentsHome, 'skills'), 'Agent user skills')
      const project = await findProjectRoot(ctx.profileContext.cwd)
      addRoot(roots, providerId, 'project-dsh', join(project, '.dsh', 'skills'), 'Current project .dsh skills')
      addRoot(roots, providerId, 'project-agents', join(project, '.agents', 'skills'), 'Current project .agents skills')
      const bundled = stringOrUndefined(config['bundledSkillDir']) ?? process.env.DSH_BUNDLED_SKILL_DIR
      if (bundled !== undefined) addRoot(roots, providerId, 'bundled', expandHomePath(bundled), 'Built-in skills')
    }
    const custom = config['customSkillDirs']
    if (Array.isArray(custom)) custom.forEach((path, index) => {
      if (typeof path === 'string') addRoot(roots, providerId, 'custom', resolve(path), `Custom skill root ${index + 1}`, index)
    })
  }
  const available: ResolvedBackupRoot[] = []
  for (const root of roots) {
    try {
      const info = await lstat(root.path)
      if (!info.isDirectory() || info.isSymbolicLink()) continue
      await realpath(root.path)
      available.push(root)
    } catch (error: unknown) {
      if (codeOf(error) !== 'ENOENT') throw error
    }
  }
  return available
}

/** Scan a selected root without following symbolic links or accepting special files.
 * @param root - the explicitly selected physical skill directory.
 * @param limits - optional tighter per-file and file-count limits.
 * @returns one entry per readable file, with its archive-relative path and integrity metadata.
 */
export async function scanRoot(root: string, limits: Pick<ArchiveLimits, 'maxSkillBytes' | 'maxFiles'> = {}): Promise<Array<Omit<BackupSkillFile, 'rootId'>>> {
  return (await scanTree(root, limits)).files
}

/** Read all regular files and directories below a physical root without following symbolic links.
 * @param root - the explicitly selected physical skill directory.
 * @returns relative directory paths and file contents with integrity metadata.
 */
export async function scanTree(root: string, limits: Pick<ArchiveLimits, 'maxSkillBytes' | 'maxFiles'> = {}): Promise<{ directories: string[]; files: Array<Omit<BackupSkillFile, 'rootId'>> }> {
  const canonicalRoot = await assertRegularDirectory(root)
  const maxSkillBytes = limits.maxSkillBytes ?? MAX_SKILL_BYTES
  const maxFiles = limits.maxFiles ?? MAX_FILES
  const directories: string[] = []
  const files: Array<Omit<BackupSkillFile, 'rootId'>> = []
  let expandedBytes = 0
  const walk = async (directory: string, relativeDirectory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true })
    children.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      const parts = [...relativeDirectory.split('/').filter(Boolean), child.name]
      const archivePath = parts.join('/')
      validateArchivePath(archivePath)
      const path = join(directory, child.name)
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new Error(`Skill root contains a symbolic link: ${archivePath}`)
      if (info.isDirectory()) {
        directories.push(archivePath)
        await walk(path, archivePath)
        continue
      }
      if (!info.isFile()) throw new Error(`Skill root contains a special file: ${archivePath}`)
      if (info.size > maxSkillBytes || expandedBytes + info.size > maxSkillBytes) {
        throw new Error('Selected skill root exceeds the expanded archive limit.')
      }
      const canonicalFile = await realpath(path)
      if (!contained(canonicalRoot, canonicalFile)) throw new Error(`Skill file escaped its selected root: ${archivePath}`)
      const data = await readFile(path)
      expandedBytes += data.byteLength
      if (data.byteLength !== info.size) throw new Error(`Skill file changed while being archived: ${archivePath}`)
      files.push({ path: archivePath, bytes: data.byteLength, sha256: digest(data), data: data.toString('base64') })
      if (files.length > maxFiles) throw new Error('Selected skill root contains too many files.')
    }
  }
  await walk(canonicalRoot, '')
  return { directories, files }
}

/** Safely materialize one file below a selected root using same-directory atomic rename.
 * @param root - the explicitly selected physical skill directory.
 * @param path - the archive-relative destination path.
 * @param data - the file bytes to write.
 * @returns the relative path when content changed, or `undefined` when the destination already matched.
 * @throws Error when the destination escapes the root or is not a regular file.
 */
export async function writeSkillFile(root: string, path: string, data: Uint8Array): Promise<string | undefined> {
  const parts = validateArchivePath(path)
  const canonicalRoot = await assertRegularDirectory(root)
  let current = canonicalRoot
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    try {
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Skill destination has an unsafe parent: ${part}`)
    } catch (error: unknown) {
      if (codeOf(error) !== 'ENOENT') throw error
      await mkdir(current, { mode: 0o700 })
    }
  }
  if (!contained(canonicalRoot, current)) throw new Error('Skill destination escaped its selected root.')
  const lastPart = parts.at(-1)
  if (lastPart === undefined) throw new Error('Skill path is missing its final component.')
  const destination = join(current, lastPart)
  const existing = await lstat(destination).catch((error: unknown) => {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error instanceof Error ? error : new Error(String(error))
  })
  if (existing?.isSymbolicLink() || (existing !== undefined && !existing.isFile())) throw new Error(`Skill destination is not a regular file: ${path}`)
  const temporary = join(current, `.dsh-backup-${randomUUID()}.partial`)
  const backup = join(current, `.dsh-backup-${randomUUID()}.previous`)
  await writeFile(temporary, data, { flag: 'wx', mode: 0o600 })
  let movedExisting = false
  try {
    if (existing !== undefined) {
      await rename(destination, backup)
      movedExisting = true
    }
    try {
      await rename(temporary, destination)
    } catch (error: unknown) {
      if (movedExisting) await rename(backup, destination)
      throw error
    }
  } catch (error: unknown) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  return movedExisting ? relative(canonicalRoot, backup).split(sep).join('/') : undefined
}

/** Compute a lowercase SHA-256 digest for archive bytes. */
export function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function addRoot(roots: ResolvedBackupRoot[], providerId: string, kind: BackupSkillRoot['kind'], path: string, label: string, index = 0): void {
  roots.push({ id: `${providerId}:${kind}:${index}`, kind, label, path: resolve(path) })
}

async function findProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd)
  while (true) {
    try {
      const marker = await lstat(join(current, '.git'))
      if (!marker.isSymbolicLink() && (marker.isDirectory() || marker.isFile())) return current
    } catch (error: unknown) {
      if (codeOf(error) !== 'ENOENT') throw error
    }
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

async function rejectOverlappingRoots(roots: readonly ResolvedBackupRoot[]): Promise<void> {
  const canonical = await Promise.all(roots.map(root => realpath(root.path)))
  for (const [leftIndex, left] of canonical.entries()) {
    for (const right of canonical.slice(leftIndex + 1)) {
      if (contained(left, right) || contained(right, left)) {
        throw new Error('Selected skill roots overlap; select only one of the overlapping roots.')
      }
    }
  }
}

async function assertRegularDirectory(path: string): Promise<string> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Selected skill root must be a regular directory.')
  return realpath(path)
}

function contained(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function expandHomePath(path: string): string {
  return path === '~' ? homedir() : path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path
}

function parseConfig(value: unknown): BackupConfigEntry {
  if (!record(value) || !exactKeys(value, ['id', 'packageName', 'config', 'secrets'])
    || typeof value['id'] !== 'string' || typeof value['packageName'] !== 'string'
    || !record(value['config']) || !Array.isArray(value['secrets'])) throw new Error('Backup configuration entry is invalid.')
  const secrets = value['secrets'].map((item: unknown) => {
    if (!record(item) || !Array.isArray(item['path']) || !item['path'].every(part => typeof part === 'string')
      || typeof item['wasConfigured'] !== 'boolean') throw new Error('Backup secret descriptor is invalid.')
    return { path: [...item['path']] as string[], wasConfigured: item['wasConfigured'] }
  })
  return { id: value['id'], packageName: value['packageName'], config: jsonObject(value['config']), secrets }
}

function parseBundle(value: unknown): ConfigurationSkillsArchive['bundles'][number] {
  if (!record(value) || !exactKeys(value, ['name'], ['version']) || typeof value['name'] !== 'string'
    || (value['version'] !== undefined && typeof value['version'] !== 'string')) throw new Error('Backup bundle entry is invalid.')
  return { name: value['name'], ...(typeof value['version'] === 'string' ? { version: value['version'] } : {}) }
}

function parseRoot(value: unknown): BackupSkillRoot {
  if (!record(value) || !exactKeys(value, ['id', 'kind', 'label']) || typeof value['id'] !== 'string' || typeof value['label'] !== 'string'
    || !['dsh-user', 'agents-user', 'project-dsh', 'project-agents', 'custom', 'bundled'].includes(String(value['kind']))) {
    throw new Error('Backup skill root entry is invalid.')
  }
  return { id: value['id'], kind: value['kind'] as BackupSkillRoot['kind'], label: value['label'] }
}

function parseDirectory(value: unknown): { rootId: string; path: string } {
  if (!record(value) || !exactKeys(value, ['rootId', 'path'])
    || typeof value['rootId'] !== 'string' || typeof value['path'] !== 'string') {
    throw new Error('Backup skill directory entry is invalid.')
  }
  return { rootId: value['rootId'], path: value['path'] }
}

function parseSkillFile(value: unknown): BackupSkillFile {
  if (!record(value) || !exactKeys(value, ['rootId', 'path', 'bytes', 'sha256', 'data'])
    || typeof value['rootId'] !== 'string' || typeof value['path'] !== 'string'
    || typeof value['bytes'] !== 'number' || !Number.isSafeInteger(value['bytes']) || value['bytes'] < 0
    || typeof value['sha256'] !== 'string' || !/^[a-f0-9]{64}$/u.test(value['sha256']) || typeof value['data'] !== 'string') {
    throw new Error('Backup skill file entry is invalid.')
  }
  return { rootId: value['rootId'], path: value['path'], bytes: value['bytes'], sha256: value['sha256'], data: value['data'] }
}

function parseUnsupported(value: unknown): ConfigurationSkillsArchive['unsupported'][number] {
  if (!record(value) || !exactKeys(value, ['kind', 'id', 'reason'])
    || !['inactive-config', 'unknown-schema', 'non-json-config'].includes(String(value['kind']))
    || typeof value['id'] !== 'string' || typeof value['reason'] !== 'string') throw new Error('Backup unsupported entry is invalid.')
  return { kind: value['kind'] as ConfigurationSkillsArchive['unsupported'][number]['kind'], id: value['id'], reason: value['reason'] }
}

function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new Error('Skill file data is not canonical base64.')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new Error('Skill file data is not canonical base64.')
  return bytes
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!record(value)) throw new Error('Configuration must be a plain JSON object.')
  return cloneJsonObject(value)
}

function cloneJsonObject(value: Record<string, unknown>): Record<string, unknown> {
  const visiting = new WeakSet<object>()
  const clone = (node: unknown, path: string): unknown => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return node
    if (typeof node === 'number' && Number.isFinite(node)) return node
    if (Array.isArray(node)) {
      if (visiting.has(node)) throw new Error(`Configuration contains a cycle at ${path}.`)
      visiting.add(node)
      const result = node.map((entry, index) => clone(entry, `${path}[${index}]`))
      visiting.delete(node)
      return result
    }
    if (record(node)) {
      const prototype: unknown = Object.getPrototypeOf(node)
      if (prototype !== Object.prototype && prototype !== null) throw new Error(`Configuration contains a non-plain object at ${path}.`)
      if (visiting.has(node)) throw new Error(`Configuration contains a cycle at ${path}.`)
      visiting.add(node)
      const result: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(node)) Object.defineProperty(result, key, {
        value: clone(entry, `${path}.${key}`), enumerable: true, configurable: true, writable: true,
      })
      visiting.delete(node)
      return result
    }
    throw new Error(`Configuration contains a non-JSON value at ${path}.`)
  }
  return clone(value, '$') as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = [...required, ...optional]
  return Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key))
}

function array(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Backup archive ${name} must be an array.`)
  return value
}

function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Backup archive contains duplicate ${label}.`)
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSchema(value: unknown): value is SchemaNode {
  return (typeof value === 'object' && value !== null || typeof value === 'function') && 'type' in value
}

interface SchemaNode {
  toJSON?: () => unknown
  type?: string
  meta?: { role?: unknown }
  dict?: Record<string, SchemaNode>
  inner?: SchemaNode
  list?: SchemaNode[]
}

function plainRecord(value: unknown): Record<string, unknown> {
  return record(value) ? value : {}
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
