import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginCatalog } from '../src/host/plugin-catalog.ts'

afterEach(() => { vi.unstubAllGlobals() })

const response = (
  options: { readonly url?: string; readonly install?: string; readonly bytes?: number; readonly status?: number } = {},
): Response => {
  const listing = {
    id: 'dsh-example', name: 'Example', owner: 'acme', url: options.url ?? 'https://github.com/acme/example',
    category: 'ui', description: { en: 'Example plugin', zh: '示例插件' }, install: options.install ?? 'dsh plugin --profile web add @acme/dsh-example',
    added: '2026-09-25', stars: 12, installCount: 3,
  }
  const body = JSON.stringify({ plugins: [listing], categories: [{ id: 'ui', en: 'UI Enhancement', zh: 'UI 增强', count: 1 }], total: 1, totalPages: 1, page: 1, limit: 20 })
  return new Response(options.bytes === undefined ? body : 'x'.repeat(options.bytes), { status: options.status ?? 200, headers: { 'content-type': 'application/json' } })
}

describe('PluginCatalog Remote', () => {
  it('sends the public filters and keeps only HTTPS GitHub listing URLs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response({ url: 'http://github.com/acme/example' }))
    vi.stubGlobal('fetch', fetch)
    const remote = new PluginCatalog(new Context(), { endpoint: 'https://catalog.example/api', timeoutMs: 1000, maxResponseBytes: 4096 })
    const result = await remote.catalog('  hello  ', 'ui', 'active', 4, 15)
    const url = new URL(fetch.mock.calls[0]![0] as URL)
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'hello', category: 'ui', sort: 'active', page: '4', limit: '15' })
    expect(result).toMatchObject({ plugins: [], categories: [{ id: 'ui', count: 1 }], total: 1, page: 1, limit: 20 })
  })

  it('caps invalid page inputs and rejects unsupported sort names', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response())
    vi.stubGlobal('fetch', fetch)
    const remote = new PluginCatalog(new Context(), {})
    await remote.catalog('', 'all', 'npm', 20000, -1)
    expect(Object.fromEntries(new URL(fetch.mock.calls[0]![0] as URL).searchParams)).toMatchObject({ page: '10000', limit: '1' })
    await expect(remote.catalog('', 'all', 'unexpected' as never)).rejects.toThrow('Unsupported plugin catalog sort')
  })

  it('rejects a declared or streamed response larger than the configured limit', async () => {
    const fetch = vi.fn(async () => response({ bytes: 2048 }))
    vi.stubGlobal('fetch', fetch)
    const remote = new PluginCatalog(new Context(), { maxResponseBytes: 1024 })
    await expect(remote.catalog()).rejects.toThrow('configured size limit')
  })

  it('drops a listing with an oversized install string before exposing it to the Client', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async () => response({ install: 'x'.repeat(2049) })))
    const remote = new PluginCatalog(new Context(), {})
    await expect(remote.catalog()).resolves.toMatchObject({ plugins: [], total: 1 })
  })

  it('normalizes one supported install target and drops invalid or mismatched targets', async () => {
    const installValues = [
      'dsh plugin --profile web add @acme/dsh-example',
      'github:acme/example#main',
      'https://github.com/acme/example.git',
      'github:someone-else/other#main',
      'npm install evil other',
      'npm install --ignore-scripts evil',
      'dsh plugin --profile web add https://example.com/acme/example',
    ]
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      const plugins = installValues.map((install, index) => ({
        id: `example-${index}`, name: 'Example', owner: 'acme', url: 'https://github.com/acme/example',
        category: 'ui', description: { en: 'Example plugin', zh: '示例插件' }, install,
        added: '2026-09-25', stars: 12, installCount: 3,
      }))
      return new Response(JSON.stringify({ plugins, categories: [], total: plugins.length, totalPages: 1, page: 1, limit: 20 }))
    })
    vi.stubGlobal('fetch', fetch)
    const remote = new PluginCatalog(new Context(), {})
    const result = await remote.catalog()
    expect(result.plugins.map(plugin => plugin.install)).toEqual([
      '@acme/dsh-example', 'github:acme/example#main', 'https://github.com/acme/example.git',
    ])
  })

  it('allows an npm target without claiming a repository match', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async () => response({
      url: 'https://github.com/acme/example', install: 'npm install @other/package@1.2.3',
    })))
    const remote = new PluginCatalog(new Context(), {})
    await expect(remote.catalog()).resolves.toMatchObject({ plugins: [{ install: '@other/package@1.2.3' }] })
  })

  it('fails for HTTP and malformed JSON responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ status: 503 })))
    const remote = new PluginCatalog(new Context(), {})
    await expect(remote.catalog()).rejects.toThrow('HTTP 503')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { headers: { 'content-type': 'application/json' } })))
    await expect(remote.catalog()).rejects.toThrow('invalid JSON')
  })

  it('rejects catalog endpoints without HTTPS or with embedded credentials', () => {
    expect(() => new PluginCatalog(new Context(), { endpoint: 'http://catalog.example/api' })).toThrow('HTTPS')
    expect(() => new PluginCatalog(new Context(), { endpoint: 'https://u:p@catalog.example/api' })).toThrow('HTTPS')
  })
})
