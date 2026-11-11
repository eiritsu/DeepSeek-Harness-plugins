import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FetchMock = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>
const { fetchMock, lookupMock } = vi.hoisted(() => ({ fetchMock: vi.fn<FetchMock>(), lookupMock: vi.fn() }))
vi.mock('undici', () => ({
  Agent: class { close(): Promise<void> { return Promise.resolve() } },
  fetch: fetchMock,
}))
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import { SkillCatalog } from '../src/host/skill-catalog.ts'

function requestUrl(input: URL | RequestInfo): URL {
  if (input instanceof URL) return input
  return new URL(typeof input === 'string' ? input : input.url)
}

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

afterEach(() => { fetchMock.mockReset(); lookupMock.mockReset() })

describe('GitHub skill index taxonomy loading', () => {
  it('loads categories ordered by count, caches them, and honors forceRefresh', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    let revision = 0
    fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
      const url = requestUrl(input)
      if (url.origin === 'https://raw.githubusercontent.com' && url.pathname === '/acme/skills/release/custom.json') {
        revision += 1
        return response([
          { id: 'one', path: 'skills/one', category: 'Security', name: 'One', risk: 'safe', date_added: '2026-03-01' },
          { id: 'two', path: 'skills/two', category: 'security', name: 'Two', risk: 'safe', date_added: '2026-03-02' },
          ...(revision > 1
            ? [{ id: 'three', path: 'skills/three', category: 'testing', name: 'Three', risk: 'safe', date_added: '2026-03-03' }]
            : [{ id: 'four', path: 'skills/four', category: 'development', name: 'Four' }]),
        ])
      }
      return response({}, 404)
    })

    const ctx = new Context()
    const catalog = new SkillCatalog(ctx, {
      indexRepo: 'acme/skills',
      indexRef: 'release',
      indexPath: 'custom.json',
      metadataCacheTtlMs: 60_000,
    })
    try {
      const first = await catalog.taxonomy()
      expect(first.indexRepo).toBe('acme/skills')
      expect(first.totalIndexed).toBe(3)
      expect(first.categories).toEqual([
        { id: 'security', count: 2 },
        { id: 'development', count: 1 },
      ])

      const cached = await catalog.taxonomy()
      expect(cached.totalIndexed).toBe(3)
      expect(fetchMock).toHaveBeenCalledOnce()

      const refreshed = await catalog.taxonomy(true)
      expect(refreshed.categories).toEqual([
        { id: 'security', count: 2 },
        { id: 'testing', count: 1 },
      ])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects empty or non-array GitHub index payloads cleanly', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockResolvedValueOnce(response({ skills: [] }))
    const ctx = new Context()
    const catalog = new SkillCatalog(ctx, {})
    try {
      await expect(catalog.taxonomy()).rejects.toMatchObject({ code: 'skill-catalog/source-unavailable' })
      fetchMock.mockResolvedValueOnce(response([{ id: 'bad', path: '../escape' }]))
      await expect(catalog.taxonomy(true)).rejects.toMatchObject({ code: 'skill-catalog/source-unavailable' })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
