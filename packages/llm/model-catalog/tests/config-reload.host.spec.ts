import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { Config, DEFAULT_CATALOG_URL, apply } from '../src/index.ts'

describe('model-catalog Loader config reload', () => {
  let context: Context | undefined

  afterEach(async () => {
    await context?.fiber.dispose()
    context = undefined
  })

  it('reapplies ordinary modelMappings changes and withdraws the previous resolver', async () => {
    const snapshot = {
      format: 3 as const,
      checkedAt: Date.now(),
      catalogURL: DEFAULT_CATALOG_URL,
      canonical: [
        { id: 'provider-a/model', contextWindow: 16_000, input: ['text'] as const },
        { id: 'provider-b/model', contextWindow: 128_000, input: ['text', 'image'] as const },
      ],
      providerEfforts: [],
    }
    const domain = {
      global: { get: () => snapshot, set: async () => {} },
      close: async () => {},
    }
    const open = vi.fn(async () => domain)
    const ctx = context = new Context()
    let llm: LlmRuntime | undefined
    ctx.provide('storageDomain', { open } as never)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Loader)
    await ctx.plugin({ name: 'model-catalog-test-reader', inject: ['llm'], apply: (pluginCtx) => { llm = pluginCtx.llm } })
    if (!llm) throw new Error('LLM service was not injected into the test reader')
    const runtime = llm
    ctx.loader.builtins['model-catalog-reload-test'] = { name: 'model-catalog', Config, inject: ['llm', 'storageDomain'], apply }

    const id = await ctx.loader.create({
      name: 'cordis:model-catalog-reload-test',
      config: {
        refreshIntervalMs: 60_000,
        modelMappings: [{ modelId: 'route-model', canonicalId: 'provider-a/model' }],
      },
    })
    await ctx.loader.await()
    expect(await runtime.resolveModelMetadata({ provider: 'custom', model: 'route-model' }))
      .toEqual({ inputModalities: ['text'], contextWindow: 16_000 })
    expect(runtime.resolveModelMetadataSnapshot({ provider: 'custom', model: 'route-model' }))
      .toEqual({ inputModalities: ['text'], contextWindow: 16_000 })

    await ctx.loader.update(id, {
      config: {
        refreshIntervalMs: 60_000,
        modelMappings: [{ modelId: 'route-model', canonicalId: 'provider-b/model' }],
      },
    })
    await ctx.loader.await()

    expect(open).toHaveBeenCalledTimes(2)
    expect(await runtime.resolveModelMetadata({ provider: 'custom', model: 'route-model' }))
      .toEqual({ inputModalities: ['text', 'image'], contextWindow: 128_000 })
    expect(runtime.resolveModelMetadataSnapshot({ provider: 'custom', model: 'route-model' }))
      .toEqual({ inputModalities: ['text', 'image'], contextWindow: 128_000 })

    ctx.loader.remove(id)
    await ctx.loader.await()
    expect(runtime.resolveModelMetadataSnapshot({ provider: 'custom', model: 'route-model' })).toEqual({})
  })
})
