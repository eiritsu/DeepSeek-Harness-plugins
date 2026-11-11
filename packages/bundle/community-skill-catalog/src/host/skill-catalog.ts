/** Bounded dual-source (GitHub index + skills.sh) skill search and pinned commit installer. */

import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type {
  InstalledSkill,
  SkillCatalogDetail,
  SkillCatalogItem,
  SkillCatalogPage,
  SkillCatalogSort,
  SkillCatalogSourceFilter,
  SkillCatalogTaxonomy,
  SkillInstallResult,
  SkillSourceWarning,
} from '../types.ts'
import {
  buildManifestFromTree,
  extractSkillFrontmatter,
  fetchCommitSha,
  fetchContentsManifest,
  fetchGitTree,
  fetchGithubSkillIndex,
  fetchRawFileBytes,
  gitBlobSha,
  parseRepoSlug,
  queryGithubIndex,
  resolveSkillDirectoryInTree,
  safeRelativePath,
  safeSha,
  type CachedGitTree,
  type CachedGithubIndex,
  type GithubContentsTarget,
  type GithubRequestContext,
  type ManifestFile,
} from './github-source.ts'
import { openRawBatchDispatcher } from './network.ts'
import { fetchSkillsShSearch, mergeAndRankDualSources, type SkillsShEntry } from './skills-sh-source.ts'

const DEFAULT_INDEX_REPO = 'sickn33/agentic-awesome-skills'
const DEFAULT_INDEX_REF = 'main'
const DEFAULT_INDEX_PATH = 'skills_index.json'
const DEFAULT_SKILLS_SH_SEED_QUERY = 'code'
const MAX_PAGE_SIZE = 50
const SOURCES = new Set<SkillCatalogSourceFilter>(['all', 'github-index', 'skills-sh'])
const SORTS = new Set<SkillCatalogSort>(['popular', 'installs', 'recent'])

/** Configurable source locations and resource limits for the skill catalog service. */
export interface Config {
  /** Curated GitHub index repository in `owner/repo` form. */
  indexRepo?: string
  /** Branch or commit reference used when loading `skills_index.json`. */
  indexRef?: string
  /** Path to the JSON skill index inside `indexRepo`. */
  indexPath?: string
  /** Optional credential reference holding a GitHub token sent only to `api.github.com`. */
  githubCredentialKey?: string
  /** Per-request HTTP timeout in milliseconds. */
  timeoutMs?: number
  /** Overall deadline for detail resolution or installation in milliseconds. */
  operationTimeoutMs?: number
  /** Maximum JSON and `SKILL.md` preview response size in bytes. */
  maxResponseBytes?: number
  /** Maximum byte size permitted for `skills_index.json` or git tree responses. */
  maxIndexBytes?: number
  /** Maximum size of one installed GitHub file in bytes. */
  maxFileBytes?: number
  /** Maximum number of files permitted in a single skill manifest. */
  maxFiles?: number
  /** Maximum aggregate byte size of a single skill manifest. */
  maxTotalBytes?: number
  /** Search and commit resolution cache lifetime in milliseconds. */
  cacheTtlMs?: number
  /** Maximum distinct search pages, known skills, and reviewed manifests held in LRU caches. */
  maxCacheEntries?: number
  /** Curated GitHub index and category cache lifetime in milliseconds. */
  metadataCacheTtlMs?: number
  /** Destination root scanned by `@deepseek-ai/dsh-skill-filesystem`. */
  skillRoot?: string
}

/** Validated runtime specification resolved from optional `Config` inputs. */
export interface ResolvedCatalogSpec {
  readonly indexRepo: string
  readonly indexRef: string
  readonly indexPath: string
  readonly githubCredentialKey: string | undefined
  readonly timeoutMs: number
  readonly operationTimeoutMs: number
  readonly maxResponseBytes: number
  readonly maxIndexBytes: number
  readonly maxFileBytes: number
  readonly maxFiles: number
  readonly maxTotalBytes: number
  readonly cacheTtlMs: number
  readonly maxCacheEntries: number
  readonly metadataCacheTtlMs: number
  readonly skillRoot: string
}

interface ReviewedFile {
  readonly path: string
  readonly size: number
  readonly sha?: string
  readonly rawUrl: string
}

interface ReviewedSkill extends SkillCatalogDetail {
  readonly reviewedFiles: readonly ReviewedFile[]
}

export type * from '../types.ts'

/** Normalize optional plugin config into concrete bounded catalog settings.
 * @param config Partial user configuration supplied via Cordis.
 * @returns Fully resolved runtime specification.
 */
export function resolveCatalogSpec(config: Config): ResolvedCatalogSpec {
  const indexRepo = (config.indexRepo ?? DEFAULT_INDEX_REPO).trim()
  parseRepoSlug(indexRepo)
  const indexRef = safeRelativePath(config.indexRef ?? DEFAULT_INDEX_REF).join('/')
  const indexPath = safeRelativePath(config.indexPath ?? DEFAULT_INDEX_PATH).join('/')
  const credentialKey = config.githubCredentialKey?.trim()
  return {
    indexRepo,
    indexRef,
    indexPath,
    githubCredentialKey: credentialKey === undefined || credentialKey === '' ? undefined : credentialKey,
    timeoutMs: safeLimit(config.timeoutMs, 15000, 'timeoutMs'),
    operationTimeoutMs: safeLimit(config.operationTimeoutMs, 120000, 'operationTimeoutMs'),
    maxResponseBytes: safeLimit(config.maxResponseBytes, 1024 * 1024, 'maxResponseBytes'),
    maxIndexBytes: safeLimit(config.maxIndexBytes, 8 * 1024 * 1024, 'maxIndexBytes'),
    maxFileBytes: safeLimit(config.maxFileBytes, 512_000, 'maxFileBytes'),
    maxFiles: safeLimit(config.maxFiles, 100, 'maxFiles'),
    maxTotalBytes: safeLimit(config.maxTotalBytes, 5 * 1024 * 1024, 'maxTotalBytes'),
    cacheTtlMs: safeLimit(config.cacheTtlMs, 5 * 60 * 1000, 'cacheTtlMs'),
    maxCacheEntries: safeLimit(config.maxCacheEntries, 100, 'maxCacheEntries'),
    metadataCacheTtlMs: safeLimit(config.metadataCacheTtlMs, 60 * 60 * 1000, 'metadataCacheTtlMs'),
    skillRoot: resolve(config.skillRoot ?? join(resolveDshHome(), 'skills')),
  }
}

/** Host-side dual-source skill catalog exposed through Typert RPC. */
export class SkillCatalog extends TypertRemoteService {
  static inject = ['credentials']
  static Config = z.object({
    indexRepo: z.string().default(DEFAULT_INDEX_REPO),
    indexRef: z.string().default(DEFAULT_INDEX_REF),
    indexPath: z.string().default(DEFAULT_INDEX_PATH),
    githubCredentialKey: z.string().role('credential-ref').default(''),
    timeoutMs: z.number().step(1).min(1000).max(60000).default(15000),
    operationTimeoutMs: z.number().step(1).min(1000).max(2147483647).default(120000),
    maxResponseBytes: z.number().step(1).min(1024).max(2 * 1024 * 1024).default(1024 * 1024),
    maxIndexBytes: z.number().step(1).min(64 * 1024).max(16 * 1024 * 1024).default(8 * 1024 * 1024),
    maxFileBytes: z.number().step(1).min(1).max(512_000).default(512_000),
    maxFiles: z.number().step(1).min(1).max(100).default(100),
    maxTotalBytes: z.number().step(1).min(1).max(5 * 1024 * 1024).default(5 * 1024 * 1024),
    cacheTtlMs: z.number().step(1).min(1000).max(60 * 60 * 1000).default(5 * 60 * 1000),
    maxCacheEntries: z.number().step(1).min(1).max(1000).default(100),
    metadataCacheTtlMs: z.number().step(1).min(1000).max(24 * 60 * 60 * 1000).default(60 * 60 * 1000),
    skillRoot: z.string().default(join(resolveDshHome(), 'skills')),
  })

  private readonly spec: ResolvedCatalogSpec
  private readonly serviceAbort = new AbortController()
  private indexCache: { readonly expires: number; readonly value: CachedGithubIndex } | undefined
  private indexInflight: Promise<CachedGithubIndex> | undefined
  private readonly indexTargets = new Map<string, GithubContentsTarget>()
  private readonly searches = new Map<string, { readonly expires: number; readonly page: SkillCatalogPage }>()
  private readonly knownSkills = new Map<string, SkillCatalogItem>()
  private readonly commits = new Map<string, { readonly expires: number; readonly sha: string }>()
  private readonly trees = new Map<string, { readonly expires: number; readonly tree: CachedGitTree }>()
  private readonly reviewed = new Map<string, ReviewedSkill>()
  private readonly installing = new Set<string>()
  private readonly removing = new Set<string>()
  private readonly activeInstalls = new Set<Promise<unknown>>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'skillCatalog')
    this.spec = resolveCatalogSpec(config)
    ctx.effect(() => async () => {
      this.serviceAbort.abort(new Error('Community skill catalog service was disposed.'))
      await Promise.allSettled([...this.activeInstalls])
      this.indexCache = undefined
      this.indexTargets.clear()
      this.searches.clear()
      this.knownSkills.clear()
      this.commits.clear()
      this.trees.clear()
      this.reviewed.clear()
    }, 'skill-catalog: drain active installs')
  }

  /** Return live category counts and metadata from the curated GitHub skill index.
   * @param forceRefresh Bypass cached index and search pages when true.
   * @param signal Optional cancellation signal.
   * @returns Categories ordered by descending skill count and total index size.
   */
  @Remote
  async taxonomy(forceRefresh?: boolean, signal?: AbortSignal): Promise<SkillCatalogTaxonomy> {
    signal = this.callSignal(signal)
    if (forceRefresh) {
      this.indexCache = undefined
      this.searches.clear()
    }
    const index = await this.loadGithubIndex(signal)
    return {
      categories: index.categories,
      totalIndexed: index.items.length,
      indexRepo: index.indexRepo,
      fetchedAt: index.fetchedAt,
    }
  }

  /** Query skills across the curated GitHub index, `skills.sh`, or both combined.
   * @param query Search query text (can be empty to browse indexed/popular skills).
   * @param source Source filter (`all`, `github-index`, or `skills-sh`).
   * @param category Optional category slug filter from the GitHub index.
   * @param sort Ordering mode (`popular`, `installs`, or `recent`).
   * @param page One-based result page.
   * @param pageSize Requested page size (capped at 50).
   * @param signal Optional cancellation signal.
   * @returns Paginated skills and any degraded-source warnings.
   */
  @Remote
  async catalog(
    query: string,
    source?: SkillCatalogSourceFilter,
    category?: string,
    sort?: SkillCatalogSort,
    page?: number,
    pageSize?: number,
    signal?: AbortSignal,
  ): Promise<SkillCatalogPage> {
    signal = this.callSignal(signal)
    const selectedQuery = boundedQuery(query, 120)
    const selectedSource = source ?? 'all'
    if (!SOURCES.has(selectedSource)) throw new Error('Unsupported skill catalog source filter.')
    const selectedCategory = boundedQuery(category, 80)
    const selectedSort = sort ?? 'popular'
    if (!SORTS.has(selectedSort)) throw new Error('Unsupported skill catalog sort key.')
    const selectedPage = boundedInt(page ?? 1, 1, 10000)
    const selectedSize = boundedInt(pageSize ?? 24, 1, MAX_PAGE_SIZE)

    const cacheKey = JSON.stringify([selectedQuery, selectedSource, selectedCategory, selectedSort, selectedPage, selectedSize])
    const cached = this.cachedSearch(cacheKey)
    if (cached !== undefined) return cached

    const needGithubIndex = selectedSource === 'all' || selectedSource === 'github-index'
    const normalizedCategory = selectedCategory === '' || selectedCategory === 'all' ? '' : selectedCategory
    const shouldQuerySkillsSh = selectedSource === 'skills-sh'
      ? (selectedQuery === '' || selectedQuery.length >= 2)
      : selectedSource === 'all' && normalizedCategory === '' && (
        selectedQuery.length >= 2 || (selectedQuery === '' && selectedSort === 'installs')
      )

    const githubPromise = needGithubIndex ? this.loadGithubIndex(signal) : Promise.resolve(undefined)
    const skillsShQuery = selectedQuery === '' ? DEFAULT_SKILLS_SH_SEED_QUERY : selectedQuery
    const skillsShPromise = shouldQuerySkillsSh
      ? fetchSkillsShSearch(skillsShQuery, MAX_PAGE_SIZE, this.spec.timeoutMs, this.spec.maxResponseBytes, signal)
      : Promise.resolve<readonly SkillsShEntry[]>([])

    const [githubOutcome, skillsShOutcome] = await Promise.allSettled([githubPromise, skillsShPromise])
    signal.throwIfAborted()

    const warnings: SkillSourceWarning[] = []
    let indexMatches: readonly ReturnType<typeof queryGithubIndex>[number][] = []
    if (needGithubIndex) {
      if (githubOutcome.status === 'fulfilled' && githubOutcome.value !== undefined) {
        indexMatches = queryGithubIndex(githubOutcome.value.items, selectedQuery, selectedCategory, selectedSort)
      } else if (githubOutcome.status === 'rejected') {
        if (!shouldQuerySkillsSh) throw githubOutcome.reason
        warnings.push(sourceWarning('github-index', githubOutcome.reason))
      }
    }

    let skillsShEntries: readonly SkillsShEntry[] = []
    if (shouldQuerySkillsSh) {
      if (skillsShOutcome.status === 'fulfilled') {
        skillsShEntries = skillsShOutcome.value
      } else {
        if (!needGithubIndex || githubOutcome.status === 'rejected') throw skillsShOutcome.reason
        warnings.push(sourceWarning('skills-sh', skillsShOutcome.reason))
      }
    }

    const merged = selectedSource === 'github-index'
      ? indexMatches.map(match => match.record.item)
      : selectedSource === 'skills-sh'
        ? mergeAndRankDualSources([], skillsShEntries, selectedSort, false)
        : mergeAndRankDualSources(indexMatches, skillsShEntries, selectedSort, normalizedCategory !== '')

    const offset = (selectedPage - 1) * selectedSize
    const slice = merged.slice(offset, offset + selectedSize)
    const total = merged.length
    const result: SkillCatalogPage = {
      items: slice,
      total,
      totalIsExact: true,
      hasNext: offset + slice.length < total,
      page: selectedPage,
      pageSize: selectedSize,
      ...(warnings.length === 0 ? {} : { warnings }),
    }
    this.rememberSearch(cacheKey, result)
    return result
  }

  /** Resolve a searched skill entry to a commit-pinned manifest and `SKILL.md` preview.
   * @param skillId Opaque item identifier returned by `catalog`.
   * @param signal Optional cancellation signal.
   * @returns Exact commit SHA, file inventory, and UTF-8 `SKILL.md` contents.
   */
  @Remote
  async detail(skillId: string, signal?: AbortSignal): Promise<SkillCatalogDetail> {
    signal = this.operationSignal(this.callSignal(signal))
    const skill = this.knownSkill(skillId)
    const requestCtx = this.requestContext()
    let target: GithubContentsTarget
    let commitSha: string
    let files: ManifestFile[]

    const presetTarget = this.indexTargets.get(skill.id)
    if (skill.source === 'github-index' && presetTarget !== undefined) {
      target = presetTarget
      commitSha = await this.cachedCommitSha(target.owner, target.repo, target.branch, requestCtx, signal)
      files = await fetchContentsManifest(target.owner, target.repo, commitSha, target.path, requestCtx, signal)
    } else {
      const repoSlug = parseRepoSlug(skill.repo)
      commitSha = await this.cachedCommitSha(repoSlug.owner, repoSlug.repo, 'HEAD', requestCtx, signal)
      const tree = await this.cachedGitTree(repoSlug.owner, repoSlug.repo, commitSha, requestCtx, signal)
      let dirPath: string
      if (!tree.truncated) {
        dirPath = await resolveSkillDirectoryInTree(repoSlug.owner, repoSlug.repo, commitSha, skill.skillId, tree, requestCtx, signal)
        files = buildManifestFromTree(repoSlug.owner, repoSlug.repo, commitSha, dirPath, tree, requestCtx)
      } else {
        dirPath = await this.resolveTruncatedRepoDir(repoSlug.owner, repoSlug.repo, commitSha, skill.skillId, requestCtx, signal)
        files = await fetchContentsManifest(repoSlug.owner, repoSlug.repo, commitSha, dirPath, requestCtx, signal)
      }
      target = { owner: repoSlug.owner, repo: repoSlug.repo, branch: commitSha, path: dirPath }
    }

    const skillFile = files.find(file => file.path === 'SKILL.md')
    if (skillFile === undefined) {
      throw new RemoteError('skill-catalog/skill-markdown-missing', 'GitHub skill directory must contain a root SKILL.md file.', {})
    }
    if (skillFile.size > this.spec.maxResponseBytes) {
      throw new Error(`SKILL.md preview exceeds maxResponseBytes (${this.spec.maxResponseBytes}).`)
    }
    const skillBytes = await fetchRawFileBytes(
      skillFile.rawUrl,
      skillFile.path,
      skillFile.size,
      this.spec.maxFileBytes,
      this.spec.timeoutMs,
      signal,
      skillFile.sha,
    )
    let skillMarkdown: string
    try {
      skillMarkdown = new TextDecoder('utf-8', { fatal: true }).decode(skillBytes)
    } catch (error: unknown) {
      throw new Error('GitHub returned invalid UTF-8 for SKILL.md.', { cause: error })
    }
    const skillSha = gitBlobSha(skillBytes)
    const frontmatter = extractSkillFrontmatter(skillMarkdown)
    const resolvedGithubUrl = target.path === ''
      ? `https://github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/tree/${commitSha}`
      : `https://github.com/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/tree/${commitSha}/${safeRelativePath(target.path).map(encodeURIComponent).join('/')}`

    const enrichedSkill: SkillCatalogItem = {
      ...skill,
      description: skill.description !== '' ? skill.description : (frontmatter.description ?? ''),
      githubUrl: resolvedGithubUrl,
    }

    let totalBytes = 0
    const reviewedFiles: ReviewedFile[] = []
    for (const file of files) {
      totalBytes += file.size
      const sha = file.sha ?? (file.path === 'SKILL.md' ? skillSha : undefined)
      reviewedFiles.push({ path: file.path, size: file.size, rawUrl: file.rawUrl, ...(sha === undefined ? {} : { sha }) })
    }
    if (totalBytes > Math.min(this.spec.maxTotalBytes, 5 * 1024 * 1024)) {
      throw new Error('Skill manifest exceeds the configured total byte limit.')
    }

    const detail: SkillCatalogDetail = {
      skill: enrichedSkill,
      commitSha,
      resolvedPath: target.path,
      files: reviewedFiles.map(({ path, size, sha }) => ({ path, size, ...(sha === undefined ? {} : { sha }) })),
      totalBytes,
      skillMarkdown,
    }
    this.rememberReview({ ...detail, reviewedFiles })
    return detail
  }

  /** Download, integrity-verify, validate, and commit one reviewed GitHub skill snapshot.
   * @param skillId Opaque item identifier matching the reviewed manifest.
   * @param commitSha Exact 40-character commit SHA shown during review.
   * @param confirmed Explicit user confirmation flag (must be `true`).
   * @param signal Optional cancellation signal.
   * @returns Installed folder path and verified file totals.
   */
  @Remote
  async installSkill(skillId: string, commitSha: string, confirmed: boolean, signal?: AbortSignal): Promise<SkillInstallResult> {
    signal = this.callSignal(signal)
    if (!confirmed) throw new Error('Confirm the skill installation first.')
    const selectedSha = safeSha(commitSha)
    const skill = this.knownSkill(skillId)
    const reviewed = this.reviewedSkill(skill.id, selectedSha)
    if (this.installing.has(skill.installDir)) throw new Error('An install for this skill target is already running.')
    this.installing.add(skill.installDir)
    const deadline = AbortSignal.timeout(this.spec.operationTimeoutMs)
    const installSignal = AbortSignal.any([signal, deadline])
    const task = this.installTransaction(reviewed, installSignal)
    this.activeInstalls.add(task)
    try {
      return await task
    } finally {
      this.activeInstalls.delete(task)
      this.installing.delete(skill.installDir)
    }
  }

  /** List direct regular subdirectories under `skillRoot` containing a regular `SKILL.md`.
   * @returns Sorted installed skill entries.
   */
  @Remote
  async listInstalledSkills(): Promise<InstalledSkill[]> {
    let rootStat
    try { rootStat = await lstat(this.spec.skillRoot) }
    catch (error: unknown) { if (isMissingPath(error)) return []; throw error }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Configured skill root must be a regular directory.')
    const entries = await readdir(this.spec.skillRoot, { withFileTypes: true })
    const skills: InstalledSkill[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = join(this.spec.skillRoot, entry.name)
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

  /** Remove one confirmed skill directory from `skillRoot`.
   * @param id Directory key returned by `listInstalledSkills`.
   * @param confirmed Explicit user confirmation flag.
   * @returns The removed skill directory key.
   */
  @Remote
  async removeInstalledSkill(id: string, confirmed: boolean): Promise<string> {
    if (!confirmed) throw new Error('Confirm skill removal first.')
    if (!isSkillDirectoryId(id)) throw new Error('Installed skill id is invalid.')
    if (this.removing.has(id)) throw new Error('This skill is already being removed.')
    this.removing.add(id)
    try {
      const rootStat = await lstat(this.spec.skillRoot)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Configured skill root must be a regular directory.')
      const target = join(this.spec.skillRoot, id)
      const targetStat = await lstat(target)
      if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new Error('Installed skill must be a regular directory.')
      const manifestStat = await lstat(join(target, 'SKILL.md'))
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error('Installed skill must contain a regular SKILL.md file.')
      await rm(target, { recursive: true })
      return id
    } finally {
      this.removing.delete(id)
    }
  }

  private async loadGithubIndex(signal: AbortSignal): Promise<CachedGithubIndex> {
    if (this.indexCache !== undefined && this.indexCache.expires > Date.now()) {
      for (const record of this.indexCache.value.items) this.indexTargets.set(record.item.id, record.target)
      return this.indexCache.value
    }
    if (this.indexInflight !== undefined) return await this.indexInflight
    const task = fetchGithubSkillIndex(
      this.spec.indexRepo,
      this.spec.indexRef,
      this.spec.indexPath,
      this.requestContext(),
      this.operationSignal(signal),
    ).then((loaded) => {
      this.indexTargets.clear()
      for (const record of loaded.items) this.indexTargets.set(record.item.id, record.target)
      this.indexCache = { expires: Date.now() + this.spec.metadataCacheTtlMs, value: loaded }
      return loaded
    }).finally(() => {
      this.indexInflight = undefined
    })
    this.indexInflight = task
    return await task
  }

  private requestContext(): GithubRequestContext {
    return {
      timeoutMs: this.spec.timeoutMs,
      maxResponseBytes: this.spec.maxResponseBytes,
      maxIndexBytes: this.spec.maxIndexBytes,
      maxFileBytes: this.spec.maxFileBytes,
      maxFiles: this.spec.maxFiles,
      maxTotalBytes: this.spec.maxTotalBytes,
      getGithubToken: async () => await this.githubToken(),
    }
  }

  private async githubToken(): Promise<string | undefined> {
    if (this.spec.githubCredentialKey === undefined) return undefined
    const credential = await this.ctx.credentials.resolve(credentialRef(this.spec.githubCredentialKey))
    if (credential === undefined) throw new Error('The configured GitHub credential reference is unavailable.')
    return credential.value
  }

  private async cachedCommitSha(
    owner: string,
    repo: string,
    branch: string,
    requestCtx: GithubRequestContext,
    signal: AbortSignal,
  ): Promise<string> {
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}#${branch}`
    const cached = this.commits.get(key)
    if (cached !== undefined && cached.expires > Date.now()) return cached.sha
    const sha = await fetchCommitSha(owner, repo, branch, requestCtx, signal)
    this.commits.delete(key)
    this.commits.set(key, { expires: Date.now() + this.spec.cacheTtlMs, sha })
    while (this.commits.size > this.spec.maxCacheEntries) {
      const oldest = this.commits.keys().next().value
      if (oldest === undefined) break
      this.commits.delete(oldest)
    }
    return sha
  }

  private async cachedGitTree(
    owner: string,
    repo: string,
    commitSha: string,
    requestCtx: GithubRequestContext,
    signal: AbortSignal,
  ): Promise<CachedGitTree> {
    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}@${commitSha}`
    const cached = this.trees.get(key)
    if (cached !== undefined && cached.expires > Date.now()) return cached.tree
    const tree = await fetchGitTree(owner, repo, commitSha, requestCtx, signal)
    this.trees.delete(key)
    this.trees.set(key, { expires: Date.now() + this.spec.cacheTtlMs, tree })
    while (this.trees.size > this.spec.maxCacheEntries) {
      const oldest = this.trees.keys().next().value
      if (oldest === undefined) break
      this.trees.delete(oldest)
    }
    return tree
  }

  private async resolveTruncatedRepoDir(
    owner: string,
    repo: string,
    commitSha: string,
    skillId: string,
    requestCtx: GithubRequestContext,
    signal: AbortSignal,
  ): Promise<string> {
    const cleanId = safeRelativePath(skillId).join('/')
    const candidates = [`skills/${cleanId}`, `.agents/skills/${cleanId}`, `.claude/skills/${cleanId}`, cleanId, '']
    for (const candidate of candidates) {
      try {
        await fetchContentsManifest(owner, repo, commitSha, candidate, requestCtx, signal)
        return candidate
      } catch (error: unknown) {
        signal.throwIfAborted()
        if (error instanceof RemoteError && error.code === 'skill-catalog/rate-limited') throw error
      }
    }
    throw new RemoteError('skill-catalog/skill-markdown-missing', 'Could not locate SKILL.md directory in truncated repository.', {})
  }

  private async installTransaction(reviewed: ReviewedSkill, signal: AbortSignal): Promise<SkillInstallResult> {
    const { skill, commitSha: selectedSha } = reviewed
    const installFolder = skill.installDir
    if (!isSkillDirectoryId(installFolder)) throw new Error('Target installation folder name is invalid.')
    const root = await ensureSkillRoot(this.spec.skillRoot)
    const control = await ensureControlRoot(root)
    const operation = await mkdtemp(join(control, 'install-'))
    let backupCleanupPending: string | undefined
    const rawBatch = await openRawBatchDispatcher(signal)
    try {
      signal.throwIfAborted()
      const stage = join(operation, 'tree')
      await mkdir(stage, { mode: 0o700 })
      let total = 0
      const installAbort = new AbortController()
      const workerSignal = AbortSignal.any([signal, installAbort.signal])
      let firstError: unknown
      const concurrency = 6
      let cursor = 0
      const workers = Array.from({ length: Math.min(concurrency, reviewed.reviewedFiles.length) }, async () => {
        while (cursor < reviewed.reviewedFiles.length) {
          workerSignal.throwIfAborted()
          const index = cursor++
          const file = reviewed.reviewedFiles[index]
          if (file === undefined) break
          try {
            const bytes = await fetchRawFileBytes(
              file.rawUrl,
              file.path,
              file.size,
              this.spec.maxFileBytes,
              this.spec.timeoutMs,
              workerSignal,
              file.sha,
              rawBatch.dispatcher,
            )
            workerSignal.throwIfAborted()
            total += bytes.byteLength
            if (total > this.spec.maxTotalBytes) throw new Error(`Skill download exceeds maxTotalBytes (${this.spec.maxTotalBytes}).`)
            const destination = resolve(stage, ...safeRelativePath(file.path))
            if (!destination.startsWith(`${resolve(stage)}${sep}`)) throw new Error('GitHub file path escaped the staging directory.')
            await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
            await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 })
          } catch (error: unknown) {
            if (firstError === undefined) firstError = error
            installAbort.abort(error)
            throw error
          }
        }
      })
      await Promise.allSettled(workers)
      if (firstError !== undefined) {
        throw firstError instanceof Error ? firstError : new Error(typeof firstError === 'string' ? firstError : 'Skill download failed.')
      }
      signal.throwIfAborted()
      if (total !== reviewed.totalBytes) throw new Error('Downloaded skill file bytes do not match the reviewed inventory.')
      await this.validateStagedSkill(operation, signal)
      signal.throwIfAborted()
      const target = join(root, installFolder)
      backupCleanupPending = await commitSkillDirectory(root, control, target, stage, signal)
    } finally {
      await rm(operation, { recursive: true, force: true })
      await rawBatch.close()
    }
    return {
      id: installFolder,
      commitSha: selectedSha,
      path: join(this.spec.skillRoot, installFolder),
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
      if (error instanceof RemoteError && error.code === 'skill-catalog/skill-incompatible') throw error
      throw incompatibleSkill(error)
    } finally {
      try { await provider.dispose() }
      finally { await ctx.fiber.dispose() }
    }
  }

  private cachedSearch(key: string): SkillCatalogPage | undefined {
    const cached = this.searches.get(key)
    if (cached === undefined || cached.expires < Date.now()) {
      this.searches.delete(key)
      return undefined
    }
    this.rememberKnownSkills(cached.page.items)
    return cached.page
  }

  private rememberSearch(key: string, page: SkillCatalogPage): void {
    this.searches.delete(key)
    this.searches.set(key, { expires: Date.now() + this.spec.cacheTtlMs, page })
    this.rememberKnownSkills(page.items)
    while (this.searches.size > this.spec.maxCacheEntries) {
      const oldest = this.searches.keys().next().value
      if (oldest === undefined) break
      this.searches.delete(oldest)
    }
  }

  private rememberKnownSkills(skills: readonly SkillCatalogItem[]): void {
    for (const skill of skills) {
      this.knownSkills.delete(skill.id)
      this.knownSkills.set(skill.id, skill)
    }
    const minRetained = Math.max(this.spec.maxCacheEntries, 100)
    while (this.knownSkills.size > minRetained) {
      const oldest = this.knownSkills.keys().next().value
      if (oldest === undefined) break
      this.knownSkills.delete(oldest)
    }
  }

  private rememberReview(review: ReviewedSkill): void {
    const key = reviewKey(review.skill.id, review.commitSha)
    this.reviewed.delete(key)
    this.reviewed.set(key, review)
    while (this.reviewed.size > this.spec.maxCacheEntries) {
      const oldest = this.reviewed.keys().next().value
      if (oldest === undefined) break
      this.reviewed.delete(oldest)
    }
  }

  private reviewedSkill(skillId: string, commitSha: string): ReviewedSkill {
    const key = reviewKey(skillId, commitSha)
    const review = this.reviewed.get(key)
    if (review === undefined) {
      throw new RemoteError('skill-catalog/review-required', 'Review this skill manifest again before installing it.', {})
    }
    this.reviewed.delete(key)
    this.reviewed.set(key, review)
    return review
  }

  private knownSkill(skillId: string): SkillCatalogItem {
    const skill = this.knownSkills.get(skillId)
    if (skill === undefined) {
      throw new RemoteError('skill-catalog/search-required', 'Search for this skill before requesting details or installing it.', {})
    }
    this.knownSkills.delete(skillId)
    this.knownSkills.set(skillId, skill)
    return skill
  }

  private callSignal(signal?: AbortSignal): AbortSignal {
    return signal === undefined ? this.serviceAbort.signal : AbortSignal.any([signal, this.serviceAbort.signal])
  }

  private operationSignal(signal: AbortSignal): AbortSignal {
    return AbortSignal.any([signal, AbortSignal.timeout(this.spec.operationTimeoutMs)])
  }
}

/** Register the dual-source community skill catalog service. */
export default class CommunitySkillCatalogPlugin extends SkillCatalog {}

function sourceWarning(source: 'github-index' | 'skills-sh', reason: unknown): SkillSourceWarning {
  if (reason instanceof RemoteError && reason.code === 'skill-catalog/rate-limited') {
    return { source, code: 'rate-limited' }
  }
  return { source, code: 'unavailable' }
}

function safeLimit(value: number | undefined, fallback: number, field: string): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1) throw new Error(`Skill catalog ${field} must be a positive safe integer.`)
  return selected
}

function boundedQuery(value: string | undefined, max: number): string {
  const result = value?.trim() ?? ''
  if (result.length > max) throw new Error(`Skill catalog query field exceeds ${max} characters.`)
  return result
}

function boundedInt(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error('Skill catalog pagination value is invalid.')
  }
  return value
}

function reviewKey(skillId: string, commitSha: string): string {
  return `${skillId}\n${commitSha.toLowerCase()}`
}

function isMissingPath(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

function incompatibleSkill(cause?: unknown): RemoteError<'skill-catalog/skill-incompatible'> {
  return new RemoteError(
    'skill-catalog/skill-incompatible',
    'GitHub content is not a skill accepted by the official filesystem provider.',
    {},
    cause === undefined ? undefined : { cause },
  )
}

function isSkillDirectoryId(id: string): boolean {
  return id.length > 0 && id.length <= 255 && !id.startsWith('.') && id !== '..' && !id.includes('/') && !id.includes('\\') && !id.includes('\0')
}

function displaySkillDirectory(id: string): string {
  try { return decodeURIComponent(id) } catch { return id }
}

async function ensureSkillRoot(root: string): Promise<string> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const stat = await lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Configured skill root must be a regular directory.')
  return root
}

async function ensureControlRoot(root: string): Promise<string> {
  const control = join(root, '.skill-catalog')
  try {
    const stat = await lstat(control)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Skill catalog transaction root must be a regular directory.')
  } catch (error: unknown) {
    if (!isMissingPath(error)) throw error
    try { await mkdir(control, { mode: 0o700 }) }
    catch (mkdirError: unknown) { if (!isAlreadyExists(mkdirError)) throw mkdirError }
    const stat = await lstat(control)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Skill catalog transaction root must be a regular directory.')
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
  if (relativeTarget === '' || relativeTarget.startsWith(`..${sep}`) || relativeTarget === '..' || relativeTarget.includes('\0')) {
    throw new Error('Skill install target escaped the configured root.')
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  let targetStat: Awaited<ReturnType<typeof lstat>> | undefined
  try { targetStat = await lstat(target) }
  catch (error: unknown) { if (!isMissingPath(error)) throw error }
  if (targetStat !== undefined && (!targetStat.isDirectory() || targetStat.isSymbolicLink())) {
    throw new Error('Existing skill install target must be a regular directory.')
  }
  const backup = targetStat === undefined ? undefined : join(control, `backup-${randomUUID()}`)
  if (backup !== undefined) await rename(target, backup)
  try {
    signal?.throwIfAborted()
    await rename(stage, target)
  } catch (error: unknown) {
    if (backup !== undefined) {
      await rename(backup, target).catch((restoreError: unknown) => {
        throw new AggregateError([error, restoreError], 'Skill install failed and its previous directory could not be restored.')
      })
    }
    throw error
  }
  if (backup === undefined) return undefined
  try { await rm(backup, { recursive: true }); return undefined }
  catch { return backup }
}
