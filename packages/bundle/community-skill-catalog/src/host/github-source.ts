/** GitHub index parsing, repository tree discovery, and pinned file manifest helpers. */

import { createHash } from 'node:crypto'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { Dispatcher } from 'undici'
import type { SkillCatalogItem, SkillCatalogSort, SkillCategory } from '../types.ts'
import {
  GITHUB_API_ORIGIN,
  GITHUB_RAW_ORIGIN,
  parseJsonBytes,
  readBounded,
  requestPublic,
  throwUpstreamStatus,
} from './network.ts'

const SHA = /^[a-f0-9]{40}$/iu
const REPO_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/u
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})$/u
const MAX_FRONTMATTER_DISCOVERY_CANDIDATES = 30

/** GitHub repository and subtree target for manifest resolution. */
export interface GithubContentsTarget {
  /** Repository owner or organization. */
  readonly owner: string
  /** Repository name. */
  readonly repo: string
  /** Branch or commit reference. */
  readonly branch: string
  /** Repository-relative skill directory (`""` for repo root). */
  readonly path: string
}

/** Validated file entry queued for detail preview or staged install. */
export interface ManifestFile {
  /** Relative file path inside the skill directory. */
  readonly path: string
  /** Declared or Git-tree byte size. */
  readonly size: number
  /** Commit-pinned HTTPS URL on `raw.githubusercontent.com`. */
  readonly rawUrl: string
  /** Optional Git blob SHA1 hex digest when provided by the GitHub API. */
  readonly sha?: string
}

/** One entry inside the cached GitHub tree listing for a commit SHA. */
export interface GitTreeEntry {
  /** Normalized POSIX repository path. */
  readonly path: string
  /** Blob SHA1 hex digest. */
  readonly sha: string
  /** Blob byte size. */
  readonly size: number
}

/** Cached recursive Git tree result for one repository commit. */
export interface CachedGitTree {
  /** True if GitHub truncated the recursive tree response. */
  readonly truncated: boolean
  /** All blob entries present in the returned tree. */
  readonly blobs: readonly GitTreeEntry[]
}

/** Indexed skill record retaining resolved target path metadata for fast lookup. */
export interface IndexedSkillRecord {
  /** Public skill item exposed to callers. */
  readonly item: SkillCatalogItem
  /** Pre-validated GitHub target when loaded from the curated index. */
  readonly target: GithubContentsTarget
  /** Optional attribution slug/URL from upstream metadata for deduplication. */
  readonly attributionRepo?: string
}

/** Parsed index payload held in bounded Host cache. */
export interface CachedGithubIndex {
  /** Keyed by `item.id` for O(1) lookup. */
  readonly items: readonly IndexedSkillRecord[]
  /** Sorted categories with live counts. */
  readonly categories: readonly SkillCategory[]
  /** Repository slug `owner/repo` that owns this index. */
  readonly indexRepo: string
  /** Unix epoch milliseconds when the index was parsed. */
  readonly fetchedAt: number
}

/** Context required when querying GitHub REST and raw APIs. */
export interface GithubRequestContext {
  /** Timeout per HTTP request in milliseconds. */
  readonly timeoutMs: number
  /** Maximum JSON body bytes for commit/tree/contents responses. */
  readonly maxResponseBytes: number
  /** Maximum byte size for `skills_index.json`. */
  readonly maxIndexBytes: number
  /** Maximum byte size for one file. */
  readonly maxFileBytes: number
  /** Maximum files permitted in one skill directory. */
  readonly maxFiles: number
  /** Maximum aggregate bytes permitted in one skill directory. */
  readonly maxTotalBytes: number
  /** Optional GitHub credential resolved dynamically when calling `api.github.com`. */
  readonly getGithubToken: () => Promise<string | undefined>
}

/** Parse and validate `owner/repo` slug into separate components.
 * @param value Repository slug string.
 * @returns Validated owner and repo names.
 */
export function parseRepoSlug(value: string): { readonly owner: string; readonly repo: string } {
  const parts = value.trim().split('/')
  if (parts.length !== 2) throw new RemoteError('skill-catalog/github-source-invalid', 'GitHub repository must be owner/repo.', {})
  const owner = parts[0]
  const repo = parts[1]
  if (owner === undefined || repo === undefined || !REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(repo)) {
    throw new RemoteError('skill-catalog/github-source-invalid', 'GitHub repository identity is invalid.', {})
  }
  return { owner, repo }
}

/** Validate a safe relative path and return its segments.
 * @param path Repository-relative or skill-relative slash path.
 * @returns Safe non-empty POSIX path segments.
 */
export function safeRelativePath(path: string): string[] {
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.includes(':')) {
    throw new Error(`GitHub returned an unsafe file path: ${path}`)
  }
  const parts = path.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`GitHub returned an unsafe file path: ${path}`)
  }
  return parts
}

/** Sanitize a directory name candidate for safe child creation under `skillRoot`.
 * @param raw Raw skill slug or identifier.
 * @returns Safe single-segment directory name.
 */
export function safeSkillDir(raw: string): string {
  const cleaned = raw.trim().replaceAll('/', '-').replace(/[^A-Za-z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '').replace(/\.+/gu, '.')
  if (cleaned === '' || cleaned === '.' || cleaned === '..' || cleaned.startsWith('.')) {
    return encodeURIComponent(raw).slice(0, 120) || 'skill'
  }
  return cleaned.slice(0, 120)
}

/** Verify a strict 40-character hexadecimal commit or blob SHA.
 * @param value Raw SHA string.
 * @returns Lowercase 40-character SHA.
 */
export function safeSha(value: string): string {
  if (!SHA.test(value)) throw new Error('Commit and Git blob SHA values must be 40 hexadecimal characters.')
  return value.toLowerCase()
}

/** Compute the Git blob SHA-1 digest of file bytes.
 * @param bytes File payload bytes.
 * @returns 40-character lowercase SHA-1 hex digest.
 */
export function gitBlobSha(bytes: Uint8Array): string {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8')
  return createHash('sha1').update(header).update(bytes).digest('hex')
}

/** Build a commit-pinned `raw.githubusercontent.com` URL for one file.
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param commitSha Exact 40-character commit SHA.
 * @param path Repository-relative path segments.
 * @returns Validated HTTPS URL string.
 */
export function canonicalRawUrl(owner: string, repo: string, commitSha: string, path: readonly string[]): string {
  return `${GITHUB_RAW_ORIGIN}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commitSha}/${path.map(encodeURIComponent).join('/')}`
}

/** Normalize a public GitHub repo or subtree URL and reject off-origin hosts.
 * @param value URL string returned by a catalog entry.
 * @returns Canonical `https://github.com/...` string.
 */
export function normalizeGitHubUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch (error: unknown) {
    throw new RemoteError('skill-catalog/github-source-invalid', 'Catalog returned an invalid GitHub URL.', {}, { cause: error })
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port !== '' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new RemoteError('skill-catalog/github-source-invalid', 'GitHub URL must use the public github.com HTTPS origin.', {})
  }
  let parts: string[]
  try { parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part)) }
  catch (error: unknown) {
    throw new RemoteError('skill-catalog/github-source-invalid', 'GitHub URL contains invalid path encoding.', {}, { cause: error })
  }
  if (parts.length < 2 || parts[2] === 'blob' || (parts.length === 3 && parts[2] !== 'tree')) {
    throw new RemoteError('skill-catalog/github-source-invalid', 'GitHub URL must identify a repository or tree directory.', {})
  }
  const owner = parts[0]
  const repo = parts[1]
  if (owner === undefined || repo === undefined || !REPO_SEGMENT.test(owner) || !REPO_SEGMENT.test(repo)) {
    throw new RemoteError('skill-catalog/github-source-invalid', 'GitHub repository identity is invalid.', {})
  }
  if (parts.some(part => part === '.' || part === '..' || part.includes('/') || part.includes('\\') || part.includes('\0'))) {
    throw new RemoteError('skill-catalog/github-source-invalid', 'GitHub URL contains an unsafe path.', {})
  }
  return `https://github.com/${parts.map(encodeURIComponent).join('/')}`
}

/** Extract lightweight YAML frontmatter `name` and `description` values without executing YAML tags.
 * @param markdown Full UTF-8 `SKILL.md` contents.
 * @returns Extracted plain strings when present.
 */
export function extractSkillFrontmatter(markdown: string): { readonly name?: string; readonly description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown)
  if (match === null) return {}
  const block = match[1] ?? ''
  const name = readScalarYamlField(block, 'name')
  const description = readScalarYamlField(block, 'description')
  return {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
  }
}

function readScalarYamlField(block: string, field: string): string | undefined {
  const lines = block.split(/\r?\n/u)
  const prefix = `${field}:`
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (!line.startsWith(prefix)) continue
    let raw = line.slice(prefix.length).trim()
    if (raw === '' || raw === '|' || raw === '>') {
      const collected: string[] = []
      for (let next = index + 1; next < lines.length; next += 1) {
        const sub = lines[next] ?? ''
        if (!/^\s+/u.test(sub)) break
        collected.push(sub.trim())
      }
      const joined = collected.join(' ').trim()
      return joined === '' ? undefined : joined
    }
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1)
    }
    const normalized = raw.trim()
    return normalized === '' ? undefined : normalized
  }
  return undefined
}

/** Parse the `skills_index.json` payload published by the configured GitHub repository.
 * @param raw Parsed JSON payload from GitHub raw content.
 * @param indexRepo Configured `owner/repo` string.
 * @param indexRef Configured branch or tag name.
 * @returns Validated index records and aggregated category counts.
 */
export function parseGithubSkillIndex(raw: unknown, indexRepo: string, indexRef: string): CachedGithubIndex {
  if (!Array.isArray(raw)) throw new RemoteError('skill-catalog/source-unavailable', 'GitHub skill index must be a JSON array.', { source: 'github', status: 200 })
  const { owner, repo } = parseRepoSlug(indexRepo)
  const cleanRef = safeRelativePath(indexRef).join('/')
  const records: IndexedSkillRecord[] = []
  const seenIds = new Set<string>()
  const categoryCounts = new Map<string, number>()

  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const row = entry as Record<string, unknown>
    const rawId = typeof row.id === 'string' ? row.id.trim() : ''
    const rawPath = typeof row.path === 'string' ? row.path.trim() : ''
    const name = typeof row.name === 'string' ? row.name.trim() : rawId
    if (rawId === '' || rawPath === '' || name === '') continue
    let segments: string[]
    try { segments = safeRelativePath(rawPath) }
    catch { continue }

    const skillPath = segments.join('/')
    const itemId = `github:${owner}/${repo}/${skillPath}`
    if (seenIds.has(itemId)) continue
    seenIds.add(itemId)

    const category = typeof row.category === 'string' && row.category.trim() !== ''
      ? normalizeCategorySlug(row.category.trim())
      : 'general'
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1)

    const description = typeof row.description === 'string' ? row.description.trim().slice(0, 2000) : ''
    const risk = typeof row.risk === 'string' && row.risk.trim() !== '' ? row.risk.trim().toLowerCase() : undefined
    const dateAdded = typeof row.date_added === 'string' && DATE_PREFIX.test(row.date_added.trim()) ? row.date_added.trim() : undefined
    const updatedAt = dateAdded === undefined ? undefined : parseIsoDateSeconds(dateAdded)
    const sourceRaw = typeof row.source === 'string' ? row.source.trim() : undefined
    const attributionRepo = extractAttributionRepo(sourceRaw)
    const author = attributionRepo ?? owner
    const targets = extractPluginTargets(row.plugin)
    const githubUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree/${segmentsOfRef(cleanRef)}/${segments.map(encodeURIComponent).join('/')}`

    records.push({
      item: {
        id: itemId,
        name: name.slice(0, 160),
        installDir: safeSkillDir(rawId),
        skillId: rawId,
        repo: indexRepo,
        author: author.slice(0, 160),
        description,
        category,
        ...(risk === undefined ? {} : { risk }),
        ...(targets.length === 0 ? {} : { targets }),
        githubUrl,
        url: githubUrl,
        source: 'github-index',
        sources: ['github-index'],
        ...(updatedAt === undefined ? {} : { updatedAt }),
        ...(dateAdded === undefined ? {} : { dateAdded }),
      },
      target: { owner, repo, branch: cleanRef, path: skillPath },
      ...(attributionRepo === undefined ? {} : { attributionRepo }),
    })
  }

  if (records.length === 0) {
    throw new RemoteError('skill-catalog/source-unavailable', 'GitHub skill index contained no valid skill entries.', { source: 'github', status: 200 })
  }

  const categories: SkillCategory[] = [...categoryCounts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))

  return {
    items: records,
    categories,
    indexRepo,
    fetchedAt: Date.now(),
  }
}

/** Fetch and parse `skills_index.json` from `raw.githubusercontent.com`.
 * @param indexRepo Repository slug (`owner/repo`).
 * @param indexRef Branch or tag name.
 * @param indexPath JSON path relative to repo root.
 * @param ctx Host request context with byte limits and timeout.
 * @param signal Cancellation signal.
 * @returns Parsed GitHub skill index.
 */
export async function fetchGithubSkillIndex(
  indexRepo: string,
  indexRef: string,
  indexPath: string,
  ctx: GithubRequestContext,
  signal: AbortSignal,
): Promise<CachedGithubIndex> {
  const { owner, repo } = parseRepoSlug(indexRepo)
  const refParts = safeRelativePath(indexRef)
  const fileParts = safeRelativePath(indexPath)
  const url = new URL(`${GITHUB_RAW_ORIGIN}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${refParts.map(encodeURIComponent).join('/')}/${fileParts.map(encodeURIComponent).join('/')}`)
  const response = await requestPublic(url, ctx.timeoutMs, signal)
  try {
    if (response.status !== 200) throwUpstreamStatus('github', response.status)
    const bytes = await readBounded(response, ctx.maxIndexBytes, 'GitHub skill index')
    return parseGithubSkillIndex(parseJsonBytes(bytes, 'GitHub skill index'), indexRepo, indexRef)
  } finally {
    await response.close()
  }
}

/** Score and filter indexed GitHub skills by keyword, category, and sort mode.
 * @param records Cached index entries.
 * @param query Search query string (may be empty for browse mode).
 * @param category Optional category filter (`""` or `"all"` for unrestricted).
 * @param sort Requested ranking order.
 * @returns Ranked index matches paired with relevance scores.
 */
export function queryGithubIndex(
  records: readonly IndexedSkillRecord[],
  query: string,
  category: string,
  sort: SkillCatalogSort,
): readonly { readonly record: IndexedSkillRecord; readonly score: number }[] {
  const selectedCategory = category === '' || category === 'all' ? '' : normalizeCategorySlug(category)
  const tokens = tokenizeQuery(query)
  const matched: { readonly record: IndexedSkillRecord; readonly score: number }[] = []

  for (const record of records) {
    if (selectedCategory !== '' && record.item.category !== selectedCategory) continue
    const score = tokens.length === 0 ? defaultCuratedScore(record.item) : scoreRecord(record.item, tokens)
    if (score <= 0) continue
    matched.push({ record, score })
  }

  matched.sort((left, right) => {
    if (sort === 'recent') {
      const dateDiff = (right.record.item.updatedAt ?? 0) - (left.record.item.updatedAt ?? 0)
      if (dateDiff !== 0) return dateDiff
    }
    const scoreDiff = right.score - left.score
    if (scoreDiff !== 0) return scoreDiff
    const dateDiff = (right.record.item.updatedAt ?? 0) - (left.record.item.updatedAt ?? 0)
    if (dateDiff !== 0) return dateDiff
    return left.record.item.name.localeCompare(right.record.item.name)
  })
  return matched
}

/** Resolve exact 40-character commit SHA for a repository branch or HEAD.
 * @param owner GitHub owner.
 * @param repo GitHub repo.
 * @param branch Preferred branch or `'HEAD'`.
 * @param ctx Request context with optional GitHub token.
 * @param signal Cancellation signal.
 * @returns Exact 40-character lowercase SHA.
 */
export async function fetchCommitSha(
  owner: string,
  repo: string,
  branch: string,
  ctx: GithubRequestContext,
  signal: AbortSignal,
): Promise<string> {
  const branchToTry = branch !== '' && branch !== 'HEAD' ? branch : 'HEAD'
  const token = await ctx.getGithubToken()
  const headers: Record<string, string> = {
    accept: 'application/vnd.github.sha, application/json;q=0.9',
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  }
  const makeUrl = (ref: string): URL => new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`,
    GITHUB_API_ORIGIN,
  )
  let response = await requestPublic(makeUrl(branchToTry), ctx.timeoutMs, signal, headers)
  try {
    if (response.status === 404 && branchToTry !== 'HEAD') {
      await response.close()
      response = await requestPublic(makeUrl('HEAD'), ctx.timeoutMs, signal, headers)
    }
    if (response.status !== 200) throwUpstreamStatus('github', response.status)
    const bytes = await readBounded(response, ctx.maxResponseBytes, 'GitHub commit')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
    if (SHA.test(text)) return text.toLowerCase()
    const parsed = parseJsonBytes(bytes, 'GitHub commit')
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const sha = (parsed as { sha?: unknown }).sha
      if (typeof sha === 'string' && SHA.test(sha)) return sha.toLowerCase()
    }
    throw new Error('GitHub commit lookup did not return a 40-character commit SHA.')
  } finally {
    await response.close()
  }
}

/** Fetch the recursive Git tree for a resolved commit SHA.
 * @param owner GitHub owner.
 * @param repo GitHub repository.
 * @param commitSha Exact 40-character commit SHA.
 * @param ctx Request context.
 * @param signal Cancellation signal.
 * @returns Filtered blob entries and truncation flag.
 */
export async function fetchGitTree(
  owner: string,
  repo: string,
  commitSha: string,
  ctx: GithubRequestContext,
  signal: AbortSignal,
): Promise<CachedGitTree> {
  const token = await ctx.getGithubToken()
  const url = new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${safeSha(commitSha)}?recursive=1`,
    GITHUB_API_ORIGIN,
  )
  const response = await requestPublic(url, ctx.timeoutMs, signal, {
    accept: 'application/json',
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  })
  try {
    if (response.status !== 200) throwUpstreamStatus('github', response.status)
    const bytes = await readBounded(response, ctx.maxIndexBytes, 'GitHub tree')
    const raw = parseJsonBytes(bytes, 'GitHub tree')
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('GitHub tree returned an invalid response.')
    }
    const obj = raw as { truncated?: unknown; tree?: unknown }
    if (!Array.isArray(obj.tree)) throw new Error('GitHub tree response is missing entries.')
    const blobs: GitTreeEntry[] = []
    for (const item of obj.tree) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const row = item as { type?: unknown; path?: unknown; sha?: unknown; size?: unknown }
      if (row.type !== 'blob') continue
      if (typeof row.path !== 'string' || typeof row.sha !== 'string' || !SHA.test(row.sha)) continue
      if (typeof row.size !== 'number' || !Number.isSafeInteger(row.size) || row.size < 0) continue
      try { safeRelativePath(row.path) } catch { continue }
      blobs.push({ path: row.path, sha: row.sha.toLowerCase(), size: row.size })
    }
    return { truncated: obj.truncated === true, blobs }
  } finally {
    await response.close()
  }
}

/** Locate the repository directory matching `skillId` from a recursive Git tree.
 * @param owner Repository owner.
 * @param repo Repository name.
 * @param commitSha Pinned commit SHA.
 * @param skillId Skill identifier reported by `skills.sh`.
 * @param tree Cached recursive tree blobs.
 * @param ctx Request context.
 * @param signal Cancellation signal.
 * @param dispatcher Optional raw download dispatcher.
 * @returns Resolved repository-relative directory (`""` for repository root).
 */
export async function resolveSkillDirectoryInTree(
  owner: string,
  repo: string,
  commitSha: string,
  skillId: string,
  tree: CachedGitTree,
  ctx: GithubRequestContext,
  signal: AbortSignal,
  dispatcher?: Dispatcher,
): Promise<string> {
  const skillDocs = tree.blobs.filter(blob => blob.path === 'SKILL.md' || blob.path.endsWith('/SKILL.md'))
  if (skillDocs.length === 0) {
    throw new RemoteError('skill-catalog/skill-markdown-missing', 'GitHub repository contains no SKILL.md files.', {})
  }
  const normalizedTarget = skillId.trim().toLowerCase()
  const rankedDirs = skillDocs
    .map((blob) => {
      const dir = blob.path === 'SKILL.md' ? '' : blob.path.slice(0, -'/SKILL.md'.length)
      return { blob, dir, priority: dirPriority(dir, normalizedTarget) }
    })
    .sort((left, right) => right.priority - left.priority || left.dir.length - right.dir.length || left.dir.localeCompare(right.dir))

  const top = rankedDirs[0]
  if (top !== undefined && top.priority >= 100) return top.dir
  if (rankedDirs.length === 1 && top !== undefined) return top.dir

  for (const candidate of rankedDirs.slice(0, MAX_FRONTMATTER_DISCOVERY_CANDIDATES)) {
    const pathParts = candidate.blob.path.split('/')
    const rawUrl = canonicalRawUrl(owner, repo, commitSha, pathParts)
    try {
      const bytes = await fetchRawFileBytes(
        rawUrl,
        candidate.blob.path,
        candidate.blob.size,
        ctx.maxFileBytes,
        ctx.timeoutMs,
        signal,
        candidate.blob.sha,
        dispatcher,
      )
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const fm = extractSkillFrontmatter(text)
      if (fm.name !== undefined && fm.name.trim().toLowerCase() === normalizedTarget) {
        return candidate.dir
      }
    } catch {
      // Ignore unreadable candidates while scanning directory frontmatter names.
    }
  }
  if (top !== undefined) return top.dir
  throw new RemoteError('skill-catalog/skill-markdown-missing', 'Could not locate matching SKILL.md directory in GitHub repository.', {})
}

/** Collect bounded manifest files from an un-truncated recursive Git tree under `dirPath`.
 * @param owner GitHub owner.
 * @param repo GitHub repository.
 * @param commitSha Exact commit SHA.
 * @param dirPath Resolved directory (`""` for repo root).
 * @param tree Recursive tree listing.
 * @param ctx Request context with file count/size bounds.
 * @returns Validated manifest file entries.
 */
export function buildManifestFromTree(
  owner: string,
  repo: string,
  commitSha: string,
  dirPath: string,
  tree: CachedGitTree,
  ctx: GithubRequestContext,
): ManifestFile[] {
  const prefix = dirPath === '' ? '' : `${dirPath}/`
  const entries = tree.blobs.filter(blob => dirPath === '' ? true : blob.path.startsWith(prefix))
  const files: ManifestFile[] = []
  let totalBytes = 0

  for (const blob of entries) {
    const relPath = prefix === '' ? blob.path : blob.path.slice(prefix.length)
    const segments = safeRelativePath(relPath)
    const rootSegments = dirPath === '' ? [] : safeRelativePath(dirPath)
    validateFileLimit(blob.size, ctx.maxFileBytes)
    totalBytes += blob.size
    validateTotalLimit(totalBytes, ctx.maxTotalBytes)
    files.push({
      path: relPath,
      size: blob.size,
      sha: blob.sha,
      rawUrl: canonicalRawUrl(owner, repo, commitSha, [...rootSegments, ...segments]),
    })
    validateCountLimit(files.length, ctx.maxFiles)
  }

  if (!files.some(file => file.path === 'SKILL.md')) {
    throw new RemoteError('skill-catalog/skill-markdown-missing', 'GitHub skill directory must contain a root SKILL.md file.', {})
  }
  return files
}

/** List all bounded files under a directory via GitHub Contents API BFS.
 * @param owner GitHub owner.
 * @param repo GitHub repository.
 * @param commitSha Pinned commit SHA.
 * @param dirPath Directory path inside the repository.
 * @param ctx Request context.
 * @param signal Cancellation signal.
 * @returns Validated manifest file entries.
 */
export async function fetchContentsManifest(
  owner: string,
  repo: string,
  commitSha: string,
  dirPath: string,
  ctx: GithubRequestContext,
  signal: AbortSignal,
): Promise<ManifestFile[]> {
  const files: ManifestFile[] = []
  const queue = [dirPath]
  const rootSegments = dirPath === '' ? [] : safeRelativePath(dirPath)
  const token = await ctx.getGithubToken()
  let totalBytes = 0

  while (queue.length > 0) {
    signal.throwIfAborted()
    const currentPath = queue.shift()
    if (currentPath === undefined) break
    const encodedPath = currentPath === '' ? '' : currentPath.split('/').map(encodeURIComponent).join('/')
    const contentsUrl = new URL(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents${encodedPath === '' ? '' : `/${encodedPath}`}`,
      GITHUB_API_ORIGIN,
    )
    contentsUrl.searchParams.set('ref', commitSha)
    const response = await requestPublic(contentsUrl, ctx.timeoutMs, signal, {
      accept: 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    })
    let items: unknown
    try {
      if (response.status !== 200) throwUpstreamStatus('github', response.status)
      items = parseJsonBytes(await readBounded(response, ctx.maxResponseBytes, 'GitHub contents'), 'GitHub contents')
    } finally {
      await response.close()
    }
    if (!Array.isArray(items)) throw new Error('GitHub contents returned an unexpected response.')

    for (const rawEntry of items) {
      if (typeof rawEntry !== 'object' || rawEntry === null || Array.isArray(rawEntry)) continue
      const item = rawEntry as Record<string, unknown>
      const itemPath = typeof item.path === 'string' && item.path.length > 0 && item.path.length <= 2048 ? item.path : undefined
      if (itemPath === undefined) throw new Error('GitHub contents returned an invalid file path.')
      if (item.type === 'dir') {
        queue.push(itemPath)
      } else if (item.type === 'file') {
        const relPath = dirPath === '' ? itemPath : itemPath.startsWith(`${dirPath}/`) ? itemPath.slice(dirPath.length + 1) : itemPath
        const segments = safeRelativePath(relPath)
        const size = typeof item.size === 'number' && Number.isSafeInteger(item.size) && item.size >= 0 ? item.size : undefined
        if (size === undefined) throw new Error(`GitHub contents returned an invalid file size for ${relPath}.`)
        validateFileLimit(size, ctx.maxFileBytes)
        totalBytes += size
        validateTotalLimit(totalBytes, ctx.maxTotalBytes)
        const sha = typeof item.sha === 'string' && SHA.test(item.sha) ? item.sha.toLowerCase() : undefined
        files.push({
          path: relPath,
          size,
          rawUrl: canonicalRawUrl(owner, repo, commitSha, [...rootSegments, ...segments]),
          ...(sha === undefined ? {} : { sha }),
        })
        validateCountLimit(files.length, ctx.maxFiles)
      }
    }
  }

  if (!files.some(file => file.path === 'SKILL.md')) {
    throw new RemoteError('skill-catalog/skill-markdown-missing', 'GitHub skill directory must contain a root SKILL.md file.', {})
  }
  return files
}

/** Download raw file bytes from `raw.githubusercontent.com` and verify exact byte size and Git blob SHA.
 * @param rawUrl Pinned `raw.githubusercontent.com` URL.
 * @param path File path for integrity failure diagnostics.
 * @param expectedSize Reviewed byte length.
 * @param maxBytes Configured per-file cap.
 * @param timeoutMs Per-request timeout.
 * @param signal Cancellation signal.
 * @param expectedSha Optional reviewed Git blob SHA1.
 * @param dispatcher Optional batch dispatcher.
 * @returns Verified raw file bytes.
 */
export async function fetchRawFileBytes(
  rawUrl: string,
  path: string,
  expectedSize: number,
  maxBytes: number,
  timeoutMs: number,
  signal: AbortSignal,
  expectedSha?: string,
  dispatcher?: Dispatcher,
): Promise<Uint8Array> {
  const url = new URL(rawUrl)
  if (url.origin !== GITHUB_RAW_ORIGIN) throw new Error('Manifest raw URL is outside the allowed GitHub content origin.')
  const response = await requestPublic(url, timeoutMs, signal, undefined, dispatcher)
  try {
    if (response.status !== 200) throwUpstreamStatus('github', response.status)
    const bytes = await readBounded(response, Math.min(512_001, Math.max(maxBytes, expectedSize + 1)), 'GitHub raw file')
    const actualSha = gitBlobSha(bytes)
    if (bytes.byteLength !== expectedSize || (expectedSha !== undefined && actualSha !== expectedSha)) {
      throw new RemoteError('skill-catalog/file-integrity-failed', `GitHub file integrity check failed for ${path}.`, { path })
    }
    return bytes
  } finally {
    await response.close()
  }
}

function validateFileLimit(size: number, maxFileBytes: number): void {
  if (size > Math.min(512_000, maxFileBytes)) {
    throw new RemoteError('skill-catalog/manifest-incomplete', 'Skill directory exceeds the supported per-file size.', { skippedFiles: 0, limitReason: 'file_size' })
  }
}

function validateTotalLimit(total: number, maxTotalBytes: number): void {
  if (total > Math.min(5 * 1024 * 1024, maxTotalBytes)) {
    throw new RemoteError('skill-catalog/manifest-incomplete', 'Skill directory exceeds the supported total byte size.', { skippedFiles: 0, limitReason: 'total_size' })
  }
}

function validateCountLimit(count: number, maxFiles: number): void {
  if (count > Math.min(100, maxFiles)) {
    throw new RemoteError('skill-catalog/manifest-incomplete', 'Skill directory exceeds the supported file count.', { skippedFiles: 0, limitReason: 'file_count' })
  }
}

function dirPriority(dir: string, target: string): number {
  const lower = dir.toLowerCase()
  const base = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower
  if (lower === `skills/${target}`) return 130
  if (lower === `.agents/skills/${target}` || lower === `.claude/skills/${target}`) return 120
  if (lower === target || base === target) return 110
  if (target.includes(base) && base.length >= 4) return 60
  if (dir === '') return 20
  return 10
}

function normalizeCategorySlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'general'
}

function segmentsOfRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/')
}

function parseIsoDateSeconds(value: string): number | undefined {
  const ms = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

function extractAttributionRepo(source: string | undefined): string | undefined {
  if (source === undefined || source === '') return undefined
  const match = /github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/u.exec(source)
  if (match?.[1] !== undefined) return match[1]
  return undefined
}

function extractPluginTargets(plugin: unknown): string[] {
  if (typeof plugin !== 'object' || plugin === null || Array.isArray(plugin)) return []
  const targets = (plugin as { targets?: unknown }).targets
  if (typeof targets !== 'object' || targets === null || Array.isArray(targets)) return []
  return Object.entries(targets)
    .filter(([, status]) => status === 'supported')
    .map(([name]) => name)
}

function tokenizeQuery(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/u).filter(Boolean).slice(0, 8)
}

function defaultCuratedScore(item: SkillCatalogItem): number {
  let score = 50
  if (item.risk === 'safe') score += 20
  if (item.description.length > 0) score += 10
  if (item.targets !== undefined && item.targets.length > 0) score += 5
  return score
}

function scoreRecord(item: SkillCatalogItem, tokens: readonly string[]): number {
  const name = item.name.toLowerCase()
  const skillId = item.skillId.toLowerCase()
  const category = (item.category ?? '').toLowerCase()
  const author = item.author.toLowerCase()
  const description = item.description.toLowerCase()
  const joined = `${name} ${skillId} ${category} ${author} ${description}`

  let total = 0
  for (const token of tokens) {
    if (!joined.includes(token)) return 0
    if (name === token || skillId === token) total += 120
    else if (name.startsWith(token) || skillId.startsWith(token)) total += 70
    else if (name.includes(token) || skillId.includes(token)) total += 45
    else if (category.includes(token)) total += 30
    else if (author.includes(token)) total += 20
    else total += 12
  }
  if (item.risk === 'safe') total += 10
  return total
}
