import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as Firecrawl from '../src/host/firecrawl.ts'
import { mapFirecrawlResponse } from '../src/host/firecrawl.ts'
import { apply as applyConnections, type Config as ConnectionsConfig } from '../src/index.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function mount(config: Firecrawl.Config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-firecrawl-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  const fiber = await ctx.plugin(Firecrawl, config)
  let callIndex = 0
  return {
    ctx,
    fiber,
    dir,
    call: (url: string, signal: AbortSignal = new AbortController().signal) => ctx.tools.execute({
      callId: ToolCallId(`firecrawl-${++callIndex}`),
      name: 'firecrawl_extract',
      arguments: { url },
      signal,
    }),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Firecrawl extraction', () => {
  it('replaces the registered tool after volatile config updates and disposes the current registration', async () => {
    const ctx = new Context()
    const unregister = vi.fn()
    const register = vi.fn((_definition: ToolDefinition) => unregister)
    ctx.provide('web', { registerSearchProvider: vi.fn() } as never)
    ctx.provide('credentials', { resolve: vi.fn() } as never)
    ctx.provide('tools', { register } as never)
    const config = {
      braveEnabled: createVolatile(false), braveApiKeyRef: createVolatile('BRAVE_SEARCH_API_KEY'), braveBaseURL: createVolatile('https://brave.test'),
      tavilyEnabled: createVolatile(false), tavilyApiKeyRef: createVolatile('TAVILY_API_KEY'), tavilyBaseURL: createVolatile('https://tavily.test'),
      maxResults: createVolatile(5), firecrawlEnabled: createVolatile(false), firecrawlApiKeyRef: createVolatile('FIRECRAWL_API_KEY'),
      firecrawlBaseURL: createVolatile('https://api.firecrawl.dev'), firecrawlRequestTimeoutMs: createVolatile(30_000),
      firecrawlMaxResponseBytes: createVolatile(2_097_152), firecrawlMaxMarkdownChars: createVolatile(50_000),
    } satisfies ConnectionsConfig
    const fiber = await ctx.plugin({ apply: applyConnections }, config)
    await fiber.await()
    expect(register).not.toHaveBeenCalled()

    updateVolatile(config.firecrawlEnabled, createVolatile(true))
    ctx.emit('loader/volatile-update', [['firecrawlEnabled']])
    expect(register).toHaveBeenCalledOnce()
    expect(register.mock.calls[0]?.[0]).toMatchObject({ name: 'firecrawl_extract', timeoutMs: 30_000 })
    updateVolatile(config.firecrawlRequestTimeoutMs, createVolatile(12_000))
    ctx.emit('loader/volatile-update', [['firecrawlRequestTimeoutMs']])
    expect(unregister).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledTimes(2)
    expect(register.mock.calls[1]?.[0]).toMatchObject({ name: 'firecrawl_extract', timeoutMs: 12_000 })
    updateVolatile(config.firecrawlEnabled, createVolatile(false))
    ctx.emit('loader/volatile-update', [['firecrawlEnabled']])
    expect(unregister).toHaveBeenCalledTimes(2)
    expect(register).toHaveBeenCalledTimes(2)

    await fiber.dispose()
    expect(unregister).toHaveBeenCalledTimes(2)
  })

  it('maps markdown and selected metadata without forwarding arbitrary fields', () => {
    expect(mapFirecrawlResponse({
      success: true,
      data: { markdown: '# Page', metadata: { title: 'Page', sourceURL: 'https://a.test', secret: 'discard' } },
    })).toEqual({ markdown: '# Page', truncated: false, metadata: { title: 'Page', sourceURL: 'https://a.test' } })
  })

  it('registers the optional tool and sends the stored key and requested URL', async () => {
    const bench = await mount({ baseURL: 'https://firecrawl.test/v1/' })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ success: true, data: { markdown: 'Page', metadata: { title: 'A' } } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await bench.ctx.credentials.set(credentialRef('FIRECRAWL_API_KEY'), 'secret')
      const result = await bench.call('https://a.test/page')
      expect(result.isError).toBe(false)
      expect(bench.ctx.tools.get('firecrawl_extract')?.timeoutMs).toBe(Firecrawl.FIRECRAWL_DEFAULT_REQUEST_TIMEOUT_MS)
      expect(result.content).toEqual([{ type: 'text', text: '{\n  "markdown": "Page",\n  "truncated": false,\n  "metadata": {\n    "title": "A"\n  }\n}' }])
      const [input, init] = fetchMock.mock.calls[0]!
      expect(requestUrl(input)).toBe('https://firecrawl.test/v1/scrape')
      expect(init?.redirect).toBe('error')
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
      expect(init?.body).toBe(JSON.stringify({ url: 'https://a.test/page', formats: ['markdown'] }))
    } finally {
      await bench.fiber.dispose()
      expect(bench.ctx.tools.get('firecrawl_extract')).toBeUndefined()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('fails clearly when the credential is not configured', async () => {
    const bench = await mount()
    try {
      const result = await bench.call('https://a.test')
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([{ type: 'text', text: 'Error: Firecrawl credential FIRECRAWL_API_KEY is not configured' }])
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('reports HTTP errors without exposing the response body', async () => {
    const bench = await mount()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Bearer secret was rejected' }, 429)))
    try {
      await bench.ctx.credentials.set(credentialRef('FIRECRAWL_API_KEY'), 'secret')
      const result = await bench.call('https://a.test')
      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({ text: 'Error: Firecrawl API returned HTTP 429' })
      expect(JSON.stringify(result)).not.toContain('secret')
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('classifies malformed JSON and unsuccessful extraction as tool errors', async () => {
    const bench = await mount()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{'))
      .mockResolvedValueOnce(jsonResponse({ success: false, error: 'not extractable' }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await bench.ctx.credentials.set(credentialRef('FIRECRAWL_API_KEY'), 'secret')
      const malformed = await bench.call('https://a.test')
      const unsuccessful = await bench.call('https://a.test')
      const malformedText = malformed.content.find(item => item.type === 'text')?.text
      expect(malformed.isError).toBe(true)
      expect(malformedText).toContain('invalid JSON')
      expect(unsuccessful).toMatchObject({ isError: true, content: [{ text: 'Error: Firecrawl extraction failed or returned no Markdown content' }] })
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('propagates an in-flight tool cancellation to the Firecrawl request', async () => {
    const bench = await mount()
    const controller = new AbortController()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      const abort = () =>{  reject(new DOMException('aborted', 'AbortError')) }
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await bench.ctx.credentials.set(credentialRef('FIRECRAWL_API_KEY'), 'secret')
      const pending = bench.call('https://a.test', controller.signal)
      await vi.waitFor(() =>{  expect(fetchMock).toHaveBeenCalledOnce() })
      controller.abort()
      await expect(pending).resolves.toMatchObject({
        isError: true,
        content: [{ text: 'Error: Firecrawl request aborted' }],
      })
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('rejects non-http URLs before dispatch', async () => {
    const bench = await mount()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      await bench.ctx.credentials.set(credentialRef('FIRECRAWL_API_KEY'), 'secret')
      const result = await bench.call('file:///etc/passwd')
      expect(result.isError).toBe(true)
      expect(result.content[0]).toMatchObject({ text: 'Error: url must be an absolute HTTP or HTTPS URL' })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('truncates Markdown at the configured code-point limit and marks the result', async () => {
    const bench = await mount({ maxMarkdownChars: 5 })
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: { markdown: 'Hi 🌍 there' } })))
    try {
      await bench.ctx.credentials.set(credentialRef('FIRECRAWL_API_KEY'), 'secret')
      await expect(bench.call('https://a.test')).resolves.toMatchObject({
        isError: false,
        content: [{ text: '{\n  "markdown": "Hi 🌍 ",\n  "truncated": true\n}' }],
      })
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('rejects a declared or streamed body that exceeds maxResponseBytes', async () => {
    const declared = await mount({ maxResponseBytes: 20 })
    const declaredFetch = vi.fn(async () => new Response('{"success":true}', { headers: { 'content-length': '200' } }))
    vi.stubGlobal('fetch', declaredFetch)
    try {
      await declared.ctx.credentials.set(credentialRef('FIRECRAWL_API_KEY'), 'secret')
      const result = await declared.call('https://a.test')
      expect(result).toMatchObject({ isError: true, content: [{ text: 'Error: Firecrawl response exceeds maxResponseBytes (20)' }] })
    } finally {
      await declared.fiber.dispose()
      await rm(declared.dir, { recursive: true, force: true })
    }

    const streamed = await mount({ maxResponseBytes: 20 })
    const payload = new TextEncoder().encode(JSON.stringify({ success: true, data: { markdown: 'body too large' } }))
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(payload); controller.close() } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)))
    try {
      await streamed.ctx.credentials.set(credentialRef('FIRECRAWL_API_KEY'), 'secret')
      const result = await streamed.call('https://a.test')
      expect(result).toMatchObject({ isError: true, content: [{ text: 'Error: Firecrawl response exceeds maxResponseBytes (20)' }] })
    } finally {
      await streamed.fiber.dispose()
      await rm(streamed.dir, { recursive: true, force: true })
    }
  })
})

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href
  return typeof input === 'string' ? input : input.url
}
