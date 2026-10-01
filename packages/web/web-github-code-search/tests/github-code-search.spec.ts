import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as GitHubCodeSearch from '@deepseek-ai/dsh-web-github-code-search'
import { mapGitHubCodeSearchResponse } from '@deepseek-ai/dsh-web-github-code-search'

/** Absolute request URL from any fetch input form a mock recorded. */
function toURL(input: RequestInfo | URL | undefined): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return new URL(input.href)
  if (input === undefined) throw new Error('The fetch mock recorded no request input.')
  return new URL(input.url)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function mount(config: GitHubCodeSearch.Config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-github-code-search-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  const fiber = await ctx.plugin(GitHubCodeSearch, config)
  let callIndex = 0
  return {
    ctx,
    fiber,
    dir,
    call: (query: string, maxResults?: number, signal: AbortSignal = new AbortController().signal) => ctx.tools.execute({
      callId: ToolCallId(`github-code-search-${++callIndex}`),
      name: 'github_code_search',
      arguments: { query, ...(maxResults === undefined ? {} : { maxResults }) },
      signal,
    }),
  }
}

afterEach(() => vi.unstubAllGlobals())

interface ReceivedRequest {
  readonly headers: IncomingMessage['headers']
}

const targetRequests: ReceivedRequest[] = []
let redirectOrigin: string
let targetOrigin: string

const redirectTarget = createServer((request, response) => {
  targetRequests.push({ headers: request.headers })
  request.resume()
  response.writeHead(204).end()
})

const redirectSource = createServer((request, response) => {
  request.resume()
  response.writeHead(302, { location: `${targetOrigin}/collect` }).end()
})

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
}

beforeAll(async () => {
  targetOrigin = await listen(redirectTarget)
  redirectOrigin = await listen(redirectSource)
})

afterAll(async () => {
  await Promise.all([close(redirectSource), close(redirectTarget)])
})

describe('GitHub code search', () => {
  it('maps only useful code match fields and discards malformed items', () => {
    expect(mapGitHubCodeSearchResponse({
      total_count: 2,
      items: [
        {
          name: 'index.ts', path: 'src/index.ts', html_url: 'https://github.com/a/b/blob/main/src/index.ts',
          repository: { full_name: 'a/b', html_url: 'https://github.com/a/b', private: true },
          text_matches: [{ fragment: 'export function run()' }, { fragment: 42 }],
          secret: 'discard',
        },
        { name: 'invalid' },
      ],
      incomplete_results: false,
    })).toEqual({
      totalCount: 2,
      results: [{
        name: 'index.ts', path: 'src/index.ts', url: 'https://github.com/a/b/blob/main/src/index.ts',
        repository: 'a/b', repositoryURL: 'https://github.com/a/b', snippets: ['export function run()'],
      }],
    })
  })

  it('bounds snippet count and Unicode character budgets without changing the result structure', () => {
    expect(mapGitHubCodeSearchResponse({
      total_count: 2,
      items: [
        {
          name: 'first.ts', path: 'first.ts', html_url: 'https://github.com/a/b/blob/main/first.ts',
          text_matches: [{ fragment: '😀abcdef' }, { fragment: 'ignored' }],
        },
        {
          name: 'second.ts', path: 'second.ts', html_url: 'https://github.com/a/b/blob/main/second.ts',
          text_matches: [{ fragment: 'later' }],
        },
      ],
    }, { maxSnippets: 2, maxSnippetChars: 3, maxTotalSnippetChars: 5 })).toEqual({
      totalCount: 2,
      results: [
        { name: 'first.ts', path: 'first.ts', url: 'https://github.com/a/b/blob/main/first.ts', snippets: ['😀ab', 'ig'] },
        { name: 'second.ts', path: 'second.ts', url: 'https://github.com/a/b/blob/main/second.ts' },
      ],
    })
  })

  it('registers the optional tool, sends GitHub API headers, and resolves token rotation per call', async () => {
    const bench = await mount({ baseURL: 'https://github.test/api/v3/' })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ total_count: 1, items: [{
      name: 'main.ts', path: 'src/main.ts', html_url: 'https://github.test/a/b/blob/main/src/main.ts',
      repository: { full_name: 'a/b', html_url: 'https://github.test/a/b' },
    }] }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await bench.ctx.credentials.set(credentialRef('GITHUB_TOKEN'), 'first-secret')
      const first = await bench.call('repo:a/b language:typescript auth')
      await bench.ctx.credentials.set(credentialRef('GITHUB_TOKEN'), 'rotated-secret')
      const second = await bench.call('repo:a/b language:typescript auth', 3)
      expect(first.isError).toBe(false)
      expect(second.isError).toBe(false)
      expect(bench.ctx.tools.get('github_code_search')?.timeoutMs).toBe(GitHubCodeSearch.GITHUB_CODE_SEARCH_DEFAULT_REQUEST_TIMEOUT_MS)
      const [firstInput, firstInit] = fetchMock.mock.calls[0] ?? []
      const [secondInput, secondInit] = fetchMock.mock.calls[1] ?? []
      const firstURL = toURL(firstInput)
      expect(firstURL.origin).toBe('https://github.test')
      expect(firstURL.pathname).toBe('/api/v3/search/code')
      expect(firstURL.searchParams.get('q')).toBe('repo:a/b language:typescript auth')
      expect(firstURL.searchParams.get('per_page')).toBe('5')
      expect(new Headers(firstInit?.headers).get('accept')).toBe('application/vnd.github.text-match+json')
      expect(new Headers(firstInit?.headers).get('authorization')).toBe('Bearer first-secret')
      expect(new Headers(firstInit?.headers).get('X-GitHub-Api-Version')).toBe('2022-11-28')
      expect(firstInit?.redirect).toBe('error')
      expect(toURL(secondInput).searchParams.get('per_page')).toBe('3')
      expect(new Headers(secondInit?.headers).get('authorization')).toBe('Bearer rotated-secret')
    } finally {
      await bench.fiber.dispose()
      expect(bench.ctx.tools.get('github_code_search')).toBeUndefined()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('fails clearly when the credential is missing', async () => {
    const bench = await mount()
    try {
      const result = await bench.call('test')
      expect(result).toMatchObject({ isError: true, content: [{ text: 'Error: GitHub credential GITHUB_TOKEN is not configured' }] })
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('does not include lower-level request errors in tool output', async () => {
    const bench = await mount()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Authorization: Bearer credential-secret') }))
    try {
      await bench.ctx.credentials.set(credentialRef('GITHUB_TOKEN'), 'credential-secret')
      const result = await bench.call('test')
      expect(result).toMatchObject({ isError: true, content: [{ text: 'Error: GitHub code search request failed' }] })
      expect(JSON.stringify(result)).not.toContain('credential-secret')
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('rejects blank queries and invalid result limits before making requests', async () => {
    const bench = await mount()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    try {
      await bench.ctx.credentials.set(credentialRef('GITHUB_TOKEN'), 'secret')
      await expect(bench.call('  ')).resolves.toMatchObject({ isError: true, content: [{ text: 'Error: query must not be empty' }] })
      await expect(bench.call('test', 101)).resolves.toMatchObject({ isError: true, content: [{ text: expect.stringContaining('maxResults must be a whole number') as string }] })
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('does not forward the token after a redirect and reports only the HTTP status', async () => {
    const bench = await mount()
    const fetchMock = vi.fn(async () => new Response('redirect body may contain secrets', { status: 302, headers: { location: 'https://attacker.test/' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await bench.ctx.credentials.set(credentialRef('GITHUB_TOKEN'), 'secret')
      const result = await bench.call('test')
      expect(result).toMatchObject({ isError: true, content: [{ text: 'Error: GitHub code search returned HTTP 302' }] })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(JSON.stringify(result)).not.toContain('secret')
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('uses native fetch redirect rejection before the target receives credentials', async () => {
    const bench = await mount()
    targetRequests.length = 0
    const nativeFetch = globalThis.fetch
    const fetchAdapter = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const requestURL = toURL(input)
      requestURL.host = new URL(redirectOrigin).host
      requestURL.protocol = 'http:'
      return nativeFetch(requestURL, init)
    })
    vi.stubGlobal('fetch', fetchAdapter)
    try {
      await bench.ctx.credentials.set(credentialRef('GITHUB_TOKEN'), 'must-not-leak')
      const result = await bench.call('repo:private/project sensitive-query')
      expect(result).toMatchObject({ isError: true })
      expect(fetchAdapter).toHaveBeenCalledOnce()
      expect(fetchAdapter.mock.calls[0]?.[1]?.redirect).toBe('error')
      expect(targetRequests).toHaveLength(0)
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('propagates cancellation to the request', async () => {
    const bench = await mount()
    const controller = new AbortController()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const abort = () =>{  reject(new DOMException('aborted', 'AbortError')) }
      if (init?.signal?.aborted) abort()
      else init?.signal?.addEventListener('abort', abort, { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await bench.ctx.credentials.set(credentialRef('GITHUB_TOKEN'), 'secret')
      const pending = bench.call('test', undefined, controller.signal)
      await vi.waitFor(() =>{  expect(fetchMock).toHaveBeenCalledOnce() })
      controller.abort()
      await expect(pending).resolves.toMatchObject({ isError: true, content: [{ text: 'Error: GitHub code search request aborted' }] })
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('rejects HTTP errors and malformed responses without exposing upstream bodies', async () => {
    const bench = await mount()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'token secret invalid' }, 403))
      .mockResolvedValueOnce(new Response('{'))
      .mockResolvedValueOnce(jsonResponse({ items: 'invalid' }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await bench.ctx.credentials.set(credentialRef('GITHUB_TOKEN'), 'secret')
      const denied = await bench.call('test')
      const malformedJson = await bench.call('test')
      const malformedData = await bench.call('test')
      expect(denied).toMatchObject({ isError: true, content: [{ text: 'Error: GitHub code search returned HTTP 403' }] })
      expect(JSON.stringify(denied)).not.toContain('token secret invalid')
      expect(malformedJson).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('GitHub returned invalid JSON') as string }] })
      expect(malformedData).toMatchObject({ isError: true, content: [{ text: 'Error: GitHub returned no code search results array' }] })
    } finally {
      await bench.fiber.dispose()
      await rm(bench.dir, { recursive: true, force: true })
    }
  })

  it('rejects declared and streamed response bodies above the configured byte limit', async () => {
    const declared = await mount({ maxResponseBytes: 12 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"items":[]}', { headers: { 'content-length': '120' } })))
    try {
      await declared.ctx.credentials.set(credentialRef('GITHUB_TOKEN'), 'secret')
      await expect(declared.call('test')).resolves.toMatchObject({ isError: true, content: [{ text: 'Error: GitHub response exceeds maxResponseBytes (12)' }] })
    } finally {
      await declared.fiber.dispose()
      await rm(declared.dir, { recursive: true, force: true })
    }

    const streamed = await mount({ maxResponseBytes: 12 })
    const bytes = new TextEncoder().encode('{"items": []}')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close() } }))))
    try {
      await streamed.ctx.credentials.set(credentialRef('GITHUB_TOKEN'), 'secret')
      await expect(streamed.call('test')).resolves.toMatchObject({ isError: true, content: [{ text: 'Error: GitHub response exceeds maxResponseBytes (12)' }] })
    } finally {
      await streamed.fiber.dispose()
      await rm(streamed.dir, { recursive: true, force: true })
    }
  })

  it('validates HTTPS API bases at plugin startup', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    expect(() =>{  GitHubCodeSearch.apply(ctx, { baseURL: 'http://api.github.com/' }) }).toThrow('baseURL must be HTTPS')
  })
})
