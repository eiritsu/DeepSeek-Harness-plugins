import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { apply, Config, DEFAULT_CATALOG_URL, ModelCatalog, parseCatalog } from '../src/index.ts'
import liveSubset from './fixtures/models-dev-2026-09-25.json' with { type: 'json' }

function catalogOf(value: unknown, modelMappings: { ownedBy?: string; modelId: string; canonicalId: string }[] = []): ModelCatalog {
  const parsed = parseCatalog(value)
  return new ModelCatalog(new Context(), {
    get: () => ({ format: 3, checkedAt: Date.now(), catalogURL: DEFAULT_CATALOG_URL, ...parsed }),
  } as never, {
    catalogURL: DEFAULT_CATALOG_URL,
    modelMappings,
    refreshIntervalMs: 60_000,
    requestTimeoutMs: 1_000,
    maxResponseBytes: 8_192,
  })
}

describe('models.dev canonical catalog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses canonical capability fields and separately records namespace-scoped effort fields', () => {
    const document = {
      models: {
        'zhipuai/glm-5.3-flash': {
          id: 'zhipuai/glm-5.3-flash', reasoning: true,
          modalities: { input: ['text', 'image', 'video', 'pdf', 'audio'] },
          limit: { context: 1_000_000, output: 131_072 },
        },
      },
      providers: {
        zhipuai: { models: { 'glm-5.3-flash': { reasoning: true, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max', 'custom'] }] } } },
      },
    }
    const parsed = parseCatalog(document)
    expect(parsed).toEqual({
      canonical: [{
        id: 'zhipuai/glm-5.3-flash', input: ['text', 'image', 'video', 'pdf', 'audio'],
        contextWindow: 1_000_000, maxOutputTokens: 131_072, reasoning: true,
      }],
      providerEfforts: [{ namespace: 'zhipuai', modelId: 'glm-5.3-flash', efforts: ['low', 'high', 'max', 'custom'] }],
    })
    expect(catalogOf(document).resolve({ provider: 'zhipuai', model: 'glm-5.3-flash' }))
      .toMatchObject({ reasoningEfforts: ['low', 'high', 'max', 'custom'] })
  })

  it('uses canonical GLM metadata for arbitrary channels without intersecting their provider limits', () => {
    const catalog = catalogOf(liveSubset)
    expect(catalog.resolve({ provider: 'my-custom-channel', model: 'glm-5.3-flash' }))
      .toEqual({
        inputModalities: ['text', 'image'], contextWindow: 1_000_000,
        maxOutputTokens: 131_072, reasoningEfforts: ['low', 'high', 'max'],
      })
  })

  it('overrides a default-priority local source with published values instead of failing the route', async () => {
    const snapshot = {
      format: 3 as const,
      checkedAt: Date.now(),
      catalogURL: DEFAULT_CATALOG_URL,
      canonical: [{
        id: 'zhipuai/glm-5.3-flash',
        contextWindow: 1_000_000,
        maxOutputTokens: 131_072,
        input: ['text', 'image'] as const,
      }],
      providerEfforts: [],
    }
    const domain = {
      global: { get: () => snapshot, set: async () => {} },
      close: async () => {},
    }
    const ctx = new Context()
    ctx.provide('storageDomain', { open: async () => domain } as never)
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerModelMetadataResolver(() => Promise.resolve({ contextWindow: 32_768, maxOutputTokens: 4_096 }))
    await apply(ctx, { refreshIntervalMs: 60_000 })

    expect(await ctx.llm.resolveModelMetadata({ provider: 'my-custom-channel', model: 'glm-5.3-flash' }))
      .toEqual({
        inputModalities: ['text', 'image'], contextWindow: 1_000_000,
        maxOutputTokens: 131_072,
      })
    await ctx.fiber.dispose()
  })

  it('uses explicit owner/model mapping before a canonical lookup and allows a distinct upstream namespace', () => {
    const catalog = catalogOf(liveSubset, [{
      ownedBy: 'custom-zhipu-route', modelId: 'glm-flash', canonicalId: 'zhipuai/glm-5.3-flash',
    }])
    expect(catalog.resolve({ provider: 'route', model: 'glm-flash', ownedBy: 'custom-zhipu-route' }))
      .toMatchObject({ contextWindow: 1_000_000, reasoningEfforts: ['low', 'high', 'max'] })
  })

  it('keeps Config fields directly inspectable and rejects duplicate mappings before opening storage', async () => {
    expect(Config.type).toBe('object')
    expect(Config.dict?.modelMappings?.inner?.dict?.canonicalId?.meta.description).toContain('canonical model identifier')
    await expect(apply(new Context(), { modelMappings: [
      { modelId: 'alias', canonicalId: 'vendor-a/model' },
      { modelId: 'ALIAS', canonicalId: 'vendor-b/model' },
    ] })).rejects.toThrow(/conflicting entries/)
  })

  it('uses an exact qualified canonical ID regardless of local provider or owner names', () => {
    const catalog = catalogOf(liveSubset)
    expect(catalog.resolve({ provider: 'zai-compatible', model: 'zhipuai/glm-5.3-flash', ownedBy: 'zai' }))
      .toMatchObject({ contextWindow: 1_000_000, maxOutputTokens: 131_072 })
  })

  it('resolves an unqualified ID only when its canonical basename is unique', () => {
    const catalog = catalogOf({
      models: {
        'vendor-a/shared': { id: 'vendor-a/shared', limit: { context: 100_000 } },
        'vendor-b/other': { id: 'vendor-b/other', limit: { output: 4_000 } },
      },
      providers: {},
    })
    expect(catalog.resolve({ provider: 'route', model: 'shared' })).toEqual({ contextWindow: 100_000 })
  })

  it('returns no metadata for ambiguous aliases rather than aggregating different providers', () => {
    const catalog = catalogOf({
      models: {
        'vendor-a/shared': { id: 'vendor-a/shared', modalities: { input: ['text'] }, limit: { context: 100_000, output: 20_000 } },
        'vendor-b/shared': { id: 'vendor-b/shared', modalities: { input: ['image'] }, limit: { context: 8_000, output: 2_000 } },
      },
      providers: {},
    })
    expect(catalog.resolve({ provider: 'custom', model: 'shared', baseURL: 'https://unrelated.example/v1' })).toBeUndefined()
    expect(catalog.resolve({ provider: 'custom', model: 'vendor-a/shared' }))
      .toEqual({ inputModalities: ['text'], contextWindow: 100_000, maxOutputTokens: 20_000 })
  })

  it('does not infer effort levels and retains source declarations without claiming execution', () => {
    const catalog = catalogOf({
      models: {
        'vendor-a/unknown': { id: 'vendor-a/unknown', reasoning: true },
        'vendor-a/disabled': { id: 'vendor-a/disabled', reasoning: false },
        'vendor-a/empty': { id: 'vendor-a/empty', reasoning: true },
        'vendor-a/unsupported': { id: 'vendor-a/unsupported', reasoning: true },
      },
      providers: {
        'vendor-a': { models: {
          empty: { reasoning_options: [] },
          unsupported: { reasoning_options: [{ type: 'effort', values: ['future-level'] }] },
        } },
      },
    })
    expect(catalog.resolve({ provider: 'route', model: 'vendor-a/unknown' })).toBeUndefined()
    expect(catalog.resolve({ provider: 'route', model: 'vendor-a/disabled' })).toEqual({ reasoningEfforts: [] })
    expect(catalog.resolve({ provider: 'route', model: 'vendor-a/empty' })).toEqual({ reasoningEfforts: [] })
    expect(catalog.resolve({ provider: 'route', model: 'vendor-a/unsupported' }))
      .toEqual({ reasoningEfforts: ['future-level'] })
  })

  it('keeps the last validated canonical cache when refresh fails', async () => {
    const initial = {
      format: 2 as const,
      checkedAt: 0,
      canonical: [{ id: 'vendor/model', contextWindow: 42 }],
      providerEfforts: [],
      mappings: [],
    }
    const set = vi.fn(async () => {})
    const catalog = new ModelCatalog(new Context(), { get: () => initial, set }, {
      catalogURL: DEFAULT_CATALOG_URL,
      modelMappings: [],
      refreshIntervalMs: 1,
      requestTimeoutMs: 1_000,
      maxResponseBytes: 8_192,
    })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    await catalog.refresh()

    expect(catalog.resolve({ provider: 'custom', model: 'vendor/model' })).toEqual({ contextWindow: 42 })
    expect(set).not.toHaveBeenCalled()
  })

  it('forces a refresh after the catalog URL changes even while the old snapshot is fresh', async () => {
    const initial = {
      format: 3 as const,
      checkedAt: Date.now(),
      catalogURL: 'https://old.example/catalog.json',
      canonical: [{ id: 'vendor/model', contextWindow: 42 }],
      providerEfforts: [],
    }
    const set = vi.fn(async () => {})
    const catalog = new ModelCatalog(new Context(), { get: () => initial, set }, {
      catalogURL: 'https://new.example/catalog.json',
      modelMappings: [],
      refreshIntervalMs: 86_400_000,
      requestTimeoutMs: 1_000,
      maxResponseBytes: 8_192,
    })
    const fetch = vi.fn(async () => new Response(JSON.stringify(liveSubset)))
    vi.stubGlobal('fetch', fetch)

    await catalog.refresh()

    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('https://new.example/catalog.json', expect.any(Object))
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      format: 3,
      catalogURL: 'https://new.example/catalog.json',
    }))
    expect(catalog.resolve({ provider: 'custom', model: 'glm-5.3-flash' }))
      .toMatchObject({ contextWindow: 1_000_000 })
  })

  it('reuses a fresh snapshot from the same catalog URL', async () => {
    const initial = {
      format: 3 as const,
      checkedAt: Date.now(),
      catalogURL: DEFAULT_CATALOG_URL,
      canonical: [{ id: 'vendor/model', contextWindow: 42 }],
      providerEfforts: [],
    }
    const catalog = new ModelCatalog(new Context(), { get: () => initial, set: vi.fn() }, {
      catalogURL: DEFAULT_CATALOG_URL,
      modelMappings: [],
      refreshIntervalMs: 86_400_000,
      requestTimeoutMs: 1_000,
      maxResponseBytes: 8_192,
    })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await catalog.refresh()

    expect(fetch).not.toHaveBeenCalled()
  })

  it('refreshes a fresh pre-source snapshot while retaining its canonical facts', async () => {
    const initial = {
      format: 2 as const,
      checkedAt: Date.now(),
      canonical: [{ id: 'vendor/model', contextWindow: 42 }],
      providerEfforts: [],
    }
    const set = vi.fn(async () => {})
    const catalog = new ModelCatalog(new Context(), { get: () => initial, set }, {
      catalogURL: DEFAULT_CATALOG_URL,
      modelMappings: [],
      refreshIntervalMs: 86_400_000,
      requestTimeoutMs: 1_000,
      maxResponseBytes: 8_192,
    })
    const fetch = vi.fn(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetch)

    await catalog.refresh()

    expect(fetch).toHaveBeenCalledOnce()
    expect(set).not.toHaveBeenCalled()
    expect(catalog.resolve({ provider: 'custom', model: 'vendor/model' })).toEqual({ contextWindow: 42 })
  })

  it('keeps old source facts after a changed-source failure without advancing its freshness', async () => {
    const initial = {
      format: 3 as const,
      checkedAt: Date.now(),
      catalogURL: 'https://old.example/catalog.json',
      canonical: [{ id: 'vendor/model', contextWindow: 42 }],
      providerEfforts: [],
    }
    const set = vi.fn(async () => {})
    const catalog = new ModelCatalog(new Context(), { get: () => initial, set }, {
      catalogURL: 'https://new.example/catalog.json',
      modelMappings: [],
      refreshIntervalMs: 86_400_000,
      requestTimeoutMs: 1_000,
      maxResponseBytes: 8_192,
    })
    const fetch = vi.fn(async () => { throw new Error('offline') })
    vi.stubGlobal('fetch', fetch)

    await catalog.refresh()
    await catalog.refresh()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(set).not.toHaveBeenCalled()
    expect(catalog.resolve({ provider: 'custom', model: 'vendor/model' })).toEqual({ contextWindow: 42 })
    expect(initial).toMatchObject({ catalogURL: 'https://old.example/catalog.json' })
  })

  it.each([
    ['wrong document format', () => new Response(JSON.stringify({ zhipuai: { models: {} } }))],
    ['empty canonical catalog', () => new Response(JSON.stringify({ models: {}, providers: {} }))],
    ['HTTP failure', () => new Response('unavailable', { status: 503 })],
    ['oversized response', () => new Response(JSON.stringify(liveSubset))],
  ])('keeps the last-good cache on %s', async (_label, makeResponse) => {
    const initial = {
      format: 2 as const,
      checkedAt: 0,
      canonical: [{ id: 'vendor/model', contextWindow: 42 }],
      providerEfforts: [],
    }
    const set = vi.fn(async () => {})
    const catalog = new ModelCatalog(new Context(), { get: () => initial, set }, {
      catalogURL: DEFAULT_CATALOG_URL,
      modelMappings: [],
      refreshIntervalMs: 1,
      requestTimeoutMs: 1_000,
      maxResponseBytes: _label === 'oversized response' ? 16 : 8_192,
    })
    vi.stubGlobal('fetch', vi.fn(async () => makeResponse()))

    await catalog.refresh()

    expect(catalog.resolve({ provider: 'custom', model: 'vendor/model' })).toEqual({ contextWindow: 42 })
    expect(set).not.toHaveBeenCalled()
  })

  it('does not start a refresh when its caller signal is already aborted', async () => {
    const catalog = catalogOf(liveSubset)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    controller.abort()

    await expect(catalog.refresh(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not apply the pre-canonical provider cache while its replacement refresh is unavailable', async () => {
    const legacy = {
      format: 1 as const,
      checkedAt: 0,
      providers: [{ id: 'route-a' }],
      declarations: [{ provider: 'route-a', id: 'shared', contextWindow: 9_000 }],
    }
    const set = vi.fn(async () => {})
    const catalog = new ModelCatalog(new Context(), { get: () => legacy, set } as never, {
      catalogURL: DEFAULT_CATALOG_URL,
      modelMappings: [],
      refreshIntervalMs: 60_000,
      requestTimeoutMs: 1_000,
      maxResponseBytes: 8_192,
    })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    await catalog.refresh()

    expect(catalog.resolve({ provider: 'route-a', model: 'shared' })).toBeUndefined()
    expect(set).not.toHaveBeenCalled()
  })
})
