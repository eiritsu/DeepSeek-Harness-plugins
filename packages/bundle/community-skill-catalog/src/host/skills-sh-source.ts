/** `skills.sh` search client and dual-source merge/deduplication logic. */

import type { SkillCatalogItem, SkillCatalogSort } from '../types.ts'
import type { IndexedSkillRecord } from './github-source.ts'
import { parseRepoSlug, safeSkillDir } from './github-source.ts'
import {
  SKILLS_SH_ORIGIN,
  parseJsonBytes,
  readBounded,
  requestPublic,
  throwUpstreamStatus,
} from './network.ts'

const MAX_SKILLS_SH_LIMIT = 50

/** Validated `skills.sh` search hit paired with its parsed GitHub owner/repo. */
export interface SkillsShEntry {
  /** Normalized catalog item exposed to callers. */
  readonly item: SkillCatalogItem
  /** GitHub owner parsed from `source`. */
  readonly owner: string
  /** GitHub repository name parsed from `source`. */
  readonly repoName: string
}

/** Query the public `skills.sh` Algolia-backed search endpoint.
 * @param query Non-empty search query (caller ensures length >= 2).
 * @param limit Maximum items requested (capped at 50).
 * @param timeoutMs Per-request timeout.
 * @param maxResponseBytes Maximum JSON payload bytes.
 * @param signal Cancellation signal.
 * @returns Validated GitHub-backed skills returned by `skills.sh`.
 */
export async function fetchSkillsShSearch(
  query: string,
  limit: number,
  timeoutMs: number,
  maxResponseBytes: number,
  signal: AbortSignal,
): Promise<readonly SkillsShEntry[]> {
  const url = new URL('/api/search', SKILLS_SH_ORIGIN)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(Math.min(MAX_SKILLS_SH_LIMIT, Math.max(1, limit))))
  const response = await requestPublic(url, timeoutMs, signal)
  try {
    if (response.status !== 200) throwUpstreamStatus('skills-sh', response.status)
    const raw = parseJsonBytes(await readBounded(response, maxResponseBytes, 'skills.sh search'), 'skills.sh search')
    return parseSkillsShResponse(raw)
  } finally {
    await response.close()
  }
}

/** Parse and filter a raw JSON payload from `skills.sh/api/search` to GitHub-backed skills.
 * @param raw Parsed JSON response object.
 * @returns Validated GitHub `owner/repo` backed entries.
 */
export function parseSkillsShResponse(raw: unknown): SkillsShEntry[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('skills.sh returned an invalid search response.')
  }
  const rows = (raw as { skills?: unknown }).skills
  if (!Array.isArray(rows)) {
    throw new Error('skills.sh search response omitted the skills array.')
  }
  const entries: SkillsShEntry[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) continue
    const obj = row as Record<string, unknown>
    const rawId = typeof obj.id === 'string' ? obj.id.trim() : ''
    const rawSource = typeof obj.source === 'string' ? obj.source.trim() : ''
    const rawSkillId = typeof obj.skillId === 'string' ? obj.skillId.trim() : ''
    const name = typeof obj.name === 'string' ? obj.name.trim() : rawSkillId
    const installs = typeof obj.installs === 'number' && Number.isSafeInteger(obj.installs) && obj.installs >= 0
      ? obj.installs
      : undefined
    if (rawId === '' || rawSource === '' || rawSkillId === '' || name === '') continue
    // Restrict resolution to public GitHub owner/repo entries so every install stays commit-pinned and SHA-verified.
    let parsedRepo: { readonly owner: string; readonly repo: string }
    try { parsedRepo = parseRepoSlug(rawSource) }
    catch { continue }

    const itemId = `skills-sh:${parsedRepo.owner}/${parsedRepo.repo}/${rawSkillId}`
    if (seen.has(itemId)) continue
    seen.add(itemId)

    const githubUrl = `https://github.com/${encodeURIComponent(parsedRepo.owner)}/${encodeURIComponent(parsedRepo.repo)}`
    const listingPath = rawId.split('/').filter(Boolean).map(encodeURIComponent).join('/')
    const listingUrl = `${SKILLS_SH_ORIGIN}/${listingPath}`

    entries.push({
      item: {
        id: itemId,
        name: name.slice(0, 160),
        installDir: safeSkillDir(rawSkillId),
        skillId: rawSkillId,
        repo: `${parsedRepo.owner}/${parsedRepo.repo}`,
        author: parsedRepo.owner,
        description: '',
        githubUrl,
        url: listingUrl,
        source: 'skills-sh',
        sources: ['skills-sh'],
        ...(installs === undefined ? {} : { installs }),
      },
      owner: parsedRepo.owner,
      repoName: parsedRepo.repo,
    })
  }
  return entries
}

/** Merge curated GitHub index matches and `skills.sh` search hits with conservative deduplication.
 * @param indexMatches Scored matches from the curated GitHub index.
 * @param skillsShEntries GitHub-backed results from `skills.sh`.
 * @param sort Active sort order.
 * @param hasCategoryFilter True when a non-`all` category filter is selected.
 * @returns Deduplicated, sorted combined list of catalog items.
 */
export function mergeAndRankDualSources(
  indexMatches: readonly { readonly record: IndexedSkillRecord; readonly score: number }[],
  skillsShEntries: readonly SkillsShEntry[],
  sort: SkillCatalogSort,
  hasCategoryFilter: boolean,
): SkillCatalogItem[] {
  const merged = new Map<string, { item: SkillCatalogItem; score: number }>()
  const byAttribution = new Map<string, string>()

  for (const match of indexMatches) {
    const { record, score } = match
    merged.set(record.item.id, { item: record.item, score })
    if (record.attributionRepo !== undefined) {
      const key = attributionKey(record.attributionRepo, record.item.skillId)
      if (!byAttribution.has(key)) byAttribution.set(key, record.item.id)
    }
  }

  for (const [rankIndex, entry] of skillsShEntries.entries()) {
    const repoKey = `${entry.owner.toLowerCase()}/${entry.repoName.toLowerCase()}`
    const lookupKey = attributionKey(repoKey, entry.item.skillId)
    const matchedId = byAttribution.get(lookupKey)
    if (matchedId !== undefined) {
      const existing = merged.get(matchedId)
      if (existing !== undefined) {
        existing.item = {
          ...existing.item,
          sources: ['github-index', 'skills-sh'],
          url: entry.item.url,
          ...(entry.item.installs === undefined ? {} : { installs: entry.item.installs }),
        }
        existing.score += 35
      }
      continue
    }
    if (hasCategoryFilter) continue

    const installsBonus = entry.item.installs !== undefined ? Math.min(80, Math.floor(Math.log10(entry.item.installs + 1) * 14)) : 0
    const positionBonus = Math.max(0, 40 - rankIndex * 2)
    merged.set(entry.item.id, { item: entry.item, score: 45 + installsBonus + positionBonus })
  }

  const rows = [...merged.values()]
  rows.sort((left, right) => {
    if (sort === 'installs') {
      const installsDiff = (right.item.installs ?? -1) - (left.item.installs ?? -1)
      if (installsDiff !== 0) return installsDiff
    } else if (sort === 'recent') {
      const updatedDiff = (right.item.updatedAt ?? 0) - (left.item.updatedAt ?? 0)
      if (updatedDiff !== 0) return updatedDiff
    } else {
      const dualDiff = right.item.sources.length - left.item.sources.length
      if (dualDiff !== 0 && Math.abs(right.score - left.score) < 25) return dualDiff
    }
    const scoreDiff = right.score - left.score
    if (scoreDiff !== 0) return scoreDiff
    const installsDiff = (right.item.installs ?? -1) - (left.item.installs ?? -1)
    if (installsDiff !== 0) return installsDiff
    return left.item.name.localeCompare(right.item.name)
  })
  return rows.map(row => row.item)
}

function attributionKey(repo: string, skillId: string): string {
  const normalizedSkill = skillId.toLowerCase().replace(/[^a-z0-9]+/gu, '-')
  return `${repo.toLowerCase()}\0${normalizedSkill}`
}
