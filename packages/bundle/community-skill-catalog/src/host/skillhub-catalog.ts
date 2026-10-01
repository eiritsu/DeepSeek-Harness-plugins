/** Bounded SkillHub catalog Remote and verified installer for the local skill root. */

import { createHash as nodeCreateHash, randomUUID } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { isIP } from 'node:net'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32 } from 'node:zlib'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import ipaddr from 'ipaddr.js'
import { Agent, fetch } from 'undici'
import yauzl from 'yauzl'
import type { Entry as ZipEntry, ZipFile } from 'yauzl'
import type { InstalledSkill, SkillHubApiKeyFilter, SkillHubDetail, SkillHubInstallResult, SkillHubPage, SkillHubSkill, SkillHubSort } from '../types.ts'

const API = 'https://api.skillhub.cn'
const WEB = 'https://skillhub.cn'
const MAX_PAGE_SIZE = 50
const MAX_REDIRECTS = 3
const SLUG = /^[a-z0-9][a-z0-9_-]{0,127}$/i
const SHA256 = /^[a-f0-9]{64}$/i
const SORTS = new Set<SkillHubSort>(['score', 'downloads', 'stars', 'installs', 'updated_at'])

/** Catalog transport and install resource limits. */
export interface Config {
  /** SkillHub API HTTPS origin. */
  endpoint?: string
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /** Deadline for the exact-version ZIP download in milliseconds. */
  downloadTimeoutMs?: number
  /** Maximum catalog and detail JSON response size. */
  maxResponseBytes?: number
  /** Maximum number of files accepted for one skill. */
  maxFiles?: number
  /** Maximum number of ZIP entries, including directory entries. */
  maxArchiveEntries?: number
  /** Maximum compressed ZIP size in bytes. */
  maxArchiveBytes?: number
  /** Maximum total uncompressed skill size in bytes. */
  maxTotalBytes?: number
  /** Maximum bytes read for a SkillHub container metadata file. */
  maxMetadataBytes?: number
  /** Destination scanned by the official skill-filesystem provider. */
  skillRoot?: string
}

export type * from '../types.ts'

/** Host-side SkillHub operations exposed through Typert. */
export class SkillHubCatalog extends TypertRemoteService {
  static Config = z.object({
    endpoint: z.string().default(API),
    timeoutMs: z.number().step(1).min(1000).max(60000).default(15000),
    downloadTimeoutMs: z.number().step(1).min(1000).max(2147483647).default(120000),
    maxResponseBytes: z.number().step(1).min(1024).max(2 * 1024 * 1024).default(1024 * 1024),
    maxFiles: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(4096),
    maxArchiveEntries: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(8192),
    maxArchiveBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(128 * 1024 * 1024),
    maxTotalBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(512 * 1024 * 1024),
    maxMetadataBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(1024 * 1024),
    skillRoot: z.string().default(join(resolveDshHome(), 'skills')),
  })

  private readonly endpoint: URL
  private readonly timeoutMs: number
  private readonly downloadTimeoutMs: number
  private readonly maxResponseBytes: number
  private readonly maxFiles: number
  private readonly maxArchiveEntries: number
  private readonly maxArchiveBytes: number
  private readonly maxTotalBytes: number
  private readonly maxMetadataBytes: number
  private readonly skillRoot: string
  private readonly serviceAbort = new AbortController()
  private readonly installing = new Set<string>()
  private readonly removing = new Set<string>()
  private readonly activeInstalls = new Set<Promise<unknown>>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'skillHubCatalog')
    this.endpoint = new URL(config.endpoint ?? API)
    if (this.endpoint.protocol !== 'https:' || this.endpoint.username !== '' || this.endpoint.password !== '') {
      throw new Error('SkillHub endpoint must be HTTPS and contain no credentials.')
    }
    this.timeoutMs = config.timeoutMs ?? 15000
    this.downloadTimeoutMs = safeLimit(config.downloadTimeoutMs, 120000, 'downloadTimeoutMs')
    this.maxResponseBytes = config.maxResponseBytes ?? 1024 * 1024
    this.maxFiles = safeLimit(config.maxFiles, 4096, 'maxFiles')
    this.maxArchiveEntries = safeLimit(config.maxArchiveEntries, 8192, 'maxArchiveEntries')
    this.maxArchiveBytes = safeLimit(config.maxArchiveBytes, 128 * 1024 * 1024, 'maxArchiveBytes')
    this.maxTotalBytes = safeLimit(config.maxTotalBytes, 512 * 1024 * 1024, 'maxTotalBytes')
    this.maxMetadataBytes = safeLimit(config.maxMetadataBytes, 1024 * 1024, 'maxMetadataBytes')
    this.skillRoot = resolve(config.skillRoot ?? join(resolveDshHome(), 'skills'))
    ctx.effect(() => async () => {
      this.serviceAbort.abort(new Error('SkillHub catalog service was disposed.'))
      await Promise.allSettled([...this.activeInstalls])
    }, 'skillhub-catalog: drain active installs')
  }

  /** Search the public catalog with the supported category, source and API-key filters.
   * @param query Search term, limited to 120 characters.
   * @param category SkillHub category key or `all`.
   * @param source Publisher source or `all`.
   * @param apiKey Whether results require an API key.
   * @param sort Supported SkillHub sort key.
   * @param page One-based result page.
   * @param pageSize Requested result count, capped at 50.
   * @param signal Optional cancellation signal for catalog requests.
   * @returns Validated catalog rows and total count.
   */
  @Remote
  async catalog(
    query?: string,
    category?: string,
    source?: string,
    apiKey?: SkillHubApiKeyFilter,
    sort?: SkillHubSort,
    page?: number,
    pageSize?: number,
    signal?: AbortSignal,
  ): Promise<SkillHubPage> {
    signal = this.callSignal(signal)
    const selectedPage = integer(page ?? 1, 1, 10000)
    const selectedSize = integer(pageSize ?? 24, 1, MAX_PAGE_SIZE)
    const selectedSort = sort ?? 'score'
    if (!SORTS.has(selectedSort)) throw new Error('Unsupported SkillHub sort key.')
    if (apiKey !== undefined && !['all', 'required', 'none'].includes(apiKey)) throw new Error('Unsupported SkillHub API-key filter.')
    const url = this.url('/api/skills')
    url.searchParams.set('page', String(selectedPage))
    url.searchParams.set('pageSize', String(selectedSize))
    url.searchParams.set('sortBy', selectedSort)
    url.searchParams.set('order', 'desc')
    const selectedQuery = bounded(query, 120)
    const selectedCategory = bounded(category, 80)
    const selectedSource = bounded(source, 40)
    if (selectedQuery !== '') url.searchParams.set('keyword', selectedQuery)
    if (selectedCategory !== '' && selectedCategory !== 'all') url.searchParams.set('category', selectedCategory)
    if (selectedSource !== '' && selectedSource !== 'all') url.searchParams.set('source', selectedSource)
    if (apiKey === 'required') url.searchParams.set('labels', 'requires_api_key:true')
    if (apiKey === 'none') url.searchParams.set('labels', 'requires_api_key:false')
    const raw = record(await this.json(url, signal))
    const payload = record(raw?.data) ?? raw
    if (!Array.isArray(payload?.skills)) throw new Error('SkillHub returned an invalid skills page.')
    const items = payload.skills.map(skillRecord)
    const total = integerValue(payload.total, 'catalog total')
    return { items, total }
  }

  /** Read a skill's current detail and file inventory without downloading file bodies.
   * @param canonicalName Namespace-qualified identity from a SkillHub listing row.
   * @param signal Optional cancellation signal for detail requests.
   * @returns Validated detail plus the exact latest version and bounded file inventory.
   */
  @Remote
  async detail(canonicalName: string, signal?: AbortSignal): Promise<SkillHubDetail> {
    signal = this.callSignal(signal)
    const identity = parseSkillHubIdentity(canonicalName)
    const { skillSlug } = identity
    await this.assertUniqueIdentity(identity, signal)
    const detailRaw = record(await this.json(this.url(`/api/v1/skills/${encodeURIComponent(skillSlug)}`), signal))
    const rawSkill = record(detailRaw?.skill)
    if (rawSkill === undefined || rawSkill.slug !== skillSlug) throw new Error('SkillHub returned a mismatched skill detail.')
    const detailNamespace = record(rawSkill.namespace)
    if (detailNamespace?.canonicalName !== undefined && detailNamespace.canonicalName !== identity.canonicalName) {
      throw new RemoteError('skillhub/identity-changed', 'SkillHub detail publisher does not match the selected listing.', {})
    }
    const versionRaw = record(detailRaw?.latestVersion)
    const version = text(versionRaw?.version, 'SkillHub version', 32)
    const filesUrl = this.url(`/api/v1/skills/${encodeURIComponent(skillSlug)}/files`)
    filesUrl.searchParams.set('version', version)
    const inventory = record(await this.json(filesUrl, signal))
    if (inventory?.version !== version || !Array.isArray(inventory.files)) throw new Error('SkillHub returned a mismatched file inventory.')
    const files = inventory.files.map(validateSkillHubFile)
    await this.assertUniqueIdentity(identity, signal)
    if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('SkillHub returned duplicate file paths.')
    if (files.length === 0) throw new Error('SkillHub skill inventory must not be empty.')
    if (files.length > this.maxFiles) throw installLimit('files', this.maxFiles)
    const totalBytes = files.reduce((total, file) => total + file.size, 0)
    if (totalBytes > this.maxTotalBytes) throw installLimit('expanded', this.maxTotalBytes)
    if (files.filter(file => file.path === 'SKILL.md').length !== 1) throw new Error('SkillHub skill must contain exactly one root SKILL.md file.')
    const skill = skillRecord({
      namespace: { canonicalName: identity.canonicalName },
      slug: rawSkill.slug,
      name: rawSkill.displayName ?? rawSkill.name,
      description: rawSkill.summary ?? rawSkill.description,
      description_zh: rawSkill.summary_zh ?? rawSkill.description_zh,
      category: rawSkill.category,
      source: rawSkill.source,
      version,
      stats: rawSkill.stats,
      labels: rawSkill.labels,
    })
    const owner = record(detailRaw?.owner)
    signal.throwIfAborted()
    return {
      skill,
      owner: optionalText(owner?.displayName ?? owner?.handle, 120),
      changelog: optionalText(versionRaw?.changelog, 4000),
      files,
      totalBytes,
    }
  }

  /** Install an explicitly confirmed exact SkillHub release without replacing it until every entry verifies.
   * @param canonicalName Namespace-qualified identity from the detail page.
   * @param version Exact release version shown for confirmation.
   * @param confirmed Must be true from the explicit confirmation control.
   * @param signal Optional cancellation signal for the install transaction.
   * @returns Installed path and verified inventory totals.
   */
  @Remote
  async installSkill(canonicalName: string, version: string, confirmed: boolean, signal?: AbortSignal): Promise<SkillHubInstallResult> {
    signal = this.callSignal(signal)
    if (!confirmed) throw new Error('Confirm the skill installation first.')
    const identity = parseSkillHubIdentity(canonicalName)
    const selectedVersion = safeVersion(version)
    if (this.installing.has(identity.canonicalName)) throw new Error('A SkillHub install for this publisher and skill is already running.')
    this.installing.add(identity.canonicalName)
    const task = this.installSkillTransaction(identity, selectedVersion, signal)
    this.activeInstalls.add(task)
    try { return await task }
    finally {
      this.activeInstalls.delete(task)
      this.installing.delete(identity.canonicalName)
    }
  }

  /** List global DSH directory skills found in the configured skill root.
   * @returns Sorted direct child directories containing a regular `SKILL.md` file.
   */
  @Remote
  async listInstalledSkills(): Promise<InstalledSkill[]> {
    let rootStat
    try { rootStat = await lstat(this.skillRoot) }
    catch (error) {
      if (isMissingPath(error)) return []
      throw error
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Configured SkillHub root must be a regular directory.')
    const entries = await readdir(this.skillRoot, { withFileTypes: true })
    const skills: InstalledSkill[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = join(this.skillRoot, entry.name)
      const directory = await lstat(path)
      if (!directory.isDirectory() || directory.isSymbolicLink()) continue
      let manifest
      try { manifest = await lstat(join(path, 'SKILL.md')) }
      catch (error) {
        if (isMissingPath(error)) continue
        throw error
      }
      if (!manifest.isFile() || manifest.isSymbolicLink()) continue
      skills.push({ id: entry.name, name: displaySkillDirectory(entry.name) })
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Remove one confirmed directory skill from the global DSH skill root.
   * @param id - the direct child directory key returned by `listInstalledSkills`.
   * @param confirmed - must be true after the Client asks the user to confirm removal.
   * @returns The removed skill key.
   * @throws {Error} when confirmation is missing or the target is not a regular skill directory.
   */
  @Remote
  async removeInstalledSkill(id: string, confirmed: boolean): Promise<string> {
    if (!confirmed) throw new Error('Confirm skill removal first.')
    if (!isSkillDirectoryId(id)) throw new Error('Installed skill id is invalid.')
    if (this.removing.has(id)) throw new Error('This skill is already being removed.')
    this.removing.add(id)
    try {
      const rootStat = await lstat(this.skillRoot)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Configured SkillHub root must be a regular directory.')
      const target = join(this.skillRoot, id)
      const targetStat = await lstat(target)
      if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error('Installed skill must be a regular directory.')
      const manifestStat = await lstat(join(target, 'SKILL.md'))
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('Installed skill must contain a regular SKILL.md file.')
      await rm(target, { recursive: true })
      return id
    } finally { this.removing.delete(id) }
  }

  private async installSkillTransaction(
    identity: SkillHubIdentity,
    selectedVersion: string,
    signal: AbortSignal,
  ): Promise<SkillHubInstallResult> {
    const detail = await this.detail(identity.canonicalName, signal)
    if (detail.skill.version !== selectedVersion) {
      throw new Error('The SkillHub release changed. Review the current version again before installing.')
    }
    await this.assertUniqueIdentity(identity, signal)
    const root = await ensureSkillRoot(this.skillRoot)
    const control = await ensureControlRoot(root)
    const operation = await mkdtemp(join(control, 'install-'))
    let backupCleanupPending: string | undefined
    try {
      const archivePath = join(operation, 'skill.zip')
      const stagePath = join(operation, 'tree')
      await mkdir(stagePath, { mode: 0o700 })
      await downloadArchive(
        this.endpoint, this.downloadTimeoutMs, detail.skill.slug, selectedVersion,
        archivePath, this.maxArchiveBytes, signal,
      )
      await extractVerifiedArchive(archivePath, stagePath, detail.files, {
        slug: detail.skill.slug,
        version: selectedVersion,
        maxEntries: this.maxArchiveEntries,
        maxFiles: this.maxFiles,
        maxTotalBytes: this.maxTotalBytes,
        maxMetadataBytes: this.maxMetadataBytes,
      }, signal)
      await this.assertUniqueIdentity(identity, signal)
      signal.throwIfAborted()
      const target = skillTargetDirectory(root, identity.canonicalName)
      backupCleanupPending = await commitSkillDirectory(root, control, target, stagePath, signal)
    } finally {
      await rm(operation, { recursive: true, force: true })
    }
    const target = skillTargetDirectory(this.skillRoot, identity.canonicalName)
    return {
      canonicalName: identity.canonicalName,
      slug: detail.skill.slug,
      version: selectedVersion,
      path: target,
      files: detail.files.length,
      totalBytes: detail.totalBytes,
      ...(backupCleanupPending === undefined ? {} : { backupCleanupPending }),
    }
  }

  private async assertUniqueIdentity(identity: SkillHubIdentity, signal?: AbortSignal): Promise<void> {
    const url = this.url('/api/skills')
    url.searchParams.set('slug', identity.skillSlug)
    url.searchParams.set('page', '1')
    url.searchParams.set('pageSize', '100')
    url.searchParams.set('sortBy', 'score')
    url.searchParams.set('order', 'desc')
    const raw = record(await this.json(url, signal))
    const payload = record(raw?.data) ?? raw
    if (!Array.isArray(payload?.skills)) throw new Error('SkillHub could not verify this publisher identity.')
    const total = integerValue(payload.total, 'identity lookup total')
    const matchingSlug = payload.skills.map(skillRecord).filter(skill => skill.slug === identity.skillSlug)
    if (total !== 1 || payload.skills.length !== 1 || matchingSlug.length !== 1) {
      throw new RemoteError('skillhub/identity-ambiguous', 'SkillHub public detail and file routes cannot identify one publisher for this slug.', {})
    }
    if (matchingSlug[0]?.canonicalName !== identity.canonicalName) {
      throw new RemoteError('skillhub/identity-changed', 'SkillHub listing identity no longer matches the selected publisher.', {})
    }
  }

  private url(path: string): URL {
    const url = new URL(this.endpoint)
    url.pathname = `${url.pathname.replace(/\/$/u, '')}${path}`
    return url
  }

  private callSignal(signal?: AbortSignal): AbortSignal {
    return signal === undefined ? this.serviceAbort.signal : AbortSignal.any([signal, this.serviceAbort.signal])
  }

  private async json(url: URL, signal?: AbortSignal): Promise<unknown> {
    const response = await requestPublic(url, this.timeoutMs, 0, signal)
    try {
      if (response.status !== 200) throw new Error(`SkillHub returned HTTP ${response.status}.`)
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(response, this.maxResponseBytes)))
    } finally { await response.close() }
  }
}

/** Register the catalog service. */
export default class SkillHubCatalogPlugin extends SkillHubCatalog {}

function bounded(value: string | undefined, max: number): string {
  const result = value?.trim() ?? ''
  if (result.length > max) throw new Error(`SkillHub query field exceeds ${max} characters.`)
  return result
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isSkillDirectoryId(id: string): boolean {
  return id.length > 0 && id.length <= 255 && !id.startsWith('.') && id !== '..' && !id.includes('/') && !id.includes('\\') && !id.includes('\0')
}

function displaySkillDirectory(id: string): string {
  try { return decodeURIComponent(id) }
  catch { return id }
}

function integer(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value)) throw new Error('SkillHub pagination values must be safe integers.')
  return Math.max(minimum, Math.min(maximum, value))
}

function integerValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`SkillHub ${field} must be a non-negative integer.`)
  return value
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value))
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new Error(`SkillHub ${field} is invalid.`)
  return value.trim()
}

function optionalText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function count(value: unknown, field: string): number {
  return value === undefined || value === null ? 0 : integerValue(value, field)
}

function skillRecord(value: unknown): SkillHubSkill {
  const raw = record(value)
  if (raw === undefined) throw new Error('SkillHub returned an invalid skill record.')
  const slug = validateSkillHubSlug(text(raw.slug, 'slug', 128))
  const namespace = record(raw.namespace)
  const canonicalName = optionalText(namespace?.canonicalName, 256)
  const stats = record(raw.stats) ?? {}
  const labels = record(raw.labels) ?? {}
  const keyLabel = labels.requires_api_key
  const requiresApiKey = keyLabel === true || keyLabel === 'true' ? true : keyLabel === false || keyLabel === 'false' ? false : undefined
  const name = text(raw.name ?? raw.displayName, 'skill name', 160)
  const description = optionalText(raw.description_zh ?? raw.description ?? raw.summary_zh ?? raw.summary, 2000)
  const version = optionalText(raw.version, 32)
  return {
    ...(canonicalName === '' ? {} : { canonicalName }),
    slug, name, description,
    category: optionalText(raw.category, 80), source: optionalText(raw.source, 40), version,
    downloads: count(raw.downloads ?? stats.downloads, 'downloads'),
    stars: count(raw.stars ?? stats.stars, 'stars'),
    ...(requiresApiKey === undefined ? {} : { requiresApiKey }),
    url: `${WEB}/skills/${encodeURIComponent(slug)}`,
  }
}

/** Parsed namespace-qualified SkillHub identity.
 * @property canonicalName Exact identity returned in the listing namespace metadata.
 * @property namespace Namespace portion of the canonical identity.
 * @property skillSlug Slug addressed by SkillHub's documented detail and file routes.
 */
export interface SkillHubIdentity {
  readonly canonicalName: string
  readonly namespace: string
  readonly skillSlug: string
}

/** Parse the namespace-qualified identity returned by SkillHub listings.
 * @param raw - canonicalName from one SkillHub listing row.
 * @returns the exact canonical identity and its slug-only API components.
 * @throws {Error} when the identity is missing, malformed, or names a different slug.
 */
export function parseSkillHubIdentity(raw: string): SkillHubIdentity {
  const canonicalName = text(raw, 'canonical skill identity', 256)
  const match = /^@([a-z0-9_-]{1,64})\/([a-z0-9][a-z0-9_-]{0,127})$/iu.exec(canonicalName)
  const namespaceRaw = match?.[1]
  const slugRaw = match?.[2]
  if (namespaceRaw === undefined || slugRaw === undefined) {
    throw new Error('SkillHub publisher identity is missing or invalid; installation was blocked.')
  }
  const namespace = namespaceRaw.toLowerCase()
  const skillSlug = validateSkillHubSlug(slugRaw)
  if (canonicalName !== `@${namespace}/${skillSlug}`) throw new Error('SkillHub publisher identity is not canonical.')
  return { canonicalName, namespace, skillSlug }
}

/** Return a collision-free direct child path for one canonical SkillHub identity.
 * @param root - configured root directory for installed skills.
 * @param canonicalName - namespace-qualified identity from the catalog.
 * @returns an encoded directory path that cannot collide with another canonical name.
 */
export function skillTargetDirectory(root: string, canonicalName: string): string {
  const identity = parseSkillHubIdentity(canonicalName)
  return join(root, encodeURIComponent(identity.canonicalName))
}

/** Validate and canonicalize an external SkillHub slug.
 * @param raw - untrusted slug received from SkillHub or a Client.
 * @returns the lowercase slug accepted for API and filesystem paths.
 * @throws {Error} when the slug contains characters outside the accepted identifier grammar.
 */
export function validateSkillHubSlug(raw: string): string {
  const slug = text(raw, 'slug', 128)
  if (!SLUG.test(slug)) throw new Error('SkillHub slug is invalid.')
  return slug.toLowerCase()
}

function safeVersion(raw: string): string {
  const version = text(raw, 'version', 32)
  if (!/^[a-z0-9][a-z0-9._+-]*$/iu.test(version)) throw new Error('SkillHub version is invalid.')
  return version
}

/** Validate one file record received from the SkillHub inventory API.
 * @param value - untrusted JSON value returned by SkillHub.
 * @returns a normalized relative path, bounded size, and lowercase SHA-256.
 * @throws {Error} when fields are malformed or the path is unsafe.
 */
export function validateSkillHubFile(value: unknown): SkillHubDetail['files'][number] {
  const raw = record(value)
  if (raw === undefined) throw new Error('SkillHub returned an invalid file record.')
  const path = text(raw.path, 'file path', 512)
  if (path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0') || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`SkillHub returned an unsafe file path: ${path}`)
  }
  const size = integerValue(raw.size, 'file size')
  const sha256 = text(raw.sha256, 'file SHA-256', 64)
  if (!SHA256.test(sha256)) throw new Error(`SkillHub returned an invalid SHA-256 for ${path}.`)
  return { path, size, sha256: sha256.toLowerCase() }
}

function isPublicAddress(address: string, family: number): boolean {
  if (isIP(address) !== family) return false
  try {
    const parsed = ipaddr.parse(address)
    return parsed.range() === 'unicast'
  } catch { return false }
}

async function resolvePublic(url: URL, signal: AbortSignal): Promise<LookupAddress[]> {
  const family = isIP(url.hostname)
  let records: LookupAddress[]
  if (family !== 0) records = [{ address: url.hostname, family }]
  else {
    signal.throwIfAborted()
    records = await new Promise<LookupAddress[]>((resolvePromise, reject) => {
      const onAbort = (): void => {
        reject(signal.reason instanceof Error ? signal.reason : new Error('SkillHub request was aborted.'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void dnsLookup(url.hostname, { all: true, order: 'verbatim' }).then(resolvePromise, reject).finally(() =>{  signal.removeEventListener('abort', onAbort) })
    })
  }
  if (records.length === 0 || records.some(record => !isPublicAddress(record.address, record.family))) {
    throw new Error(`SkillHub URL host ${url.hostname} did not resolve exclusively to public addresses.`)
  }
  return records
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

function pinnedLookup(addresses: readonly LookupAddress[]): (hostname: string, options: LookupOptions, callback: LookupCallback) => void {
  return (hostname, options, callback): void => {
    const rows = options.family === 4 || options.family === 6 ? addresses.filter(row => row.family === options.family) : addresses
    if (rows.length === 0) { callback(new Error(`No pinned address for ${hostname}`), '', 0); return }
    if (options.all) { callback(null, [...rows]); return }
    const row = rows[0]
    if (row === undefined) { callback(new Error(`No pinned address for ${hostname}`), '', 0); return }
    callback(null, row.address, row.family)
  }
}

type UndiciResponse = Awaited<ReturnType<typeof fetch>>
interface ResponseHandle { readonly status: number; readonly headers: UndiciResponse['headers']; readonly body: UndiciResponse['body']; close(): Promise<void> }

async function requestPublic(initialUrl: URL, timeoutMs: number, maxRedirects = 0, parentSignal?: AbortSignal): Promise<ResponseHandle> {
  parentSignal?.throwIfAborted()
  const controller = new AbortController()
  const abort = (): void =>{  controller.abort(parentSignal?.reason) }
  parentSignal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { controller.abort(new Error('SkillHub request timed out.')) }, timeoutMs)
  let url = initialUrl
  let activeAgent: Agent | undefined
  try {
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error('SkillHub request redirects must use credential-free HTTPS URLs.')
      const route = proxyRouteFor(url)
      const proxied = route.proxied && isIP(url.hostname) === 0
      if (!proxied) {
        const addresses = await resolvePublic(url, controller.signal)
        // proxy-exempt: this agent pins the direct route's validated DNS result.
        activeAgent = new Agent({ connect: { lookup: pinnedLookup(addresses) } })
      }
      const dispatcher = proxied ? route.dispatcher : activeAgent
      if (dispatcher === undefined) throw new Error('SkillHub request has no network dispatcher.')
      let response: UndiciResponse
      // proxy-exempt: direct routes pin validated DNS; proxied routes use proxyRouteFor's dispatcher.
      try { response = await fetch(url, { dispatcher, redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json, application/octet-stream' } }) }
      catch (error: unknown) { throw new Error('SkillHub request failed.', { cause: error }) }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        await activeAgent?.close()
        activeAgent = undefined
        if (location === null || hop === maxRedirects) throw new Error('SkillHub returned an invalid or excessive redirect.')
        url = new URL(location, url)
        continue
      }
      const agent = activeAgent
      activeAgent = undefined
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
        close: async () => { clearTimeout(timer); parentSignal?.removeEventListener('abort', abort); await response.body?.cancel().catch(() => undefined); await agent?.close() },
      }
    }
    throw new Error('SkillHub redirect limit exceeded.')
  } catch (error: unknown) {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', abort)
    await activeAgent?.close()
    throw error
  }
}

async function readBounded(response: ResponseHandle, limit: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > limit) throw new Error(`SkillHub response exceeds ${limit} bytes.`)
  const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader()
  if (reader === undefined) throw new Error('SkillHub returned no response body.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error(`SkillHub response exceeds ${limit} bytes.`) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

interface ArchiveLimits {
  readonly slug: string
  readonly version: string
  readonly maxEntries: number
  readonly maxFiles: number
  readonly maxTotalBytes: number
  readonly maxMetadataBytes: number
}

async function downloadArchive(
  endpoint: URL,
  timeoutMs: number,
  slug: string,
  version: string,
  path: string,
  limit: number,
  signal?: AbortSignal,
): Promise<void> {
  const url = new URL(endpoint)
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/api/v1/download`
  url.searchParams.set('slug', slug)
  url.searchParams.set('version', version)
  const response = await requestPublic(url, timeoutMs, MAX_REDIRECTS, signal)
  try {
    if (response.status !== 200) throw new Error(`SkillHub release download returned HTTP ${response.status}.`)
    const declared = response.headers.get('content-length')
    const declaredBytes = declared === null ? undefined : Number(declared)
    if (declaredBytes !== undefined && (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes > limit)) {
      throw installLimit('archive', limit)
    }
    if (response.body === null) throw new Error('SkillHub returned no release archive body.')
    let bytes = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.byteLength
        if (bytes > limit) { callback(installLimit('archive', limit)); return }
        callback(null, chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal })
    if (declaredBytes !== undefined && bytes !== declaredBytes) throw new Error('SkillHub ZIP size did not match its content-length header.')
  } finally { await response.close() }
}

async function extractVerifiedArchive(archivePath: string, stagingPath: string, inventory: SkillHubDetail['files'], limits: ArchiveLimits, signal?: AbortSignal): Promise<void> {
  const expected = new Map(inventory.map(file => [file.path, file]))
  const foldedExpected = new Set<string>()
  for (const path of expected.keys()) {
    const folded = path.normalize('NFC').toLocaleLowerCase('en-US')
    if (foldedExpected.has(folded)) throw new Error(`SkillHub inventory contains a case-insensitive duplicate path: ${path}`)
    foldedExpected.add(folded)
  }
  const zip = await openZip(archivePath)
  const seen = new Set<string>()
  const files = new Set<string>()
  let expandedBytes = 0
  let entryCount = 0
  let fileCount = 0
  let containerMetadataPath: string | undefined
  try {
    for (;;) {
      signal?.throwIfAborted()
      const entry = await nextZipEntry(zip, signal)
      if (entry === undefined) break
      entryCount += 1
      if (entryCount > limits.maxEntries) throw installLimit('entries', limits.maxEntries)
      if ((entry.generalPurposeBitFlag & 1) !== 0) throw new Error('SkillHub ZIP contains an encrypted entry.')
      const entryPath = zipEntryPath(entry)
      const folded = entryPath.path.normalize('NFC').toLocaleLowerCase('en-US')
      if (seen.has(folded)) throw new Error(`SkillHub ZIP contains a duplicate path: ${entryPath.path}`)
      seen.add(folded)
      const destination = resolve(stagingPath, ...entryPath.parts)
      if (!destination.startsWith(`${resolve(stagingPath)}${sep}`)) throw new Error('SkillHub ZIP entry escaped the staging directory.')
      if (entryPath.directory) {
        if (entryPath.path === '') throw new Error('SkillHub ZIP contains an invalid root directory entry.')
        await mkdir(destination, { recursive: true, mode: 0o700 })
        continue
      }
      const file = expected.get(entryPath.path)
      const isContainerMetadata = entryPath.path === '_meta.json' && file === undefined
      if (file === undefined && !isContainerMetadata) throw new Error(`SkillHub ZIP contains an unlisted file: ${entryPath.path}`)
      if (!isContainerMetadata) {
        fileCount += 1
        if (fileCount > limits.maxFiles) throw installLimit('files', limits.maxFiles)
      }
      if (file !== undefined && file.size !== entry.uncompressedSize) throw new Error(`SkillHub ZIP size disagrees with the file inventory for ${entryPath.path}.`)
      const metadataTarget = isContainerMetadata ? join(dirname(stagingPath), 'container-meta.json') : undefined
      if (metadataTarget !== undefined) {
        if (containerMetadataPath !== undefined) throw new Error('SkillHub ZIP contains duplicate container metadata.')
        if (entry.uncompressedSize > limits.maxMetadataBytes) throw installLimit('metadata', limits.maxMetadataBytes)
        containerMetadataPath = metadataTarget
      }
      const path = metadataTarget ?? destination
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const extracted = await extractEntry(zip, entry, path, limits.maxTotalBytes - expandedBytes, signal)
      expandedBytes += extracted.bytes
      if (expandedBytes > limits.maxTotalBytes) throw installLimit('expanded', limits.maxTotalBytes)
      files.add(entryPath.path)
      if (file !== undefined && (extracted.bytes !== file.size || extracted.sha256 !== file.sha256)) {
        throw new Error(`SkillHub file integrity check failed for ${entryPath.path}.`)
      }
    }
    for (const path of expected.keys()) if (!files.has(path)) throw new Error(`SkillHub ZIP is missing an inventoried file: ${path}`)
    if (!files.has('SKILL.md')) throw new Error('SkillHub skill must contain exactly one root SKILL.md file.')
    if (containerMetadataPath !== undefined) await verifyContainerMetadata(containerMetadataPath, limits)
    else if (files.has('_meta.json')) await verifyContainerMetadata(join(stagingPath, '_meta.json'), limits)
  } finally {
    await closeZip(zip)
  }
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(path, { autoClose: false, lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error !== null) reject(error)
      else resolvePromise(zip)
    })
  })
}

function nextZipEntry(zip: ZipFile, signal?: AbortSignal): Promise<ZipEntry | undefined> {
  return new Promise((resolvePromise, reject) => {
    const cleanup = (): void => {
      zip.off('entry', onEntry)
      zip.off('end', onEnd)
      zip.off('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const onEntry = (entry: ZipEntry): void => { cleanup(); resolvePromise(entry) }
    const onEnd = (): void => { cleanup(); resolvePromise(undefined) }
    const onError = (error: Error): void => { cleanup(); reject(error) }
    const onAbort = (): void => {
      cleanup()
      reject(signal?.reason instanceof Error ? signal.reason : new Error('SkillHub archive read was aborted.'))
    }
    zip.once('entry', onEntry)
    zip.once('end', onEnd)
    zip.once('error', onError)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    else zip.readEntry()
  })
}

async function closeZip(zip: ZipFile): Promise<void> {
  if (!zip.isOpen) return
  await new Promise<void>((resolvePromise, reject) => {
    zip.once('close', resolvePromise)
    zip.once('error', reject)
    zip.close()
  })
}

function zipEntryPath(entry: ZipEntry): { path: string; parts: string[]; directory: boolean } {
  const raw = entry.fileName
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const fileType = unixMode & 0xf000
  if ([0xa000, 0x6000, 0x2000, 0x1000].includes(fileType) || (fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000)) {
    throw new Error(`SkillHub ZIP contains a link or special file: ${raw}`)
  }
  const directory = raw.endsWith('/') || fileType === 0x4000
  const path = directory && raw.endsWith('/') ? raw.slice(0, -1) : raw
  if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0')) throw new Error(`SkillHub ZIP contains an unsafe path: ${raw}`)
  const parts = path.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) throw new Error(`SkillHub ZIP contains an unsafe path: ${raw}`)
  return { path, parts, directory }
}

async function extractEntry(
  zip: ZipFile,
  entry: ZipEntry,
  target: string,
  remainingBytes: number,
  signal?: AbortSignal,
): Promise<{ readonly bytes: number; readonly sha256: string }> {
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > remainingBytes) throw installLimit('expanded', remainingBytes)
  const source = await new Promise<import('node:stream').Readable>((resolvePromise, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error !== null) reject(error)
      else resolvePromise(stream)
    })
  })
  let bytes = 0
  let checksum = 0
  const hash = nodeCreateHash('sha256')
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength
      if (bytes > remainingBytes) { callback(installLimit('expanded', remainingBytes)); return }
      checksum = crc32(chunk, checksum)
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(source, meter, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal })
  if (bytes !== entry.uncompressedSize || (checksum >>> 0) !== (entry.crc32 >>> 0)) throw new Error(`SkillHub ZIP entry failed size or CRC validation: ${entry.fileName}`)
  return { bytes, sha256: hash.digest('hex') }
}

async function verifyContainerMetadata(path: string, limits: ArchiveLimits): Promise<void> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('SkillHub container metadata is not a regular file.')
  if (stat.size > limits.maxMetadataBytes) throw installLimit('metadata', limits.maxMetadataBytes)
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path)))
  const metadata = record(raw)
  if (metadata === undefined || metadata.slug !== limits.slug || metadata.version !== limits.version) throw new Error('SkillHub container metadata does not match the selected skill release.')
  const allowed = new Set(['slug', 'version', 'ownerId', 'publishedAt'])
  if (Object.keys(metadata).some(key => !allowed.has(key))) throw new Error('SkillHub container metadata contains unsupported fields.')
  if (metadata.ownerId !== undefined && !(typeof metadata.ownerId === 'string' && metadata.ownerId.length > 0) && !(typeof metadata.ownerId === 'number' && Number.isSafeInteger(metadata.ownerId) && metadata.ownerId >= 0)) {
    throw new Error('SkillHub container metadata ownerId is invalid.')
  }
  if (metadata.publishedAt !== undefined && (typeof metadata.publishedAt !== 'number' || !Number.isSafeInteger(metadata.publishedAt) || metadata.publishedAt < 0)) {
    throw new Error('SkillHub container metadata publishedAt is invalid.')
  }
}

function safeLimit(value: number | undefined, fallback: number, field: string): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1) throw new Error(`SkillHub ${field} must be a positive safe integer.`)
  return selected
}

function installLimit(budget: 'archive' | 'entries' | 'files' | 'expanded' | 'metadata', limit: number): RemoteError<'skillhub/install-limit'> {
  return new RemoteError('skillhub/install-limit', `SkillHub installation exceeds the configured ${budget} budget.`, { budget, limit })
}

async function ensureSkillRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true })
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Configured SkillHub root must be a regular directory.')
  return root
}

async function ensureControlRoot(root: string): Promise<string> {
  const control = join(root, '.skillhub')
  await mkdir(control, { recursive: true, mode: 0o700 })
  const stat = await lstat(control)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('SkillHub control path must be a regular directory.')
  return control
}

/** Stage a verified skill and atomically replace its directory in the configured root.
 * @param root - official skill root directory.
 * @param target - one direct child directory to install.
 * @param files - already verified relative file paths and contents.
 * @param signal - optional cancellation accepted while staging.
 * @param removeBackup - filesystem cleanup operation; exposed for deterministic transaction tests.
 * @returns the retained old-version backup path when cleanup fails, otherwise undefined.
 * @throws {Error} before commit when staging, path checks, cancellation, or replacement fail.
 */
export async function replaceSkill(
  root: string,
  target: string,
  files: readonly { path: string; bytes: Uint8Array }[],
  signal?: AbortSignal,
  removeBackup: (path: string) => Promise<void> = path => rm(path, { recursive: true }),
): Promise<string | undefined> {
  await ensureSkillRoot(root)
  const control = await ensureControlRoot(root)
  const operation = await mkdtemp(join(control, 'replace-'))
  const staging = join(operation, 'tree')
  await mkdir(staging, { mode: 0o700 })
  try {
    for (const file of files) {
      signal?.throwIfAborted()
      const parts = safeSkillRelativePath(file.path)
      const destination = join(staging, ...parts)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, file.bytes, { flag: 'wx', mode: 0o600 })
    }
    if (files.filter(file => file.path === 'SKILL.md').length !== 1) throw new Error('SkillHub skill must contain exactly one root SKILL.md file.')
    return await commitSkillDirectory(root, control, target, staging, signal, removeBackup)
  } finally { await rm(operation, { recursive: true, force: true }) }
}

async function commitSkillDirectory(
  root: string,
  control: string,
  target: string,
  staging: string,
  signal?: AbortSignal,
  removeBackup: (path: string) => Promise<void> = path => rm(path, { recursive: true, force: true }),
): Promise<string | undefined> {
  if (dirname(target) !== root || relative(root, target).split(sep).length !== 1) throw new Error('SkillHub target escaped the configured skill root.')
  const stageStat = await lstat(staging)
  if (!stageStat.isDirectory() || stageStat.isSymbolicLink() || dirname(staging) !== control && !staging.startsWith(`${control}${sep}`)) throw new Error('SkillHub staging path must be a regular directory under its control root.')
  const controlStat = await lstat(control)
  if (!controlStat.isDirectory() || controlStat.isSymbolicLink()) throw new Error('SkillHub control path must be a regular directory.')
  const existing = await lstat(target).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
    throw error
  })
  if (existing !== undefined && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('SkillHub will replace only an existing regular skill directory.')
  signal?.throwIfAborted()
  const backup = join(control, `backup-${randomUUID()}`)
  let movedOld = false
  if (existing !== undefined) { await rename(target, backup); movedOld = true }
  try {
    signal?.throwIfAborted()
    await rename(staging, target)
  } catch (error: unknown) {
    if (movedOld) await rename(backup, target)
    throw error
  }
  if (movedOld) {
    try { await removeBackup(backup) }
    catch { return backup }
  }
  return undefined
}

function safeSkillRelativePath(path: string): string[] {
  const parts = path.split('/')
  if (path.startsWith('/') || path.includes('\\') || path.includes(':') || path.includes('\0') || parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`SkillHub returned an unsafe file path: ${path}`)
  }
  return parts
}
