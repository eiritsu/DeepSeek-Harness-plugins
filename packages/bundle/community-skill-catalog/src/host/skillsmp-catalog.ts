/** Bounded SkillsMP manifest search and commit-pinned raw file installer. */

import { createHash, randomUUID } from 'node:crypto'
import { lookup as dnsLookup } from 'node:dns/promises'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { isIP } from 'node:net'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import ipaddr from 'ipaddr.js'
import { parse } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import { Agent, fetch } from 'undici'
import type {
  InstalledSkill, SkillsMpDetail, SkillsMpInstallResult, SkillsMpLocale, SkillsMpPage, SkillsMpSkill, SkillsMpSort, SkillsMpTaxonomy,
  SkillsMpTaxonomyCategory, SkillsMpTaxonomyOccupation,
} from '../types.ts'

const SEARCH_ORIGIN = 'https://skillsmp.com'
const GITHUB_RAW_ORIGIN = 'https://raw.githubusercontent.com'
const ALLOWED_ORIGINS = new Set([SEARCH_ORIGIN, GITHUB_RAW_ORIGIN])
const TUN_BENCHMARK_RANGE = ipaddr.parseCIDR('198.18.0.0/15')
const MAX_PAGE_SIZE = 50
const MAX_MANIFEST_RESPONSE_BYTES = 512 * 1024
const TAXONOMY_LOCALES = new Set<string>(['zh', 'en'])
const SHA = /^[a-f0-9]{40}$/iu
const LANGUAGES = new Set(['en', 'zh', 'ja', 'mul', 'und'])
const SORTS = new Set<SkillsMpSort>(['stars', 'recent'])

/** Catalog transport and install resource limits. */
export interface Config {
  /** Credential reference containing an optional SkillsMP API key. */
  skillsmpCredentialKey?: string
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number
  /** Deadline for resolving a detail or installing one reviewed Git commit. */
  operationTimeoutMs?: number
  /** Maximum JSON response and `SKILL.md` preview size. */
  maxResponseBytes?: number
  /** Maximum size of one installed GitHub file. */
  maxFileBytes?: number
  /** Maximum files accepted for one manifest, up to the source limit. */
  maxFiles?: number
  /** Maximum total manifest file size in bytes. */
  maxTotalBytes?: number
  /** Maximum SkillsMP search cache lifetime in milliseconds. */
  cacheTtlMs?: number
  /** Maximum distinct recent searches retained for detail identity checks. */
  maxCacheEntries?: number
  /** Maximum SkillsMP taxonomy cache lifetime in milliseconds. */
  metadataCacheTtlMs?: number
  /** Maximum categories and occupations accepted from the taxonomy. */
  maxTaxonomyEntries?: number
  /** Destination scanned by the official skill-filesystem provider. */
  skillRoot?: string
}

export type * from '../types.ts'

/** Host-side SkillsMP operations exposed through Typert. */
export class SkillsMpCatalog extends TypertRemoteService {
  static inject = ['credentials']
  static Config = z.object({
    skillsmpCredentialKey: z.string().role('credential-ref').default(''),
    timeoutMs: z.number().step(1).min(1000).max(60000).default(15000),
    operationTimeoutMs: z.number().step(1).min(1000).max(2147483647).default(120000),
    maxResponseBytes: z.number().step(1).min(1024).max(2 * 1024 * 1024).default(1024 * 1024),
    maxFileBytes: z.number().step(1).min(1).max(512_000).default(512_000),
    maxFiles: z.number().step(1).min(1).max(100).default(100),
    maxTotalBytes: z.number().step(1).min(1).max(5 * 1024 * 1024).default(5 * 1024 * 1024),
    cacheTtlMs: z.number().step(1).min(1000).max(60 * 60 * 1000).default(5 * 60 * 1000),
    maxCacheEntries: z.number().step(1).min(1).max(1000).default(100),
    metadataCacheTtlMs: z.number().step(1).min(1000).max(24 * 60 * 60 * 1000).default(60 * 60 * 1000),
    maxTaxonomyEntries: z.number().step(1).min(1).max(10000).default(2048),
    skillRoot: z.string().default(join(resolveDshHome(), 'skills')),
  })

  private readonly timeoutMs: number
  private readonly operationTimeoutMs: number
  private readonly maxResponseBytes: number
  private readonly maxFileBytes: number
  private readonly maxFiles: number
  private readonly maxTotalBytes: number
  private readonly cacheTtlMs: number
  private readonly maxCacheEntries: number
  private readonly metadataCacheTtlMs: number
  private readonly maxTaxonomyEntries: number
  private readonly skillRoot: string
  private readonly skillsmpCredentialKey: string | undefined
  private readonly serviceAbort = new AbortController()
  private readonly searches = new Map<string, { readonly expires: number; readonly page: SkillsMpPage }>()
  private readonly knownSkills = new Map<string, SkillsMpSkill>()
  private readonly taxonomies = new Map<SkillsMpLocale, { readonly expires: number; readonly value: SkillsMpTaxonomy }>()
  private readonly reviewed = new Map<string, ReviewedSkill>()
  private readonly installing = new Set<string>()
  private readonly removing = new Set<string>()
  private readonly activeInstalls = new Set<Promise<unknown>>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'skillsMpCatalog')
    this.skillsmpCredentialKey = config.skillsmpCredentialKey
    this.timeoutMs = safeLimit(config.timeoutMs, 15000, 'timeoutMs')
    this.operationTimeoutMs = safeLimit(config.operationTimeoutMs, 120000, 'operationTimeoutMs')
    this.maxResponseBytes = safeLimit(config.maxResponseBytes, 1024 * 1024, 'maxResponseBytes')
    this.maxFileBytes = safeLimit(config.maxFileBytes, 512_000, 'maxFileBytes')
    this.maxFiles = safeLimit(config.maxFiles, 100, 'maxFiles')
    this.maxTotalBytes = safeLimit(config.maxTotalBytes, 5 * 1024 * 1024, 'maxTotalBytes')
    this.cacheTtlMs = safeLimit(config.cacheTtlMs, 5 * 60 * 1000, 'cacheTtlMs')
    this.maxCacheEntries = safeLimit(config.maxCacheEntries, 100, 'maxCacheEntries')
    this.metadataCacheTtlMs = safeLimit(config.metadataCacheTtlMs, 60 * 60 * 1000, 'metadataCacheTtlMs')
    this.maxTaxonomyEntries = safeLimit(config.maxTaxonomyEntries, 2048, 'maxTaxonomyEntries')
    this.skillRoot = resolve(config.skillRoot ?? join(resolveDshHome(), 'skills'))
    ctx.effect(() => async () => {
      this.serviceAbort.abort(new Error('SkillsMP catalog service was disposed.'))
      await Promise.allSettled([...this.activeInstalls])
      this.searches.clear()
      this.knownSkills.clear()
      this.taxonomies.clear()
      this.reviewed.clear()
    }, 'skillsmp-catalog: drain active installs')
  }

  /** Search SkillsMP with a bounded query and supported filters.
   * @param query Required search term, limited to 120 characters.
   * @param category Optional category slug.
   * @param occupation Optional occupation slug.
   * @param language Optional content language filter.
   * @param sort Search order supported by SkillsMP.
   * @param page One-based result page.
   * @param pageSize Requested result count, capped at 50.
   * @param signal Optional cancellation signal for the request.
   * @returns Validated SkillsMP rows and pagination facts.
   */
  @Remote
  async catalog(
    query: string,
    category?: string,
    occupation?: string,
    language?: string,
    sort?: SkillsMpSort,
    page?: number,
    pageSize?: number,
    signal?: AbortSignal,
  ): Promise<SkillsMpPage> {
    signal = this.callSignal(signal)
    const selectedQuery = bounded(query, 120)
    if (selectedQuery.length === 0) throw new Error('SkillsMP search query must not be empty.')
    if (selectedQuery.includes('*')) throw new Error('SkillsMP wildcard searches are not supported.')
    const selectedCategory = bounded(category, 80)
    const selectedOccupation = bounded(occupation, 256)
    const selectedLanguage = bounded(language, 8)
    if (selectedLanguage !== '' && !LANGUAGES.has(selectedLanguage)) throw new Error('Unsupported SkillsMP language filter.')
    const selectedSort = sort ?? 'stars'
    if (!SORTS.has(selectedSort)) throw new Error('Unsupported SkillsMP sort key.')
    const selectedPage = integer(page ?? 1, 1, 10000)
    const selectedSize = integer(pageSize ?? 24, 1, MAX_PAGE_SIZE)
    const url = new URL('/api/v1/skills/search', SEARCH_ORIGIN)
    url.searchParams.set('q', selectedQuery)
    url.searchParams.set('limit', String(selectedSize))
    url.searchParams.set('page', String(selectedPage))
    url.searchParams.set('sortBy', selectedSort)
    if (selectedCategory !== '') url.searchParams.set('category', selectedCategory)
    if (selectedOccupation !== '') url.searchParams.set('occupation', selectedOccupation)
    if (selectedLanguage !== '') url.searchParams.set('language', selectedLanguage)
    const key = url.search
    const cached = this.cachedSearch(key)
    if (cached !== undefined) return cached
    {
      const raw = record(await this.json(url, this.timeoutMs, this.maxResponseBytes, signal))
      if (raw?.success !== true) throw new Error('SkillsMP returned an unsuccessful search response.')
      const data = record(raw.data)
      const pagination = record(data?.pagination)
      if (!Array.isArray(data?.skills) || pagination === undefined) throw new Error('SkillsMP returned an invalid search page.')
      const rows = data.skills.map(skillsMpSkill)
      const total = integerValue(pagination.total, 'total')
      const totalIsExact = booleanValue(pagination.totalIsExact, 'totalIsExact')
      const hasNext = booleanValue(pagination.hasNext, 'hasNext')
      const responsePage = integer(pagination.page as number, 1, 10000)
      if (responsePage !== selectedPage) throw new Error('SkillsMP returned a mismatched page number.')
      const result = { items: rows, total, totalIsExact, hasNext, page: responsePage }
      this.rememberSearch(key, result)
      return result
    }
  }

  /** Return the localized, bounded SkillsMP category and occupation taxonomy.
   * @param locale Source locale for official names.
   * @param forceRefresh Bypass the successful metadata cache.
   * @param signal Optional cancellation signal.
   * @returns Complete categories and the four-level occupation tree.
   */
  @Remote
  async taxonomy(locale: 'zh' | 'en', forceRefresh?: boolean, signal?: AbortSignal): Promise<SkillsMpTaxonomy> {
    if (!TAXONOMY_LOCALES.has(locale)) throw new Error('Unsupported SkillsMP taxonomy locale.')
    signal = this.operationSignal(this.callSignal(signal))
    const shouldRefresh = forceRefresh ?? false
    const cached = this.taxonomies.get(locale)
    if (!shouldRefresh && cached !== undefined && cached.expires > Date.now()) return cached.value
    const docs = await this.html(new URL(`/${locale}/docs/api`, SEARCH_ORIGIN), signal)
    const occupationHtml = await this.html(new URL(`/${locale}/occupations`, SEARCH_ORIGIN), signal)
    const leafGroupsUrl = new URL('/api/occupations/leaf-groups', SEARCH_ORIGIN)
    leafGroupsUrl.searchParams.set('locale', locale)
    const leafGroups = await this.json(leafGroupsUrl, this.timeoutMs, this.maxResponseBytes, signal, false)
    const value = parseSkillsMpTaxonomy(docs, occupationHtml, leafGroups, locale, this.maxTaxonomyEntries)
    this.taxonomies.set(locale, { expires: Date.now() + this.metadataCacheTtlMs, value })
    return value
  }

  /** Resolve a retained SkillsMP source URL to a complete, commit-pinned file manifest.
   * @param githubUrl GitHub repository or `/tree/<ref>/<path>` URL returned by SkillsMP.
   * @param signal Optional cancellation signal.
   * @returns Skill metadata, exact commit SHA, raw-file hashes, inventory and root SKILL.md text.
   */
  @Remote
  async detail(githubUrl: string, signal?: AbortSignal): Promise<SkillsMpDetail> {
    signal = this.operationSignal(this.callSignal(signal))
    const skill = this.knownSkill(githubUrl)
    const parsed = parseGitHubSkillUrl(skill.githubUrl)
    const authorization = await this.downloadTarget(skill, signal)
    const target = authorization.target
    validateTargetForSource(parsed, target)
    const manifest = parseDownloadManifest(
      await this.downloadManifest(target, authorization.token, signal),
      target,
      this.maxFiles,
      this.maxFileBytes,
      this.maxTotalBytes,
    )
    const files = manifest.files
    const reviewedFiles: ReviewedFile[] = []
    let totalBytes = 0
    let skillMarkdown: string | undefined
    for (const file of files) {
      signal.throwIfAborted()
      const bytes = await this.fetchRawBytes(file.rawUrl, file.path, file.size, this.maxFileBytes, signal)
      totalBytes += bytes.byteLength
      if (totalBytes > Math.min(this.maxTotalBytes, 5 * 1024 * 1024)) throw new Error('SkillsMP manifest exceeds the configured total file limit.')
      const sha = gitBlobSha(bytes)
      reviewedFiles.push({ path: file.path, size: file.size, sha, rawUrl: file.rawUrl })
      if (file.path === 'SKILL.md') {
        if (file.size > this.maxResponseBytes) throw new Error(`SkillsMP SKILL.md preview exceeds maxResponseBytes (${this.maxResponseBytes}).`)
        try { skillMarkdown = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
        catch (error: unknown) { throw new Error('SkillsMP returned invalid UTF-8 for SKILL.md.', { cause: error }) }
      }
    }
    if (skillMarkdown === undefined) throw new RemoteError('skillsmp/skill-markdown-missing', 'GitHub skill directory must contain a root SKILL.md file.', {})
    const detail = {
      skill,
      commitSha: manifest.commitSha,
      files: reviewedFiles.map(({ path, size, sha }) => ({ path, size, sha })),
      totalBytes,
      skillMarkdown,
    }
    this.rememberReview({ ...detail, reviewedFiles, target })
    return detail
  }

  /** Install the exact reviewed SkillsMP manifest after explicit confirmation.
   * @param githubUrl GitHub skill URL shown in the review.
   * @param commitSha Exact 40-character commit SHA shown in the review.
   * @param confirmed Must be true from the explicit confirmation control.
   * @param signal Optional cancellation signal for the transaction.
   * @returns Installed path and verified inventory totals.
   */
  @Remote
  async installSkill(githubUrl: string, commitSha: string, confirmed: boolean, signal?: AbortSignal): Promise<SkillsMpInstallResult> {
    signal = this.callSignal(signal)
    if (!confirmed) throw new Error('Confirm the skill installation first.')
    const selectedSha = safeSha(commitSha)
    const skill = this.knownSkill(githubUrl)
    const reviewed = this.reviewedSkill(skill.githubUrl, selectedSha)
    if (this.installing.has(skill.id)) throw new Error('An install for this SkillsMP skill is already running.')
    this.installing.add(skill.id)
    const deadline = AbortSignal.timeout(this.operationTimeoutMs)
    const installSignal = AbortSignal.any([signal, deadline])
    const task = this.installTransaction(reviewed, installSignal)
    this.activeInstalls.add(task)
    try { return await task }
    finally { this.activeInstalls.delete(task); this.installing.delete(skill.id) }
  }

  /** List regular direct child directories containing a regular `SKILL.md` file.
   * @returns Sorted installed skills.
   */
  @Remote
  async listInstalledSkills(): Promise<InstalledSkill[]> {
    let rootStat
    try { rootStat = await lstat(this.skillRoot) }
    catch (error: unknown) { if (isMissingPath(error)) return []; throw error }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Configured skill root must be a regular directory.')
    const entries = await readdir(this.skillRoot, { withFileTypes: true })
    const skills: InstalledSkill[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = join(this.skillRoot, entry.name)
      const directory = await lstat(path)
      if (!directory.isDirectory() || directory.isSymbolicLink()) continue
      let manifest
      try { manifest = await lstat(join(path, 'SKILL.md')) }
      catch (error: unknown) { if (isMissingPath(error)) continue; throw error }
      if (!manifest.isFile() || manifest.isSymbolicLink()) continue
      skills.push({ id: entry.name, name: displaySkillDirectory(entry.name) })
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name))
  }

  /** Remove one confirmed directory skill from the global skill root.
   * @param id Direct child directory key returned by `listInstalledSkills`.
   * @param confirmed Must be true after the Client asks the user to confirm removal.
   * @returns The removed skill key.
   */
  @Remote
  async removeInstalledSkill(id: string, confirmed: boolean): Promise<string> {
    if (!confirmed) throw new Error('Confirm skill removal first.')
    if (!isSkillDirectoryId(id)) throw new Error('Installed skill id is invalid.')
    if (this.removing.has(id)) throw new Error('This skill is already being removed.')
    this.removing.add(id)
    try {
      const rootStat = await lstat(this.skillRoot)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Configured skill root must be a regular directory.')
      const target = join(this.skillRoot, id)
      const targetStat = await lstat(target)
      if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error('Installed skill must be a regular directory.')
      const manifestStat = await lstat(join(target, 'SKILL.md'))
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('Installed skill must contain a regular SKILL.md file.')
      await rm(target, { recursive: true })
      return id
    } finally { this.removing.delete(id) }
  }

  private async installTransaction(reviewed: ReviewedSkill, signal: AbortSignal): Promise<SkillsMpInstallResult> {
    const { skill, commitSha: selectedSha } = reviewed
    const root = await ensureSkillRoot(this.skillRoot)
    const control = await ensureControlRoot(root)
    const operation = await mkdtemp(join(control, 'install-'))
    let backupCleanupPending: string | undefined
    try {
      const stage = join(operation, 'tree')
      await mkdir(stage, { mode: 0o700 })
      let total = 0
      for (const file of reviewed.reviewedFiles) {
        signal.throwIfAborted()
        const bytes = await this.fetchRawBytes(file.rawUrl, file.path, file.size, this.maxFileBytes, signal, file.sha)
        total += bytes.byteLength
        if (total > this.maxTotalBytes) throw new Error(`SkillsMP skill exceeds maxTotalBytes (${this.maxTotalBytes}).`)
        const destination = resolve(stage, ...safeRelativePath(file.path))
        if (!destination.startsWith(`${resolve(stage)}${sep}`)) throw new Error('GitHub file path escaped the staging directory.')
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
        await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
      }
      if (total !== reviewed.totalBytes) throw new Error('Installed GitHub file bytes do not match the reviewed inventory.')
      await this.validateStagedSkill(operation, signal)
      signal.throwIfAborted()
      const target = join(root, safeSkillId(skill.id))
      backupCleanupPending = await commitSkillDirectory(root, control, target, stage, signal)
    } finally { await rm(operation, { recursive: true, force: true }) }
    return {
      id: skill.id,
      commitSha: selectedSha,
      path: join(this.skillRoot, safeSkillId(skill.id)),
      files: reviewed.reviewedFiles.length,
      totalBytes: reviewed.totalBytes,
      ...(backupCleanupPending === undefined ? {} : { backupCleanupPending }),
    }
  }

  private async validateStagedSkill(operation: string, signal: AbortSignal): Promise<void> {
    const ctx = new Context()
    const provider = new FileSystemSkillProvider(ctx, { signal, invalidate: () => {} }, {
      includeDefaultRoots: false,
      customSkillDirs: [operation],
      watch: false,
    })
    try {
      const listed = await provider.list({ cwd: operation, signal })
      const candidates = 'candidates' in listed ? listed.candidates : listed
      if (candidates.length !== 1) throw incompatibleSkill()
      const candidate = candidates[0]
      if (candidate === undefined || await provider.get(candidate, { cwd: operation, signal }) === undefined) {
        throw incompatibleSkill()
      }
    } catch (error: unknown) {
      signal.throwIfAborted()
      if (error instanceof RemoteError && error.code === 'skillsmp/skill-incompatible') throw error
      throw incompatibleSkill(error)
    } finally {
      try { await provider.dispose() }
      finally { await ctx.fiber.dispose() }
    }
  }

  private async skillsMpToken(): Promise<string | undefined> {
    if (this.skillsmpCredentialKey === undefined || this.skillsmpCredentialKey.trim() === '') return undefined
    const credential = await this.ctx.credentials.resolve(credentialRef(this.skillsmpCredentialKey))
    if (credential === undefined) throw new Error('The configured SkillsMP credential reference is unavailable.')
    return credential.value
  }

  private async downloadTarget(skill: SkillsMpSkill, signal: AbortSignal): Promise<GithubContentsAuthorization> {
    const url = new URL('/api/github-contents/token', SEARCH_ORIGIN)
    const response = await requestPublic(url, this.timeoutMs, signal, {
      'content-type': 'application/json',
      origin: SEARCH_ORIGIN,
      referer: skill.url,
      'cache-control': 'no-store',
    }, { method: 'POST', body: JSON.stringify({ skillId: skill.id }) })
    try {
      throwSourceStatus(response.status)
      if (response.status !== 200) throw new Error(`SkillsMP download authorization returned HTTP ${response.status}.`)
      const payload = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(response, 4096))))
      if (payload === undefined || typeof payload.token !== 'string' || !/^[\x21-\x7E]{1,4096}$/u.test(payload.token)) {
        throw new Error('SkillsMP returned an invalid download authorization.')
      }
      return { target: parseGithubContentsTarget(payload.target), token: payload.token }
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error
      throw new Error('SkillsMP returned an invalid download authorization.', { cause: error })
    } finally { await response.close() }
  }

  private async downloadManifest(target: GithubContentsTarget, token: string, signal: AbortSignal): Promise<unknown> {
    const url = new URL('/api/github-contents', SEARCH_ORIGIN)
    url.searchParams.set('owner', target.owner)
    url.searchParams.set('repo', target.repo)
    url.searchParams.set('path', target.path)
    url.searchParams.set('branch', target.branch)
    const response = await requestPublic(url, this.timeoutMs, signal, {
      'x-skillsmp-client': 'web-download',
      'x-skillsmp-download-token': token,
      'cache-control': 'no-store',
    })
    try {
      throwSourceStatus(response.status)
      if (response.status !== 200) throw new Error(`SkillsMP source manifest returned HTTP ${response.status}.`)
      const bytes = await readBounded(response, Math.min(this.maxResponseBytes, MAX_MANIFEST_RESPONSE_BYTES))
      const body = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      if (body === undefined) throw new Error('SkillsMP returned an invalid source manifest.')
      return body
    } catch (error: unknown) {
      if (error instanceof RemoteError) throw error
      throw new Error('SkillsMP returned an invalid source manifest.', { cause: error })
    } finally { await response.close() }
  }

  private async fetchRawBytes(
    rawUrl: string,
    path: string,
    size: number,
    maxBytes: number,
    signal: AbortSignal,
    expectedSha?: string,
  ): Promise<Uint8Array> {
    const url = new URL(rawUrl)
    if (url.origin !== GITHUB_RAW_ORIGIN) throw new Error('Manifest raw URL is outside the allowed GitHub content origin.')
    const response = await requestPublic(url, this.timeoutMs, signal, undefined)
    try {
      if (response.status !== 200) throw new Error(`GitHub raw content returned HTTP ${response.status}.`)
      const bytes = await readBounded(response, Math.min(512_001, Math.max(maxBytes, size + 1)))
      const sha = gitBlobSha(bytes)
      if (bytes.byteLength !== size || expectedSha !== undefined && sha !== expectedSha) {
        throw new RemoteError('skillsmp/file-integrity-failed', `GitHub file integrity check failed for ${path}.`, { path })
      }
      return bytes
    } finally { await response.close() }
  }

  private async html(url: URL, signal: AbortSignal): Promise<string> {
    if (url.origin !== SEARCH_ORIGIN) throw new Error('SkillsMP URL is outside the allowed origin.')
    const response = await requestPublic(url, this.timeoutMs, signal, { accept: 'text/html' })
    try {
      throwSourceStatus(response.status)
      if (response.status !== 200) throw new Error(`SkillsMP taxonomy returned HTTP ${response.status}.`)
      try { return new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(response, this.maxResponseBytes)) }
      catch (error: unknown) { throw new Error('SkillsMP returned invalid taxonomy HTML.', { cause: error }) }
    } finally { await response.close() }
  }

  private async json(
    url: URL,
    timeoutMs: number,
    maxBytes: number,
    signal: AbortSignal,
    includeCredential = true,
  ): Promise<unknown> {
    if (url.origin !== SEARCH_ORIGIN) throw new Error('SkillsMP URL is outside the allowed origin.')
    const token = includeCredential ? await this.skillsMpToken() : undefined
    const response = await requestPublic(url, timeoutMs, signal, token === undefined ? undefined : { authorization: `Bearer ${token}` })
    try {
      if (response.status === 403 || response.status === 429) throw skillsMpStatusError(response.status)
      throwSourceStatus(response.status)
      if (response.status !== 200) throw new Error(`SkillsMP returned HTTP ${response.status}.`)
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBounded(response, maxBytes))) }
      catch (error: unknown) { throw new Error('SkillsMP returned invalid JSON.', { cause: error }) }
    } finally { await response.close() }
  }

  private cachedSearch(key: string): SkillsMpPage | undefined {
    const cached = this.searches.get(key)
    if (cached === undefined || cached.expires < Date.now()) { this.searches.delete(key); return undefined }
    this.rememberKnownSkills(cached.page.items)
    return cached.page
  }

  private rememberSearch(key: string, page: SkillsMpPage): void {
    this.searches.delete(key)
    this.searches.set(key, { expires: Date.now() + this.cacheTtlMs, page })
    this.rememberKnownSkills(page.items)
    while (this.searches.size > this.maxCacheEntries) this.searches.delete(this.searches.keys().next().value as string)
  }

  private rememberKnownSkills(skills: readonly SkillsMpSkill[]): void {
    for (const skill of skills) {
      this.knownSkills.delete(skill.githubUrl)
      this.knownSkills.set(skill.githubUrl, skill)
    }
    while (this.knownSkills.size > this.maxCacheEntries) this.knownSkills.delete(this.knownSkills.keys().next().value as string)
  }

  private rememberReview(review: ReviewedSkill): void {
    const key = reviewKey(review.skill.githubUrl, review.commitSha)
    this.reviewed.delete(key)
    this.reviewed.set(key, review)
    while (this.reviewed.size > this.maxCacheEntries) this.reviewed.delete(this.reviewed.keys().next().value as string)
  }

  private reviewedSkill(githubUrl: string, commitSha: string): ReviewedSkill {
    const key = reviewKey(githubUrl, commitSha)
    const review = this.reviewed.get(key)
    if (review === undefined) throw new RemoteError('skillsmp/review-required', 'Review this SkillsMP manifest again before installing it.', {})
    this.reviewed.delete(key)
    this.reviewed.set(key, review)
    return review
  }

  private knownSkill(githubUrl: string): SkillsMpSkill {
    const normalized = normalizeGitHubUrl(githubUrl)
    const skill = this.knownSkills.get(normalized)
    if (skill === undefined) throw new RemoteError('skillsmp/search-required', 'Search this skill in SkillsMP before requesting its detail or installing it.', {})
    this.knownSkills.delete(normalized)
    this.knownSkills.set(normalized, skill)
    return skill
  }

  private callSignal(signal?: AbortSignal): AbortSignal {
    return signal === undefined ? this.serviceAbort.signal : AbortSignal.any([signal, this.serviceAbort.signal])
  }

  private operationSignal(signal: AbortSignal): AbortSignal {
    return AbortSignal.any([signal, AbortSignal.timeout(this.operationTimeoutMs)])
  }
}

/** Register the SkillsMP catalog service. */
export default class SkillsMpCatalogPlugin extends SkillsMpCatalog {}

interface SkillsMpDocsTaxonomy {
  readonly categories: readonly Record<string, unknown>[]
  readonly occupations: readonly Record<string, unknown>[]
  readonly categoryNames: Readonly<Record<string, string>>
  readonly domainNames: Readonly<Record<string, string>>
  readonly l1Names: Readonly<Record<string, string>>
}

interface SkillsMpLeaf {
  readonly slug: string
  readonly parentSlug: string
  readonly label: string
  readonly skillCount: number
}

interface LocalizedOccupationName {
  readonly name: string
  readonly code?: string
}

/** Parse locale records, localized page labels and leaf metadata into the public taxonomy. */
function parseSkillsMpTaxonomy(
  docsHtml: string,
  occupationHtml: string,
  leafSource: unknown,
  locale: SkillsMpLocale,
  maxEntries: number,
): SkillsMpTaxonomy {
  const docs = parseDocsTaxonomy(docsHtml)
  const anchors = parseOccupationAnchors(occupationHtml, locale)
  const leaves = parseLeafGroups(leafSource)
  const categories = buildTaxonomyCategories(docs)
  const occupations = buildTaxonomyOccupations(docs, anchors, leaves)
  if (categories.length === 0 || occupations.length === 0) throw new Error('SkillsMP returned an empty taxonomy.')
  if (!occupations.some(item => item.level === 1) || !occupations.some(item => item.level === 2)
    || !occupations.some(item => item.level === 3) || !occupations.some(item => item.level === 4)) {
    throw new Error('SkillsMP occupation taxonomy is missing a hierarchy level.')
  }
  const entries = categories.length + occupations.length
  if (entries > maxEntries) throw new Error(`SkillsMP taxonomy exceeds maxTaxonomyEntries (${maxEntries}).`)
  return {
    categories: categories.sort((left, right) => compareText(left.slug, right.slug)),
    occupations: occupations.sort((left, right) => left.level - right.level || compareText(left.slug, right.slug)),
  }
}

/** Read category, occupation, and localized map records from Next Flight JSON frames. */
function parseDocsTaxonomy(html: string): SkillsMpDocsTaxonomy {
  const payloads = readFlightPayloads(html)
  const categories = readTypedRows(payloads, 'category', 'categories')
  const occupations = readTypedRows(payloads, 'occupation', 'occupations')
  const categoryNames = readStringMap(payloads, 'categoryNames')
  const domainNames = readStringMap(payloads, 'domainNames')
  const l1Names = readStringMap(payloads, 'l1Names')
  if (categories.length === 0 || occupations.length === 0 || Object.keys(categoryNames).length === 0
    || Object.keys(domainNames).length === 0 || Object.keys(l1Names).length === 0) {
    throw new Error('SkillsMP taxonomy documentation is incomplete.')
  }
  return { categories, occupations, categoryNames, domainNames, l1Names }
}

/** Extract type-1 `self.__next_f.push` string payloads with JSON parsing only. */
function readFlightPayloads(html: string): string[] {
  const scripts: string[] = []
  const visit = (node: DefaultTreeAdapterMap['node']): void => {
    if ('tagName' in node && node.tagName === 'script') {
      scripts.push(node.childNodes.map(child => child.nodeName === '#text' && 'value' in child ? child.value : '').join(''))
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child)
    if ('content' in node) for (const child of node.content.childNodes) visit(child)
  }
  visit(parse(html))
  const payloads: string[] = []
  for (const script of scripts) {
    const prefix = 'self.__next_f.push('
    let cursor = 0
    for (;;) {
      const marker = script.indexOf(prefix, cursor)
      if (marker < 0) break
      const start = marker + prefix.length
      const end = jsonContainerEnd(script, start)
      const frame: unknown = JSON.parse(script.slice(start, end))
      if (!isUnknownArray(frame) || typeof frame[0] !== 'number') throw new Error('SkillsMP returned an invalid Next Flight frame.')
      if (frame[0] === 1) {
        const payload = frame[1]
        if (typeof payload !== 'string') throw new Error('SkillsMP returned an invalid Next Flight data payload.')
        payloads.push(payload)
      }
      cursor = end + 1
    }
  }
  if (payloads.length === 0) throw new Error('SkillsMP taxonomy page has no Next Flight data payload.')
  return payloads
}

/** Find the JSON value boundary beginning at an object or array. */
function jsonContainerEnd(source: string, start: number): number {
  const opening = source[start]
  if (opening !== '{' && opening !== '[') throw new Error('SkillsMP Next Flight data contains an invalid JSON frame.')
  const closing: string[] = []
  let quoted = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === undefined) break
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') { quoted = true; continue }
    if (character === '{') closing.push('}')
    else if (character === '[') closing.push(']')
    else if (character === '}' || character === ']') {
      if (closing.pop() !== character) throw new Error('SkillsMP taxonomy JSON has unbalanced delimiters.')
      if (closing.length === 0) return index + 1
    }
  }
  throw new Error('SkillsMP taxonomy JSON is incomplete.')
}

function isUnknownArray(value: unknown): value is readonly unknown[] { return Array.isArray(value) }

/** Read one matching taxonomy row array from decoded Next Flight payloads. */
function readTypedRows(payloads: readonly string[], type: string, field: string): readonly Record<string, unknown>[] {
  const marker = `"type":"${type}"`
  for (const payload of payloads) {
    let cursor = 0
    while (cursor < payload.length) {
      const match = payload.indexOf(marker, cursor)
      if (match < 0) break
      const start = payload.lastIndexOf('{', match)
      if (start >= 0) {
        try {
          const value = record(JSON.parse(payload.slice(start, jsonContainerEnd(payload, start))))
          const rows = value?.[field]
          if (value?.type === type && Array.isArray(rows)) {
            return rows.map((row: unknown) => {
              const parsed = record(row)
              if (parsed === undefined) throw new Error(`SkillsMP returned an invalid ${type} taxonomy row.`)
              return parsed
            })
          }
        } catch (error: unknown) {
          if (error instanceof SyntaxError) { cursor = match + marker.length; continue }
          throw error
        }
      }
      cursor = match + marker.length
    }
  }
  throw new Error(`SkillsMP taxonomy page is missing ${type} rows.`)
}

/** Read a locale message map from decoded Next Flight payloads. */
function readStringMap(payloads: readonly string[], key: string): Readonly<Record<string, string>> {
  const marker = `"${key}":`
  for (const payload of payloads) {
    let cursor = 0
    while (cursor < payload.length) {
      const match = payload.indexOf(marker, cursor)
      if (match < 0) break
      let start = match + marker.length
      while (/\s/u.test(payload[start] ?? '')) start += 1
      if (payload[start] === '{') {
        try {
          const value = record(JSON.parse(payload.slice(start, jsonContainerEnd(payload, start))))
          if (value !== undefined && Object.keys(value).length > 0) {
            const result: Record<string, string> = {}
            let valid = true
            for (const [name, item] of Object.entries(value)) {
              if (typeof item !== 'string' || item.length === 0) { valid = false; break }
              result[name] = item
            }
            if (valid) return result
          }
        } catch (error: unknown) { if (!(error instanceof SyntaxError)) throw error }
      }
      cursor = match + marker.length
    }
  }
  throw new Error(`SkillsMP taxonomy messages are missing ${key}.`)
}

/** Parse category and occupation links from the locale's public occupation page. */
function parseOccupationAnchors(html: string, locale: SkillsMpLocale): ReadonlyMap<string, LocalizedOccupationName> {
  const anchors = new Map<string, LocalizedOccupationName>()
  const visit = (node: DefaultTreeAdapterMap['node']): void => {
    if ('tagName' in node && node.tagName === 'a') {
      const href = node.attrs.find(attribute => attribute.name === 'href')?.value
      if (href !== undefined) {
        const url = new URL(href, SEARCH_ORIGIN)
        const parts = url.pathname.split('/').filter(Boolean)
        if (url.origin === SEARCH_ORIGIN && parts.length === 3 && parts[0] === locale && parts[1] === 'occupations') {
          const slug = decodeURIComponent(parts[2] ?? '')
          const names: string[] = []
          let code: string | undefined
          const collectText = (child: DefaultTreeAdapterMap['node']): void => {
            if (child.nodeName === '#text' && 'value' in child) {
              const value = child.value.trim().replace(/\s+/gu, ' ')
              const match = /\b(\d{2}-\d{4})\b/u.exec(value)
              if (match?.[1] !== undefined) code = match[1]
              else if (value !== '' && !/skills?$/iu.test(value)) names.push(value)
            } else if ('childNodes' in child) {
              for (const nested of child.childNodes) collectText(nested)
            }
          }
          collectText(node)
          const name = names[0]
          if (name !== undefined) {
            const previous = anchors.get(slug)
            if (previous !== undefined && (previous.name !== name || previous.code !== code)) {
              throw new Error(`SkillsMP occupation page has conflicting labels for ${slug}.`)
            }
            anchors.set(slug, { name, ...(code === undefined ? {} : { code }) })
          }
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child)
    if ('content' in node) for (const child of node.content.childNodes) visit(child)
  }
  visit(parse(html))
  if (anchors.size === 0) throw new Error('SkillsMP occupation page has no localized occupation links.')
  return anchors
}

/** Validate localized labels and hierarchy rows from the leaf-group endpoint. */
function parseLeafGroups(value: unknown): ReadonlyMap<string, SkillsMpLeaf> {
  const root = record(value)
  if (!Array.isArray(root?.groups) || root.groups.length === 0) throw new Error('SkillsMP returned an invalid occupation leaf-group response.')
  const leaves = new Map<string, SkillsMpLeaf>()
  for (const rawGroup of root.groups) {
    const group = record(rawGroup)
    const parentSlug = text(group?.parentSlug, 'leaf-group parent slug', 256)
    if (!Array.isArray(group?.items)) throw new Error(`SkillsMP leaf group ${parentSlug} has no item list.`)
    for (const rawItem of group.items) {
      const item = record(rawItem)
      const slug = text(item?.slug, 'leaf occupation slug', 256)
      const label = text(item?.label, 'leaf occupation label', 256)
      const skillCount = integerValue(item?.skillCount, `skillCount for ${slug}`)
      if (leaves.has(slug)) throw new Error(`SkillsMP returned duplicate leaf occupation ${slug}.`)
      leaves.set(slug, { slug, parentSlug, label, skillCount })
    }
  }
  if (leaves.size === 0) throw new Error('SkillsMP returned an empty occupation leaf taxonomy.')
  return leaves
}

/** Merge the localized category roots and validated occupation levels. */
function buildTaxonomyCategories(docs: SkillsMpDocsTaxonomy): SkillsMpTaxonomyCategory[] {
  const result = new Map<string, SkillsMpTaxonomyCategory>()
  for (const [slug, name] of Object.entries(docs.domainNames)) result.set(slug, { slug, name })
  for (const raw of docs.categories) {
    const slug = text(raw.slug, 'category slug', 128)
    const domain = text(raw.domain, 'category domain', 128)
    const name = docs.categoryNames[slug]
    const group = docs.domainNames[domain]
    if (name === undefined || group === undefined) throw new Error(`SkillsMP category ${slug} has no localized name or domain.`)
    if (result.has(slug)) throw new Error(`SkillsMP returned duplicate category ${slug}.`)
    result.set(slug, { slug, name, group })
  }
  return [...result.values()]
}

/** Build source-complete occupation rows and preserve source-provided optional metadata. */
function buildTaxonomyOccupations(
  docs: SkillsMpDocsTaxonomy,
  anchors: ReadonlyMap<string, LocalizedOccupationName>,
  leaves: ReadonlyMap<string, SkillsMpLeaf>,
): SkillsMpTaxonomyOccupation[] {
  const rows = docs.occupations.map(parseOccupationRow)
  const bySlug = new Map(rows.map(row => [row.slug, row]))
  if (bySlug.size !== rows.length) throw new Error('SkillsMP returned duplicate occupation slugs.')
  for (const row of rows) {
    if (row.level === 1) {
      if (row.parentId !== undefined) throw new Error(`SkillsMP level-1 occupation ${row.slug} has a parent.`)
    } else {
      const parent = row.parentId === undefined ? undefined : bySlug.get(row.parentId)
      if (parent === undefined || parent.level !== row.level - 1) throw new Error(`SkillsMP occupation ${row.slug} has an invalid parent.`)
    }
  }
  const leafRows = rows.filter(row => row.level === 4)
  if (leafRows.length !== leaves.size) throw new Error('SkillsMP leaf-group response is incomplete.')
  for (const row of leafRows) {
    const leaf = leaves.get(row.slug)
    const parent = row.parentId === undefined ? undefined : bySlug.get(row.parentId)
    if (leaf === undefined || parent?.parentId !== leaf.parentSlug) {
      throw new Error(`SkillsMP leaf group is missing or misparented for ${row.slug}.`)
    }
  }
  const levelThreeNameCount = new Map<string, number>()
  for (const row of rows) if (row.level === 3) levelThreeNameCount.set(row.englishName, (levelThreeNameCount.get(row.englishName) ?? 0) + 1)
  const localized = new Map<string, string>()
  for (const row of rows) {
    const pageName = anchors.get(row.slug)?.name
    const leafName = row.level === 4 ? leaves.get(row.slug)?.label : undefined
    const messageName = row.level === 1 ? docs.l1Names[row.slug] : undefined
    const candidate = leafName ?? messageName ?? pageName
    if (candidate !== undefined) localized.set(row.slug, candidate)
  }
  for (const row of rows) {
    if (row.level !== 3 || localized.has(row.slug) || levelThreeNameCount.get(row.englishName) !== 1) continue
    const sameNamedLeaves = leafRows
      .filter(leaf => leaf.parentId === row.slug && leaf.englishName === row.englishName)
      .map(leaf => leaves.get(leaf.slug)?.label)
    const names = new Set(sameNamedLeaves.filter((name): name is string => name !== undefined))
    if (sameNamedLeaves.length > 0 && sameNamedLeaves.every(name => name !== undefined) && names.size === 1) {
      const unanimousName = [...names][0]
      if (unanimousName !== undefined) localized.set(row.slug, unanimousName)
    }
  }
  return rows.map((row) => {
    const name = localized.get(row.slug) ?? row.englishName
    const anchorCode = anchors.get(row.slug)?.code
    const leaf = leaves.get(row.slug)
    return {
      slug: row.slug,
      name,
      level: row.level,
      ...(row.parentId === undefined ? {} : { parentId: row.parentId }),
      ...(anchorCode === undefined ? {} : { code: anchorCode }),
      ...(leaf === undefined ? {} : { skillCount: leaf.skillCount }),
    }
  })
}

interface ParsedOccupationRow {
  readonly slug: string
  readonly englishName: string
  readonly parentId?: string
  readonly level: 1 | 2 | 3 | 4
}

function parseOccupationRow(value: Record<string, unknown>): ParsedOccupationRow {
  const slug = text(value.slug, 'occupation slug', 256)
  const englishName = text(value.name ?? value.nameEnglish, `English name for ${slug}`, 256)
  const level = parseOccupationLevel(value.level, slug)
  const rawParent = value.parentId
  if (rawParent !== null && rawParent !== undefined && typeof rawParent !== 'string') throw new Error(`SkillsMP occupation ${slug} has an invalid parentId.`)
  return {
    slug,
    englishName,
    level,
    ...(typeof rawParent === 'string' ? { parentId: text(rawParent, `parentId for ${slug}`, 256) } : {}),
  }
}

function parseOccupationLevel(value: unknown, slug: string): ParsedOccupationRow['level'] {
  const level = integerValue(value, `level for ${slug}`)
  if (level === 1 || level === 2 || level === 3 || level === 4) return level
  throw new Error(`SkillsMP occupation ${slug} has an invalid level.`)
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0 }

interface GithubContentsTarget {
  readonly owner: string
  readonly repo: string
  readonly branch: string
  readonly path: string
}
interface GithubContentsAuthorization {
  readonly target: GithubContentsTarget
  readonly token: string
}
interface ManifestFile {
  readonly path: string
  readonly size: number
  readonly rawUrl: string
}
interface ReviewedFile {
  readonly path: string
  readonly size: number
  readonly sha: string
  readonly rawUrl: string
}
interface ReviewedSkill extends SkillsMpDetail {
  readonly reviewedFiles: readonly ReviewedFile[]
  readonly target: GithubContentsTarget
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error(`SkillsMP returned an invalid ${field}.`)
  return value
}
function optionalText(value: unknown, max: number): string { return value === undefined || value === null || value === '' ? '' : text(value, 'text field', max) }
function integer(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('SkillsMP pagination value is invalid.')
  return value
}
function integerValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`SkillsMP returned an invalid ${field}.`)
  return value
}
function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`SkillsMP returned an invalid ${field}.`)
  return value
}
function bounded(value: string | undefined, max: number): string {
  const result = value?.trim() ?? ''
  if (result.length > max) throw new Error(`SkillsMP query field exceeds ${max} characters.`)
  return result
}
function skillsMpSkill(value: unknown): SkillsMpSkill {
  const raw = record(value)
  if (raw === undefined) throw new Error('SkillsMP returned an invalid skill record.')
  const githubUrl = normalizeGitHubUrl(text(raw.githubUrl, 'GitHub URL', 2048))
  const url = new URL(text(raw.skillUrl, 'SkillsMP URL', 2048))
  if (url.protocol !== 'https:' || url.origin !== SEARCH_ORIGIN || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || !url.pathname.startsWith('/creators/')) {
    throw new Error('SkillsMP returned an invalid skill URL.')
  }
  return {
    id: safeSkillId(text(raw.id, 'skill id', 256)), name: text(raw.name, 'skill name', 160), author: text(raw.author, 'author', 160),
    description: optionalText(raw.description, 4000), contentLanguage: text(raw.contentLanguage, 'content language', 8),
    githubUrl, url: url.toString(), stars: integerValue(raw.stars, 'stars'), updatedAt: integerValue(raw.updatedAt, 'updatedAt'),
  }
}
function safeLimit(value: number | undefined, fallback: number, field: string): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1) throw new Error(`SkillsMP ${field} must be a positive safe integer.`)
  return selected
}
function safeSha(value: string): string {
  if (!SHA.test(value)) throw new Error('Commit and Git blob SHA values must be 40 hexadecimal characters.')
  return value.toLowerCase()
}
function reviewKey(githubUrl: string, commitSha: string): string { return `${githubUrl}\n${commitSha.toLowerCase()}` }
function gitBlobSha(bytes: Uint8Array): string {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8')
  return createHash('sha1').update(header).update(bytes).digest('hex')
}
function safeRelativePath(path: string): string[] {
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.includes(':')) throw new Error(`GitHub returned an unsafe file path: ${path}`)
  const parts = path.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) throw new Error(`GitHub returned an unsafe file path: ${path}`)
  return parts
}
function safeSkillId(id: string): string {
  if (id.length === 0 || id.length > 255 || id.startsWith('.') || id === '..' || /[/\\\0:]/u.test(id)) throw new Error('SkillsMP skill id is invalid for installation.')
  return id
}
function normalizeGitHubUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch (error: unknown) { throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP returned an invalid GitHub URL.', {}, { cause: error }) }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port !== '' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP GitHub URL must use the public github.com HTTPS origin.', {})
  }
  let parts: string[]
  try { parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part)) }
  catch (error: unknown) { throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP GitHub URL contains invalid path encoding.', {}, { cause: error }) }
  if (parts.length < 2 || parts[2] === 'blob' || parts.length === 3 && parts[2] !== 'tree') {
    throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP GitHub URL must identify a repository or tree directory.', {})
  }
  const owner = parts[0]
  const repo = parts[1]
  if (owner === undefined || repo === undefined) {
    throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP GitHub repository identity is invalid.', {})
  }
  if (!/^[A-Za-z0-9_.-]{1,100}$/u.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/u.test(repo)) {
    throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP GitHub repository identity is invalid.', {})
  }
  if (parts.some(part => part === '.' || part === '..' || part.includes('/') || part.includes('\\') || part.includes('\0'))) throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP GitHub URL contains an unsafe path.', {})
  return `https://github.com/${parts.map(encodeURIComponent).join('/')}`
}
function parseGitHubSkillUrl(value: string): { readonly owner: string; readonly repo: string; readonly tail: readonly string[] } {
  const normalized = normalizeGitHubUrl(value)
  const parts = new URL(normalized).pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const owner = parts[0]
  const repo = parts[1]
  if (owner === undefined || repo === undefined) {
    throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP GitHub repository identity is invalid.', {})
  }
  if (parts.length === 2) return { owner, repo, tail: [] }
  if (parts[2] !== 'tree' || parts.length < 4) throw new Error('GitHub skill URL must point to a repository root or tree directory.')
  return { owner, repo, tail: parts.slice(3) }
}
function parseGithubContentsTarget(value: unknown): GithubContentsTarget {
  const raw = record(value)
  if (raw === undefined) throw new Error('SkillsMP returned an invalid GitHub download target.')
  const owner = text(raw.owner, 'GitHub owner', 100)
  const repo = text(raw.repo, 'GitHub repository', 100)
  const branch = text(raw.branch, 'GitHub branch', 512)
  const path = raw.path === '' ? '' : text(raw.path, 'GitHub skill path', 2048)
  if (!/^[A-Za-z0-9_.-]{1,100}$/u.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/u.test(repo)) {
    throw new Error('SkillsMP returned an invalid GitHub download target identity.')
  }
  validateSlashPath(branch, 'GitHub branch')
  if (path !== '') validateSlashPath(path, 'GitHub skill path')
  return { owner, repo, branch, path }
}

function validateTargetForSource(
  source: { readonly owner: string; readonly repo: string; readonly tail: readonly string[] },
  target: GithubContentsTarget,
): void {
  if (target.owner !== source.owner || target.repo !== source.repo) throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP target does not match the searched GitHub repository.', {})
  if (source.tail.length === 0) {
    if (target.path !== '') throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP target does not match the repository root URL.', {})
    return
  }
  const targetPath = [...target.branch.split('/'), ...(target.path === '' ? [] : target.path.split('/'))]
  if (targetPath.length !== source.tail.length || targetPath.some((part, index) => part !== source.tail[index])) {
    throw new RemoteError('skillsmp/github-source-invalid', 'SkillsMP target does not match the searched GitHub tree URL.', {})
  }
}

function validateSlashPath(value: string, field: string): void {
  const parts = value.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..' || part.includes('\\') || part.includes('\0') || part.includes(':'))) {
    throw new Error(`SkillsMP returned an unsafe ${field}.`)
  }
}

function parseDownloadManifest(
  value: unknown,
  target: GithubContentsTarget,
  maxFiles: number,
  maxFileBytes: number,
  maxTotalBytes: number,
): { readonly commitSha: string; readonly files: readonly ManifestFile[] } {
  const raw = record(value)
  if (raw === undefined) throw new Error('SkillsMP returned an invalid source manifest.')
  const commitSha = safeSha(text(raw.commitSha, 'manifest commit SHA', 40))
  const skippedFiles = integerValue(raw.skippedFiles, 'manifest skippedFiles')
  const limitReason = raw.limitReason
  if (limitReason !== null && limitReason !== 'file_count' && limitReason !== 'file_size' && limitReason !== 'total_size') {
    throw new Error('SkillsMP returned an invalid manifest limit reason.')
  }
  if (typeof raw.truncated !== 'boolean') throw new Error('SkillsMP returned an invalid manifest truncation flag.')
  if (limitReason !== null || skippedFiles !== 0 || raw.truncated) {
    throw new RemoteError('skillsmp/manifest-incomplete', 'SkillsMP could not provide a complete skill file manifest.', {
      skippedFiles,
      ...(limitReason === null ? {} : { limitReason }),
    })
  }
  if (!Array.isArray(raw.files)) throw new Error('SkillsMP returned an invalid manifest file list.')
  if (raw.files.length > Math.min(100, maxFiles)) {
    throw new RemoteError('skillsmp/manifest-incomplete', 'SkillsMP manifest exceeds the supported file count.', { skippedFiles: 0, limitReason: 'file_count' })
  }
  const files: ManifestFile[] = []
  const paths = new Set<string>()
  let totalBytes = 0
  for (const entry of raw.files) {
    const file = record(entry)
    if (file === undefined) throw new Error('SkillsMP returned an invalid manifest file entry.')
    const path = text(file.path, 'manifest file path', 2048)
    const segments = safeRelativePath(path)
    const key = path.normalize('NFC').toLocaleLowerCase('en-US')
    if (paths.has(key)) throw new Error('SkillsMP manifest contains duplicate file paths.')
    paths.add(key)
    const size = integerValue(file.size, `size for ${path}`)
    if (size > Math.min(512_000, maxFileBytes)) {
      throw new RemoteError('skillsmp/manifest-incomplete', 'SkillsMP manifest exceeds the supported file size.', { skippedFiles: 0, limitReason: 'file_size' })
    }
    totalBytes += size
    if (totalBytes > Math.min(5 * 1024 * 1024, maxTotalBytes)) {
      throw new RemoteError('skillsmp/manifest-incomplete', 'SkillsMP manifest exceeds the supported total size.', { skippedFiles: 0, limitReason: 'total_size' })
    }
    const rawUrl = text(file.rawUrl, 'manifest raw URL', 4096)
    const canonicalUrl = canonicalRawUrl(target.owner, target.repo, commitSha, [...(target.path === '' ? [] : target.path.split('/')), ...segments])
    if (rawUrl !== canonicalUrl) throw new Error(`SkillsMP manifest raw URL does not match ${path}.`)
    files.push({ path, size, rawUrl })
  }
  if (!files.some(file => file.path === 'SKILL.md')) {
    throw new RemoteError('skillsmp/skill-markdown-missing', 'GitHub skill directory must contain a root SKILL.md file.', {})
  }
  return { commitSha, files }
}

function canonicalRawUrl(owner: string, repo: string, commitSha: string, path: readonly string[]): string {
  return `https://${new URL(GITHUB_RAW_ORIGIN).host}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commitSha}/${path.map(encodeURIComponent).join('/')}`
}
function isMissingPath(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' }
function isAlreadyExists(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST' }
function incompatibleSkill(cause?: unknown): RemoteError<'skillsmp/skill-incompatible'> {
  return new RemoteError(
    'skillsmp/skill-incompatible',
    'GitHub content is not a skill accepted by the official filesystem provider.',
    {},
    cause === undefined ? undefined : { cause },
  )
}
function skillsMpStatusError(status: 403 | 429): Error {
  if (status === 403) return new RemoteError('skillsmp/forbidden', 'SkillsMP rejected the search request.', { status: 403 })
  return new RemoteError('skillsmp/rate-limited', 'SkillsMP search quota is exhausted.', { status: 429 })
}
function throwSourceStatus(status: number): void {
  if (status === 429) throw new RemoteError('skillsmp/rate-limited', 'SkillsMP source download quota is exhausted.', { status: 429 })
  if (status === 503) throw new RemoteError('skillsmp/source-unavailable', 'SkillsMP source manifest is temporarily unavailable.', { status: 503 })
}
function isSkillDirectoryId(id: string): boolean { return id.length > 0 && id.length <= 255 && !id.startsWith('.') && id !== '..' && !id.includes('/') && !id.includes('\\') && !id.includes('\0') }
function displaySkillDirectory(id: string): string { try { return decodeURIComponent(id) } catch { return id } }

function isPublicAddress(address: string, family: number): boolean {
  if (isIP(address) !== family) return false
  try { return ipaddr.parse(address).range() === 'unicast' } catch { return false }
}
function isTunBenchmarkAddress(address: string, family: number): boolean {
  if (family !== 4 || isIP(address) !== 4) return false
  try { return ipaddr.parse(address).match(TUN_BENCHMARK_RANGE) } catch { return false }
}
async function resolvePublic(url: URL, signal: AbortSignal): Promise<LookupAddress[]> {
  if (!ALLOWED_ORIGINS.has(url.origin)) throw new Error('SkillsMP request origin is not allowed.')
  const family = isIP(url.hostname)
  let records: LookupAddress[]
  if (family !== 0) records = [{ address: url.hostname, family }]
  else {
    signal.throwIfAborted()
    records = await new Promise<LookupAddress[]>((resolvePromise, reject) => {
      const onAbort = (): void => {
        reject(signal.reason instanceof Error ? signal.reason : new Error('SkillsMP request was aborted.'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void dnsLookup(url.hostname, { all: true, order: 'verbatim' })
        .then(resolvePromise, reject)
        .finally(() => { signal.removeEventListener('abort', onAbort) })
    })
  }
  const allowed = ALLOWED_ORIGINS.has(url.origin)
  if (records.length === 0 || records.some(record => !isPublicAddress(record.address, record.family)
    && !(allowed && isTunBenchmarkAddress(record.address, record.family)))) {
    throw new Error(`SkillsMP URL host ${url.hostname} did not resolve exclusively to public addresses.`)
  }
  return records
}
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
function pinnedLookup(addresses: readonly LookupAddress[]): (hostname: string, options: LookupOptions, callback: LookupCallback) => void {
  return (hostname, options, callback): void => {
    const rows = options.family === 4 || options.family === 6 ? addresses.filter(row => row.family === options.family) : addresses
    if (rows.length === 0) {
      callback(new Error(`No pinned address for ${hostname}`), '', 0)
      return
    }
    if (options.all) {
      callback(null, [...rows])
      return
    }
    const row = rows[0]
    if (row === undefined) {
      callback(new Error(`No pinned address for ${hostname}`), '', 0)
      return
    }
    callback(null, row.address, row.family)
  }
}
type UndiciResponse = Awaited<ReturnType<typeof fetch>>
interface ResponseHandle {
  readonly status: number
  readonly headers: UndiciResponse['headers']
  readonly body: UndiciResponse['body']
  close(): Promise<void>
}
async function requestPublic(
  url: URL,
  timeoutMs: number,
  parentSignal: AbortSignal,
  headers: Record<string, string> | undefined,
  request: { readonly method?: 'GET' | 'POST'; readonly body?: string } = {},
): Promise<ResponseHandle> {
  if (!ALLOWED_ORIGINS.has(url.origin)) throw new Error('SkillsMP request origin is not allowed.')
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error('SkillsMP requests require credential-free HTTPS URLs.')
  parentSignal.throwIfAborted()
  const controller = new AbortController()
  const abort = (): void => {
    controller.abort(parentSignal.reason)
  }
  parentSignal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    controller.abort(new Error('SkillsMP request timed out.'))
  }, timeoutMs)
  const current = url
  let activeAgent: Agent | undefined
  try {
    const route = proxyRouteFor(current)
    const proxied = route.proxied && isIP(current.hostname) === 0
    if (!proxied) activeAgent = new Agent({ connect: { lookup: pinnedLookup(await resolvePublic(current, controller.signal)) } })
    const dispatcher = proxied ? route.dispatcher : activeAgent
    if (dispatcher === undefined) throw new Error('SkillsMP request has no network dispatcher.')
    let response: UndiciResponse
    try {
      response = await fetch(current, {
        dispatcher,
        redirect: 'manual',
        signal: controller.signal,
        method: request.method ?? 'GET',
        ...(request.body === undefined ? {} : { body: request.body }),
        headers: { accept: 'application/json, application/octet-stream', ...(headers ?? {}) },
      })
    }
    catch (error: unknown) { throw new Error('SkillsMP or GitHub request failed.', { cause: error }) }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel()
      throw new Error('SkillsMP and GitHub redirects are not allowed.')
    }
    const agent = activeAgent
    activeAgent = undefined
    return { status: response.status, headers: response.headers, body: response.body, close: async () => { clearTimeout(timer); parentSignal.removeEventListener('abort', abort); await response.body?.cancel().catch(() => undefined); await agent?.close() } }
  } catch (error: unknown) {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', abort)
    await activeAgent?.close()
    throw error
  }
}
async function readBounded(response: ResponseHandle, limit: number): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(length) && length > limit) throw new Error(`SkillsMP response exceeds ${limit} bytes.`)
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('SkillsMP returned no response body.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      const value: unknown = result.value
      if (!(value instanceof Uint8Array)) throw new Error('SkillsMP returned a non-byte response chunk.')
      size += value.byteLength
      if (size > limit) { await reader.cancel(); throw new Error(`SkillsMP response exceeds ${limit} bytes.`) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}

async function ensureSkillRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Configured skill root must be a regular directory.')
  return root
}
async function ensureControlRoot(root: string): Promise<string> {
  const control = join(root, '.skillsmp')
  try {
    const stat = await lstat(control)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('SkillsMP transaction root must be a regular directory.')
  } catch (error: unknown) {
    if (!isMissingPath(error)) throw error
    try { await mkdir(control, { mode: 0o700 }) }
    catch (mkdirError: unknown) { if (!isAlreadyExists(mkdirError)) throw mkdirError }
    const stat = await lstat(control)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('SkillsMP transaction root must be a regular directory.')
  }
  return control
}
async function commitSkillDirectory(
  root: string,
  control: string,
  target: string,
  stage: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  signal?.throwIfAborted()
  const relativeTarget = relative(root, target)
  if (relativeTarget === '' || relativeTarget.startsWith(`..${sep}`) || relativeTarget === '..' || relativeTarget.includes('\0')) throw new Error('Skill install target escaped the configured root.')
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  let targetStat: Awaited<ReturnType<typeof lstat>> | undefined
  try { targetStat = await lstat(target) }
  catch (error: unknown) { if (!isMissingPath(error)) throw error }
  if (targetStat !== undefined && (!targetStat.isDirectory() || targetStat.isSymbolicLink())) throw new Error('Existing skill install target must be a regular directory.')
  const backup = targetStat === undefined ? undefined : join(control, `backup-${randomUUID()}`)
  if (backup !== undefined) await rename(target, backup)
  try { signal?.throwIfAborted(); await rename(stage, target) }
  catch (error: unknown) {
    if (backup !== undefined) await rename(backup, target).catch((restoreError: unknown) => { throw new AggregateError([error, restoreError], 'Skill install failed and its previous directory could not be restored.') })
    throw error
  }
  if (backup === undefined) return undefined
  try { await rm(backup, { recursive: true }); return undefined }
  catch { return backup }
}
