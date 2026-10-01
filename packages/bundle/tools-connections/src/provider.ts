import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'

interface Options {
  credentials: Pick<CredentialProvider, 'resolve'>
  enabled(): boolean
  keyRef(): string
  baseURL(): string
  maxResults(): number
  credentialRef(value: string): CredentialRef
}

interface ApiSource {
  title?: unknown
  url?: unknown
  description?: unknown
  content?: unknown
  published_date?: unknown
}

/** Brave Search adapter registered under the official `ctx.web` provider API. */
export class BraveSearchProvider implements WebSearchProvider {
  readonly id = 'brave'
  constructor(private readonly options: Options) {}
  available(): boolean { return this.options.enabled() && isValidBaseURL(this.options.baseURL()) }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const key = await this.resolveKey()
    const url = new URL('/res/v1/web/search', this.options.baseURL())
    url.searchParams.set('q', request.query)
    url.searchParams.set('count', String(resultLimit(request.maxResults, this.options.maxResults())))
    let response: Response
    try {
      response = await fetch(url, { headers: { 'X-Subscription-Token': key, accept: 'application/json' }, redirect: 'error', ...(signal ? { signal } : {}) })
    } catch (error) {
      if (isAbort(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError('Brave search request failed', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) throw new WebError(`Brave search failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    try {
      const payload: unknown = await response.json()
      const results = nestedResults(payload, 'web')
      assertSources(results)
      return { sources: results.map(source => ({
        url: source.url,
        ...(typeof source.title === 'string' ? { title: source.title } : {}),
        ...(typeof source.description === 'string' ? { snippet: source.description } : {}),
        ...(typeof source.published_date === 'string' ? { publishedAt: source.published_date } : {}),
      })), truncated: false }
    } catch (error) {
      if (isAbort(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError('Brave returned an invalid response', 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  private async resolveKey(): Promise<string> {
    if (!this.options.enabled()) throw new WebError('Brave Search is disabled', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    const credential = await this.options.credentials.resolve(this.options.credentialRef(this.options.keyRef()))
    if (credential === undefined) throw new WebError('Brave Search credential is not configured', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    return credential.value
  }
}

/** Tavily adapter registered under the official `ctx.web` provider API. */
export class TavilySearchProvider implements WebSearchProvider {
  readonly id = 'tavily'
  constructor(private readonly options: Options) {}
  available(): boolean { return this.options.enabled() && isValidBaseURL(this.options.baseURL()) }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const key = await this.resolveKey()
    let response: Response
    try {
      response = await fetch(new URL('/search', this.options.baseURL()), {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          query: request.query, max_results: resultLimit(request.maxResults, this.options.maxResults()), include_answer: false,
        }),
        redirect: 'error', ...(signal ? { signal } : {}),
      })
    } catch (error) {
      if (isAbort(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError('Tavily search request failed', 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) throw new WebError(`Tavily search failed (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
    try {
      const payload: unknown = await response.json()
      const results = topResults(payload)
      assertSources(results)
      return { sources: results.map(source => ({
        url: source.url,
        ...(typeof source.title === 'string' ? { title: source.title } : {}),
        ...(typeof source.content === 'string' ? { snippet: source.content } : {}),
        ...(typeof source.published_date === 'string' ? { publishedAt: source.published_date } : {}),
      })), truncated: false }
    } catch (error) {
      if (isAbort(error)) throw new WebError('Tavily search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError('Tavily returned an invalid response', 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  private async resolveKey(): Promise<string> {
    if (!this.options.enabled()) throw new WebError('Tavily is disabled', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    const credential = await this.options.credentials.resolve(this.options.credentialRef(this.options.keyRef()))
    if (credential === undefined) throw new WebError('Tavily credential is not configured', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    return credential.value
  }
}

function isSource(value: unknown): value is ApiSource & { url: string } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof Reflect.get(value, 'url') === 'string'
}

function topResults(payload: unknown): unknown[] {
  if (typeof payload !== 'object' || payload === null || !Array.isArray(Reflect.get(payload, 'results'))) {
    throw new TypeError('Missing results array')
  }
  return Reflect.get(payload, 'results') as unknown[]
}

function assertSources(results: unknown[]): asserts results is (ApiSource & { url: string })[] {
  if (!results.every(isSource)) throw new TypeError('Invalid search result')
}

function nestedResults(payload: unknown, key: string): unknown[] {
  if (typeof payload !== 'object' || payload === null) throw new TypeError('Missing web results')
  return topResults(Reflect.get(payload, key))
}

function resultLimit(requested: number | undefined, fallback: number): number {
  const value = requested ?? fallback
  if (!Number.isInteger(value) || value < 1) throw new WebError('Search result limit must be a positive integer', 'WEB_PROVIDER_ERROR')
  return Math.min(value, 20)
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isValidBaseURL(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.username.length === 0 && url.password.length === 0
}
