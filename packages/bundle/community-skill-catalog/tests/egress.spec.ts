import { Context } from '@deepseek-ai/cordis'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FetchMock = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>
type PinnedLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) => void
const { fetchMock, lookupMock, agentLookups, proxyState } = vi.hoisted(() => ({
  fetchMock: vi.fn<FetchMock>(),
  lookupMock: vi.fn(),
  agentLookups: [] as (PinnedLookup | undefined)[],
  proxyState: { dispatcher: { close: async () => {} } },
}))
vi.mock('undici', () => ({
  Agent: class {
    constructor(options?: { readonly connect?: { readonly lookup?: PinnedLookup } }) {
      agentLookups.push(options?.connect?.lookup)
    }
    close(): Promise<void> { return Promise.resolve() }
  },
  Pool: class { close(): Promise<void> { return Promise.resolve() } },
  ProxyAgent: class { close(): Promise<void> { return Promise.resolve() } },
  getGlobalDispatcher: () => proxyState.dispatcher,
  setGlobalDispatcher: (dispatcher: { close: () => Promise<void> }) => { proxyState.dispatcher = dispatcher },
  fetch: fetchMock,
}))
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import { SkillsMpCatalog } from '../src/host/skillsmp-catalog.ts'

const SEARCH_RESPONSE = {
  success: true,
  data: { skills: [{ id: 'owner-skill', name: 'skill', author: 'owner', description: '', contentLanguage: 'en', githubUrl: 'https://github.com/owner/repo/tree/main/skill', skillUrl: 'https://skillsmp.com/creators/owner/repo/skill', stars: 1, updatedAt: 1 }], pagination: { page: 1, limit: 24, total: 1, totalPages: 1, hasNext: false, hasPrev: false, totalIsExact: true }, filters: { search: 'query', sortBy: 'stars' } },
  meta: {},
}
const COMMIT = 'a'.repeat(40)
const SKILL_TEXT = '---\nname: skill\ndescription: TUN routed skill.\n---\n\n# TUN routed skill\n'
const SKILL_BYTES = Buffer.from(SKILL_TEXT)
const DOWNLOAD_TARGET = { owner: 'owner', repo: 'repo', branch: 'main', path: 'skill' }
const DOWNLOAD_TOKEN = 'short-lived-token'
const DOWNLOAD_MANIFEST = {
  commitSha: COMMIT,
  files: [{ path: 'SKILL.md', size: SKILL_BYTES.byteLength, rawUrl: `https://raw.githubusercontent.com/owner/repo/${COMMIT}/skill/SKILL.md` }],
  limitReason: null,
  skippedFiles: 0,
  truncated: false,
}

function requestUrl(input: URL | RequestInfo): URL {
  if (input instanceof URL) return input
  return new URL(typeof input === 'string' ? input : input.url)
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseBody = body instanceof Uint8Array ? Buffer.from(body) : JSON.stringify(body)
  return new Response(responseBody, { status, ...(headers === undefined ? {} : { headers }) })
}

afterEach(() => { fetchMock.mockReset(); lookupMock.mockReset(); agentLookups.length = 0 })

describe('SkillsMP outbound requests', () => {
  it.each([
    ['loopback', '127.0.0.1', 4],
    ['10/8', '10.1.2.3', 4],
    ['172.16/12', '172.16.0.1', 4],
    ['192.168/16', '192.168.0.1', 4],
    ['link-local', '169.254.1.1', 4],
    ['IPv6 unique-local', 'fc00::1', 6],
  ])('rejects %s DNS answers before issuing HTTP', async (_range, address, family) => {
    lookupMock.mockResolvedValue([{ address, family }])
    const catalog = new SkillsMpCatalog(new Context(), {})

    await expect(catalog.catalog('query')).rejects.toThrow('did not resolve exclusively to public addresses')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows the TUN answer for each trusted HTTPS origin and pins it without changing the host', async () => {
    lookupMock.mockResolvedValue([{ address: '198.18.1.24', family: 4 }])
    fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
      const url = requestUrl(input)
      if (url.origin === 'https://skillsmp.com' && url.pathname === '/api/v1/skills/search') return response(SEARCH_RESPONSE)
      if (url.origin === 'https://skillsmp.com' && url.pathname === '/api/github-contents/token') return response({ token: DOWNLOAD_TOKEN, target: DOWNLOAD_TARGET })
      if (url.origin === 'https://skillsmp.com' && url.pathname === '/api/github-contents') return response(DOWNLOAD_MANIFEST)
      if (url.origin === 'https://raw.githubusercontent.com') return response(SKILL_BYTES)
      return response({}, 404)
    })
    const catalog = new SkillsMpCatalog(new Context(), {})

    await catalog.catalog('query')
    await catalog.detail('https://github.com/owner/repo/tree/main/skill')

    const requests = fetchMock.mock.calls.map(([input]) => requestUrl(input))
    expect(new Set(requests.map(url => url.origin))).toEqual(new Set([
      'https://skillsmp.com', 'https://raw.githubusercontent.com',
    ]))
    expect(lookupMock).toHaveBeenCalledTimes(requests.length)
    expect(agentLookups).toHaveLength(requests.length)
    for (const [index, url] of requests.entries()) {
      expect(lookupMock).toHaveBeenNthCalledWith(index + 1, url.hostname, { all: true, order: 'verbatim' })
      const pinnedLookup = agentLookups[index]
      if (pinnedLookup === undefined) throw new Error(`Direct HTTPS request ${index} did not receive a pinned lookup.`)
      let resolved: string | LookupAddress[] | undefined
      pinnedLookup(url.hostname, { all: true }, (error, address) => {
        if (error !== null) throw error
        resolved = address
      })
      expect(resolved).toEqual([{ address: '198.18.1.24', family: 4 }])
    }
  })

  it('does not resolve locally when the explicit HTTPS proxy handles the request', async () => {
    fetchMock.mockResolvedValue(response(SEARCH_RESPONSE))
    const dispose = await installProxyFromEnvironment({
      get(name) { return name === 'HTTPS_PROXY' ? { value: 'http://proxy.test:8080' } : undefined },
    }, () => undefined)
    try {
      const catalog = new SkillsMpCatalog(new Context(), {})
      await catalog.catalog('query')
      expect(lookupMock).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally { await dispose() }
  })

  it.each([
    'https://github.com.evil.test/owner/repo/tree/main/skill',
    'https://198.18.1.24/owner/repo/tree/main/skill',
  ])('does not issue requests for a malicious GitHub source URL: %s', async (githubUrl) => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const skill = SEARCH_RESPONSE.data.skills[0]
    if (skill === undefined) throw new Error('Search fixture has no skill.')
    const malicious = { ...SEARCH_RESPONSE, data: { ...SEARCH_RESPONSE.data, skills: [{ ...skill, githubUrl }] } }
    fetchMock.mockResolvedValue(response(malicious))
    const catalog = new SkillsMpCatalog(new Context(), {})

    await expect(catalog.catalog('query')).rejects.toMatchObject({ code: 'skillsmp/github-source-invalid' })
    expect(fetchMock.mock.calls.map(([input]) => requestUrl(input).origin)).toEqual(['https://skillsmp.com'])
  })

  it.each([
    [403, 'skillsmp/forbidden'],
    [429, 'skillsmp/rate-limited'],
  ])('returns a typed SkillsMP HTTP %s failure', async (status, code) => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockResolvedValue(response({ success: false }, status))
    const catalog = new SkillsMpCatalog(new Context(), {})

    await expect(catalog.catalog('query')).rejects.toMatchObject({ code, details: { status } })
  })

  it.each([
    ['/api/github-contents/token', 429, 'skillsmp/rate-limited'],
    ['/api/github-contents', 503, 'skillsmp/source-unavailable'],
  ])('returns a typed SkillsMP source failure for %s HTTP %s', async (path, status, code) => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
      const url = requestUrl(input)
      if (url.pathname === '/api/v1/skills/search') return response(SEARCH_RESPONSE)
      if (url.pathname === '/api/github-contents/token') {
        return url.pathname === path ? response({}, status) : response({ token: DOWNLOAD_TOKEN, target: DOWNLOAD_TARGET })
      }
      if (url.pathname === path) return response({}, status)
      return response(SKILL_BYTES)
    })
    const catalog = new SkillsMpCatalog(new Context(), {})

    await catalog.catalog('query')
    await expect(catalog.detail('https://github.com/owner/repo/tree/main/skill')).rejects.toMatchObject({ code, details: { status } })
  })

  it('rejects redirects from the SkillsMP endpoint', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockResolvedValueOnce(response({}, 302, { location: 'https://raw.githubusercontent.com/attacker/repo/main/file' }))
    const catalog = new SkillsMpCatalog(new Context(), {})

    await expect(catalog.catalog('query')).rejects.toThrow('redirect')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps search credentials and temporary download tokens on SkillsMP only', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
      const url = requestUrl(input)
      if (url.pathname === '/api/v1/skills/search') return response(SEARCH_RESPONSE)
      if (url.pathname === '/api/github-contents/token') return response({ token: DOWNLOAD_TOKEN, target: DOWNLOAD_TARGET })
      if (url.pathname === '/api/github-contents') return response(DOWNLOAD_MANIFEST)
      if (url.hostname === 'raw.githubusercontent.com') return response(SKILL_BYTES)
      return response({}, 404)
    })
    const ctx = new Context()
    const resolveCredential = vi.fn(async (_reference: string) => ({
      value: 'private-skillsmp-key',
      source: 'test',
    }))
    ctx.provide('credentials', { resolve: resolveCredential } as never)
    const catalog = new SkillsMpCatalog(ctx, { skillsmpCredentialKey: 'SKILLSMP_API_KEY' })

    await catalog.catalog('query')
    await catalog.detail('https://github.com/owner/repo/tree/main/skill')
    expect(resolveCredential.mock.calls.map(([reference]) => reference)).toEqual(['SKILLSMP_API_KEY'])
    for (const [input, init] of fetchMock.mock.calls) {
      const url = requestUrl(input)
      const headers = new Headers(init?.headers)
      if (url.pathname === '/api/v1/skills/search') expect(headers.get('authorization')).toBe('Bearer private-skillsmp-key')
      else expect(headers.has('authorization')).toBe(false)
      if (url.origin === 'https://raw.githubusercontent.com') expect(headers.has('x-skillsmp-download-token')).toBe(false)
      if (url.pathname === '/api/github-contents') expect(headers.get('x-skillsmp-download-token')).toBe(DOWNLOAD_TOKEN)
    }
    await ctx.fiber.dispose()
  })

  it('fails clearly when a configured SkillsMP credential reference is unavailable', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockResolvedValue(response(SEARCH_RESPONSE))
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined } as never)
    const catalog = new SkillsMpCatalog(ctx, { skillsmpCredentialKey: 'MISSING_SKILLSMP_API_KEY' })

    await expect(catalog.catalog('query')).rejects.toThrow('configured SkillsMP credential reference is unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

})
