import { afterEach, describe, expect, it, vi } from 'vitest'
import { BraveSearchProvider, TavilySearchProvider } from '../src/provider.ts'
import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'

function requestUrl(input: URL | RequestInfo): string {
  if (input instanceof URL) return input.href
  return typeof input === 'string' ? input : input.url
}

function requestBody(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') throw new TypeError('Expected a JSON request body string')
  return body
}

function providerOptions(id: string, enabled = true) {
  const resolve = vi.fn(async (): Promise<ResolvedCredential | undefined> => ({ value: `${id}-secret`, source: 'file' }))
  const options = {
    credentials: { resolve },
    enabled: () => enabled,
    keyRef: () => `${id.toUpperCase()}_API_KEY`,
    baseURL: (): string => id === 'brave' ? 'https://brave.test' : 'https://tavily.test',
    maxResults: () => 4,
    credentialRef: (value: string) => value as CredentialRef,
  }
  return { options, resolve }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('optional search providers', () => {
  it('registers Brave through its own explicit provider id and maps citeable results', async () => {
    const { options } = providerOptions('brave')
    const provider = new BraveSearchProvider(options)
    const fetch = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => Response.json({ web: { results: [
      { title: 'Example', url: 'https://example.test', description: 'A result', published_date: '2026-01-01' },
    ] } }))
    vi.stubGlobal('fetch', fetch)

    await expect(provider.search({ query: 'query', maxResults: 2 })).resolves.toEqual({
      sources: [{ title: 'Example', url: 'https://example.test', snippet: 'A result', publishedAt: '2026-01-01' }], truncated: false,
    })
    expect(provider.id).toBe('brave')
    expect(fetch.mock.calls[0]?.[0]).toBeInstanceOf(URL)
    expect(requestUrl(fetch.mock.calls[0]![0])).toContain('count=2')
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Subscription-Token': 'brave-secret' })
  })

  it('sends the Tavily key as a Bearer token and maps provider content', async () => {
    const { options } = providerOptions('tavily')
    const provider = new TavilySearchProvider(options)
    const fetch = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => Response.json({ results: [
      { title: 'Example', url: 'https://example.test', content: 'A result' },
    ] }))
    vi.stubGlobal('fetch', fetch)

    await expect(provider.search({ query: 'query' })).resolves.toMatchObject({
      sources: [{ title: 'Example', url: 'https://example.test', snippet: 'A result' }],
    })
    expect(provider.id).toBe('tavily')
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: 'Bearer tavily-secret' })
    const body = requestBody(fetch.mock.calls[0]![1]?.body)
    expect(JSON.parse(body)).toMatchObject({ query: 'query', max_results: 4 })
    expect(body).not.toContain('tavily-secret')
  })

  it('caps vendor request limits at 20 and rejects malformed successful payloads', async () => {
    const brave = new BraveSearchProvider(providerOptions('brave').options)
    const tavily = new TavilySearchProvider(providerOptions('tavily').options)
    const fetch = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => Response.json({ web: { results: [] } }))
    vi.stubGlobal('fetch', fetch)
    await brave.search({ query: 'many', maxResults: 100 })
    expect(requestUrl(fetch.mock.calls[0]![0])).toContain('count=20')

    fetch.mockImplementationOnce(async () => Response.json({ results: [] }))
    await tavily.search({ query: 'many', maxResults: 100 })
    expect(JSON.parse(requestBody(fetch.mock.calls[1]![1]?.body))).toMatchObject({ max_results: 20 })

    fetch.mockImplementationOnce(async () => Response.json({ web: {} }))
    await expect(brave.search({ query: 'bad' })).rejects.toThrow('Brave returned an invalid response')
    fetch.mockImplementationOnce(async () => Response.json({ results: [{ title: 'missing url' }] }))
    await expect(tavily.search({ query: 'bad' })).rejects.toThrow('Tavily returned an invalid response')
  })

  it('maps aborts while reading either response body to WEB_ABORTED', async () => {
    const abort = new DOMException('cancelled', 'AbortError')
    const response = Response.json({})
    vi.spyOn(response, 'json').mockRejectedValue(abort)
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(new BraveSearchProvider(providerOptions('brave').options).search({ query: 'cancel' }))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
    await expect(new TavilySearchProvider(providerOptions('tavily').options).search({ query: 'cancel' }))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('keeps a disabled provider unavailable and refuses a missing credential without exposing a key', async () => {
    const disabled = new BraveSearchProvider(providerOptions('brave', false).options)
    expect(disabled.available()).toBe(false)
    const invalidEndpoint = providerOptions('brave').options
    invalidEndpoint.baseURL = () => 'ftp://brave.test'
    expect(new BraveSearchProvider(invalidEndpoint).available()).toBe(false)

    const { options } = providerOptions('tavily')
    options.credentials = { resolve: vi.fn(async () => undefined) }
    const provider = new TavilySearchProvider(options)
    await expect(provider.search({ query: 'query' })).rejects.toThrow('Tavily credential is not configured')
    expect(provider.available()).toBe(true)
  })
})
