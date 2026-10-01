/** Host Remote for the public deepseek1024.com plugin catalog. */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type { PluginCatalogPage, PluginCatalogSort } from '../types.ts'
import { matchesCatalogRepository, normalizeCatalogInstall } from './install-spec.ts'

const CATALOG_URL = 'https://deepseek1024.com/api/v2/plugins'
const SORTS = new Set<PluginCatalogSort>(['stars', 'npm', 'installs', 'newest', 'active'])

/** Public API location and bounds for one remote catalog read. */
export interface Config {
  /** HTTPS URL of the community catalog API. */
  endpoint?: string
  /** Maximum duration of one catalog read, in milliseconds. */
  timeoutMs?: number
  /** Maximum decoded response body size, in bytes. */
  maxResponseBytes?: number
}

export type * from '../types.ts'

/** Return a page from the public catalog without interpreting its install command. */
export class PluginCatalog extends TypertRemoteService {
  static Config = z.object({
    endpoint: z.string().default(CATALOG_URL),
    timeoutMs: z.number().step(1).min(1000).max(60000).default(15000),
    maxResponseBytes: z.number().step(1).min(1024).max(8 * 1024 * 1024).default(2 * 1024 * 1024),
  })

  private readonly endpoint: URL
  private readonly timeoutMs: number
  private readonly maxResponseBytes: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'pluginCatalog')
    this.endpoint = new URL(config.endpoint ?? CATALOG_URL)
    if (this.endpoint.protocol !== 'https:' || this.endpoint.username !== '' || this.endpoint.password !== '') {
      throw new Error('Plugin catalog endpoint must be an HTTPS URL without credentials.')
    }
    this.timeoutMs = config.timeoutMs ?? 15000
    this.maxResponseBytes = config.maxResponseBytes ?? 2 * 1024 * 1024
  }

  /** Read listings, category totals and page metadata using the site's API filters.
   * @param query Search text, limited to 120 characters.
   * @param category Catalog category id, or `all`.
   * @param sort One of the site's supported ranking modes.
   * @param page One-based result page.
   * @param limit Requested page size, capped at 100.
   * @returns Validated catalog rows and live API metadata.
   */
  @Remote
  async catalog(query?: string, category?: string, sort?: PluginCatalogSort, page?: number, limit?: number): Promise<PluginCatalogPage> {
    const selectedQuery = (query ?? '').trim().slice(0, 120)
    const selectedCategory = category ?? 'all'
    const selectedSort = sort ?? 'stars'
    const selectedPage = integer(page ?? 1, 1, 1, 10000)
    const selectedLimit = integer(limit ?? 20, 20, 1, 100)
    if (!SORTS.has(selectedSort)) throw new Error(`Unsupported plugin catalog sort: ${selectedSort}.`)
    const url = new URL(this.endpoint)
    if (selectedQuery !== '') url.searchParams.set('q', selectedQuery)
    if (selectedCategory !== 'all') url.searchParams.set('category', selectedCategory)
    url.searchParams.set('sort', selectedSort)
    url.searchParams.set('page', String(selectedPage))
    url.searchParams.set('limit', String(selectedLimit))
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs), headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`Plugin catalog returned HTTP ${String(response.status)}.`)
    const body = await readJson(response, this.maxResponseBytes)
    return catalogPage(body)
  }
}

export default PluginCatalog

function integer(value: number, fallback: number, minimum: number, maximum: number): number {
  return Number.isSafeInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function text(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined }
function boundedText(value: unknown, maximum: number): string | undefined {
  const result = text(value)
  return result !== undefined && result.length <= maximum ? result : undefined
}
function count(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined }

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredBytes = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) throw new Error('Plugin catalog response exceeded its configured size limit.')
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('Plugin catalog returned no response body.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        try { await reader.cancel() }
        catch (error) { /* Retain the size-limit diagnostic if stream cancellation fails. */ void error }
        throw new Error('Plugin catalog response exceeded its configured size limit.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    return parsed
  } catch (error) {
    throw new Error('Plugin catalog returned invalid JSON.', { cause: error })
  }
}

function catalogPage(value: unknown): PluginCatalogPage {
  const body = record(value)
  if (body === undefined || !Array.isArray(body.plugins) || !Array.isArray(body.categories)) {
    throw new Error('Plugin catalog returned an invalid response.')
  }
  const plugins = body.plugins.flatMap((value) => {
    const row = record(value)
    const description = record(row?.description)
    const id = boundedText(row?.id, 256), name = boundedText(row?.name, 120), owner = boundedText(row?.owner, 100)
    const url = githubUrl(boundedText(row?.url, 2048))
    const category = boundedText(row?.category, 80), rawInstall = boundedText(row?.install, 2048), added = boundedText(row?.added, 40)
    const install = rawInstall === undefined ? undefined : normalizeCatalogInstall(rawInstall)
    const stars = count(row?.stars), installCount = count(row?.installCount)
    const en = boundedText(description?.en, 2000), zh = boundedText(description?.zh, 2000)
    if (id === undefined || name === undefined || owner === undefined || url === undefined || category === undefined
      || install === undefined || !matchesCatalogRepository(install, url) || added === undefined
      || stars === undefined || installCount === undefined || en === undefined || zh === undefined) return []
    return [{
      id, name, owner, url, category, description: { en, zh }, install, added, stars, installCount,
      npmDownloads7d: count(row?.npmDownloads7d) ?? null,
      pushedAt: boundedText(row?.pushedAt, 40) ?? '', updatedAt: boundedText(row?.updatedAt, 40) ?? '',
    }]
  })
  const categories = body.categories.flatMap((value) => {
    const row = record(value)
    const id = boundedText(row?.id, 80), en = boundedText(row?.en, 120), zh = boundedText(row?.zh, 120), categoryCount = count(row?.count)
    return id === undefined || en === undefined || zh === undefined || categoryCount === undefined
      ? [] : [{ id, en, zh, count: categoryCount }]
  })
  const total = count(body.total), totalPages = count(body.totalPages)
  if (total === undefined || totalPages === undefined) throw new Error('Plugin catalog omitted page totals.')
  return { plugins, categories, total, totalPages, page: count(body.page) ?? 1, limit: count(body.limit) ?? plugins.length }
}

function githubUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' && url.username === '' && url.password === ''
      ? url.href : undefined
  } catch { return undefined }
}
