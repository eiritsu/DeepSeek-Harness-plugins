/** Provider-neutral model metadata sourced from the models.dev catalog. */

import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { DomainGlobal } from '@deepseek-ai/dsh-storage-domain'
import type { LlmModelMetadata, LlmModelMetadataRequest, ModelModality } from '@deepseek-ai/dsh-llm'
import { CATALOG_MODEL_METADATA_PRIORITY } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'

/** Default catalog document. */
export const DEFAULT_CATALOG_URL = 'https://models.dev/catalog.json?type=all'
/** Successful refresh freshness interval. */
export const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000
/** Maximum wait for one catalog request. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
/** Maximum response body size in bytes. */
export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/** One route-local model name mapped to a canonical models.dev record. */
export interface ModelMapping {
  /** Optional upstream owner required to select this mapping. */
  ownedBy?: string
  /** Local model identifier returned by the provider route. */
  modelId: string
  /** Qualified canonical identifier from models.dev. */
  canonicalId: string
}

/** Refresh and response limits for the external model catalog. */
export interface Config {
  /** JSON catalog URL using the canonical models.dev catalog document. */
  catalogURL?: string
  /** Explicit local model identities mapped to canonical models.dev IDs. */
  modelMappings?: ModelMapping[]
  /** Time a successful snapshot remains fresh. */
  refreshIntervalMs?: number
  /** Request timeout in milliseconds. */
  requestTimeoutMs?: number
  /** Actual response body limit in bytes. */
  maxResponseBytes?: number
}

/** Validated plugin configuration. */
export const Config: schema<Config> = schema.object({
  catalogURL: schema.string().default(DEFAULT_CATALOG_URL),
  modelMappings: schema.array(schema.object({
    ownedBy: schema.string().description('Optional upstream owner that selects this route mapping.'),
    modelId: schema.string().required().description('Local model identifier returned by the provider route.'),
    canonicalId: schema.string().required().description('Qualified canonical model identifier from models.dev.'),
  })).default([]),
  refreshIntervalMs: schema.number().step(1).min(1).default(DEFAULT_REFRESH_INTERVAL_MS),
  requestTimeoutMs: schema.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
  maxResponseBytes: schema.number().step(1).min(1).default(DEFAULT_MAX_RESPONSE_BYTES),
})

const modality = z.enum(['text', 'image', 'audio', 'video', 'pdf'])
const canonicalSchema = z.object({
  id: z.string().min(1),
  input: z.array(modality).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  reasoning: z.boolean().optional(),
})
const providerEffortSchema = z.object({ namespace: z.string().min(1), modelId: z.string().min(1), efforts: z.array(z.string().min(1)) })
const legacyDeclarationSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
  input: z.array(modality).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  reasoningEfforts: z.array(z.string().min(1)).optional(),
})
const cacheSchema = z.object({
  format: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  checkedAt: z.number().int().nonnegative(),
  catalogURL: z.string().optional(),
  canonical: z.array(canonicalSchema).default([]),
  providerEfforts: z.array(providerEffortSchema).default([]),
  providers: z.array(z.object({ id: z.string(), api: z.string().optional() })).optional(),
  declarations: z.array(legacyDeclarationSchema).optional(),
})
type CanonicalModel = z.infer<typeof canonicalSchema>
type ProviderEffort = z.infer<typeof providerEffortSchema>
type Cache = z.infer<typeof cacheSchema>

const domainSpec = defineDomain({
  name: 'model_catalog',
  version: 1,
  compatibleVersions: [0],
  global: {
    schema: cacheSchema,
    initial: { format: 3 as const, checkedAt: 0, catalogURL: DEFAULT_CATALOG_URL, canonical: [], providerEfforts: [] },
  },
  tables: {},
})

/** Parse canonical model metadata and provider-scoped reasoning declarations.
 * @param value - the decoded models.dev document.
 * @returns canonical models and effort declarations keyed by their namespace.
 */
export function parseCatalog(value: unknown): { canonical: CanonicalModel[]; providerEfforts: ProviderEffort[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('models.dev catalog must be an object')
  }
  const document = value as { models?: unknown; providers?: unknown }
  if (typeof document.models !== 'object' || document.models === null || Array.isArray(document.models)
    || typeof document.providers !== 'object' || document.providers === null || Array.isArray(document.providers)) {
    throw new Error('models.dev catalog must contain models and providers objects')
  }
  const canonical: CanonicalModel[] = []
  for (const [id, modelValue] of Object.entries(document.models)) {
    if (typeof modelValue !== 'object' || modelValue === null || Array.isArray(modelValue)) continue
    const model = modelValue as {
      id?: unknown
      modalities?: { input?: unknown }
      limit?: { context?: unknown; output?: unknown }
      reasoning?: unknown
    }
    if (typeof model.id !== 'string' || model.id !== id || !id.includes('/')) continue
    const input = Array.isArray(model.modalities?.input)
      ? model.modalities.input.filter((item): item is z.infer<typeof modality> => modality.safeParse(item).success)
      : undefined
    const contextWindow = positiveInteger(model.limit?.context)
    const maxOutputTokens = positiveInteger(model.limit?.output)
    if (input === undefined && contextWindow === undefined && maxOutputTokens === undefined && typeof model.reasoning !== 'boolean') continue
    canonical.push({
      id,
      ...(input === undefined ? {} : { input }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(typeof model.reasoning === 'boolean' ? { reasoning: model.reasoning } : {}),
    })
  }
  if (canonical.length === 0) throw new Error('models.dev catalog contains no valid canonical model records')
  const providerEfforts: ProviderEffort[] = []
  for (const [namespace, providerValue] of Object.entries(document.providers)) {
    if (typeof providerValue !== 'object' || providerValue === null || Array.isArray(providerValue)) continue
    const provider = providerValue as { models?: unknown }
    if (typeof provider.models !== 'object' || provider.models === null || Array.isArray(provider.models)) continue
    for (const [modelId, modelValue] of Object.entries(provider.models)) {
      if (typeof modelValue !== 'object' || modelValue === null || Array.isArray(modelValue)) continue
      const model = modelValue as { reasoning_options?: unknown; reasoning?: unknown }
      const efforts = parseEfforts(model.reasoning_options, model.reasoning)
      if (efforts !== undefined) providerEfforts.push({ namespace, modelId, efforts })
    }
  }
  return { canonical, providerEfforts }
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined
}

function parseEfforts(value: unknown, reasoning: unknown): string[] | undefined {
  if (reasoning === false) return []
  if (!Array.isArray(value)) return undefined
  if (value.length === 0) return []
  const values = new Set<string>()
  let declared = false
  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const option = item as { type?: unknown; values?: unknown }
    if (option.type !== 'effort' || !Array.isArray(option.values)) continue
    declared = true
    for (const effort of option.values) if (typeof effort === 'string' && effort.length > 0) values.add(effort)
  }
  if (!declared) return undefined
  return [...values]
}

/** Read a response body under the configured byte limit. */
async function readJson(response: Response, limit: number): Promise<unknown> {
  if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`)
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error('models.dev returned no response body')
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error(`models.dev response exceeded ${limit} bytes`)
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes))
}

/** Cache-backed canonical model metadata resolver. */
export class ModelCatalog {
  private cache: Cache
  private pending: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly global: DomainGlobal<Cache>,
    private readonly config: Required<Config>,
  ) {
    const cached = global.get()
    this.cache = cached.format >= 2
      ? cached
      : { format: 2, checkedAt: 0, canonical: [], providerEfforts: [] }
  }

  /** Refresh stale data; a failed request keeps the last persisted snapshot.
   * @param signal - optional cancellation signal for this refresh caller.
   */
  async refresh(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.cache.catalogURL === this.config.catalogURL
      && Date.now() - this.cache.checkedAt < this.config.refreshIntervalMs) return
    this.pending ??= this.fetchAndStore().finally(() => { this.pending = undefined })
    try {
      await this.pending
    } catch (error) {
      this.ctx.logger.warn(`model-catalog refresh failed; keeping last-good metadata: ${errorMessage(error)}`)
    }
    signal?.throwIfAborted()
  }

  /** Return metadata for an explicit mapping, exact qualified ID, or unique basename.
   * @param request - the model identity, owner, and endpoint to resolve.
   * @returns resolved shared metadata, or \`undefined\` when no declaration matches.
   */
  resolve(request: LlmModelMetadataRequest): LlmModelMetadata | undefined {
    const candidates = this.config.modelMappings.filter(mapping => equalId(mapping.modelId, request.model))
    const ownedBy = request.ownedBy
    const exactMappings = ownedBy === undefined ? [] : candidates.filter(mapping =>
      mapping.ownedBy !== undefined && equalId(mapping.ownedBy, ownedBy))
    const mappings = exactMappings.length > 0 ? exactMappings : candidates.filter(mapping => mapping.ownedBy === undefined)
    if (mappings.length > 1) return undefined
    const mapping = mappings[0]
    const model = mapping === undefined
      ? findCanonical(this.cache.canonical, request.model)
      : this.cache.canonical.find(entry => equalId(entry.id, mapping.canonicalId))
    if (model === undefined) return undefined
    const separator = model.id.indexOf('/')
    const namespace = separator < 0 ? undefined : model.id.slice(0, separator)
    const modelId = separator < 0 ? model.id : model.id.slice(separator + 1)
    const provider = namespace === undefined ? undefined : this.cache.providerEfforts.find(entry =>
      equalId(entry.namespace, namespace) && equalId(entry.modelId, modelId))
    const reasoningEfforts = model.reasoning === false ? [] : provider?.efforts
    const input = model.input?.filter((value): value is ModelModality => value === 'text' || value === 'image')
    const result: LlmModelMetadata = {
      ...(input === undefined ? {} : { inputModalities: input }),
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model.maxOutputTokens === undefined ? {} : { maxOutputTokens: model.maxOutputTokens }),
      ...(reasoningEfforts === undefined ? {} : { reasoningEfforts }),
    }
    return Object.keys(result).length === 0 ? undefined : result
  }

  private async fetchAndStore(): Promise<void> {
    const response = await fetch(this.config.catalogURL, {
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      headers: { accept: 'application/json' },
    })
    const parsed = parseCatalog(await readJson(response, this.config.maxResponseBytes))
    const cache: Cache = {
      format: 3,
      checkedAt: Date.now(),
      catalogURL: this.config.catalogURL,
      ...parsed,
    }
    await this.global.set(cache)
    this.cache = cache
  }
}

function equalId(left: string, right: string): boolean { return left.toLowerCase() === right.toLowerCase() }

function validateMappings(mappings: readonly ModelMapping[]): void {
  const keys = new Set<string>()
  for (const mapping of mappings) {
    const separator = mapping.canonicalId.indexOf('/')
    if (mapping.modelId.trim() === '' || mapping.ownedBy?.trim() === ''
      || separator < 1 || separator === mapping.canonicalId.length - 1) {
      throw new Error('modelMappings entries require a modelId and a qualified canonicalId')
    }
    const key = `${mapping.ownedBy?.toLowerCase() ?? '*'}\0${mapping.modelId.toLowerCase()}`
    if (keys.has(key)) throw new Error(`modelMappings contains conflicting entries for '${mapping.modelId}'`)
    keys.add(key)
  }
}

function findCanonical(models: readonly CanonicalModel[], id: string): CanonicalModel | undefined {
  const normalized = id.toLowerCase()
  const exact = models.filter(model => model.id.toLowerCase() === normalized)
  if (exact.length > 0 || id.includes('/')) return exact.length === 1 ? exact[0] : undefined
  const matches = models.filter(model => model.id.slice(model.id.indexOf('/') + 1).toLowerCase() === normalized)
  return matches.length === 1 ? matches[0] : undefined
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** Cordis plugin name. */
export const name = 'model-catalog'
/** Requires the LLM service and persistent model metadata storage. */
export const inject = ['llm', 'storageDomain']

/** Mount the bounded, persisted models.dev catalog and register its resolver. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  validateMappings(config.modelMappings ?? [])
  const domain = await ctx.storageDomain.open(domainSpec)
  ctx.effect(() => () => { void domain.close() }, 'model-catalog.domain-close')
  const catalog = new ModelCatalog(ctx, domain.global, {
    catalogURL: config.catalogURL ?? DEFAULT_CATALOG_URL,
    modelMappings: config.modelMappings ?? [],
    refreshIntervalMs: config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxResponseBytes: config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  })
  ctx.effect(() => ctx.llm.registerModelMetadataResolver(async (request) => {
    await catalog.refresh(request.signal)
    return catalog.resolve(request)
  }, { priority: CATALOG_MODEL_METADATA_PRIORITY }), 'model-catalog.metadata-resolver')
  ctx.effect(() => ctx.llm.registerModelMetadataSnapshotResolver(
    request => catalog.resolve(request),
    { priority: CATALOG_MODEL_METADATA_PRIORITY },
  ), 'model-catalog.metadata-snapshot-resolver')
  void catalog.refresh().catch((error: unknown) => {
    ctx.logger.warn(`model-catalog initial refresh failed; keeping last-good metadata: ${errorMessage(error)}`)
  })
}
