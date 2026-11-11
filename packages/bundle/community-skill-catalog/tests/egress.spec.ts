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
const { fetchMock, lookupMock, resolve4Mock, resolve6Mock, agentLookups, proxyState } = vi.hoisted(() => ({
  fetchMock: vi.fn<FetchMock>(),
  lookupMock: vi.fn(),
  resolve4Mock: vi.fn<() => Promise<string[]>>(),
  resolve6Mock: vi.fn<() => Promise<string[]>>(),
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
vi.mock('node:dns/promises', () => ({ lookup: lookupMock, resolve4: resolve4Mock, resolve6: resolve6Mock }))

import { SkillCatalog } from '../src/host/skill-catalog.ts'

const INDEX_RESPONSE = [
  {
    id: 'seo',
    path: 'skills/seo',
    category: 'marketing',
    name: 'seo',
    description: 'SEO skill',
    risk: 'safe',
    source: 'https://github.com/owner/repo/tree/main/skills/seo',
    date_added: '2026-03-01',
    plugin: { targets: { claude: 'supported' } },
  },
]
const SKILLS_SH_RESPONSE = {
  skills: [{ id: 'owner/repo/seo', source: 'owner/repo', skillId: 'seo', name: 'seo', installs: 1200 }],
}
const COMMIT = 'a'.repeat(40)
const SKILL_TEXT = '---\nname: seo\ndescription: TUN routed skill.\n---\n\n# TUN routed skill\n'
const SKILL_BYTES = Buffer.from(SKILL_TEXT)

function requestUrl(input: URL | RequestInfo): URL {
  if (input instanceof URL) return input
  return new URL(typeof input === 'string' ? input : input.url)
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  const responseBody = body instanceof Uint8Array ? Buffer.from(body) : JSON.stringify(body)
  return new Response(responseBody, { status, ...(headers === undefined ? {} : { headers }) })
}

afterEach(() => {
  fetchMock.mockReset()
  lookupMock.mockReset()
  resolve4Mock.mockReset()
  resolve6Mock.mockReset()
  agentLookups.length = 0
})

describe('Skill catalog outbound requests', () => {
  it('falls back to direct resolve4/resolve6 on ENOTFOUND while still rejecting private fallback IPs', async () => {
    lookupMock.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND skills.sh'), { code: 'ENOTFOUND' }))
    resolve4Mock.mockResolvedValueOnce(['127.0.0.1'])
    resolve6Mock.mockResolvedValueOnce([])
    const catalog = new SkillCatalog(new Context(), {})
    await expect(catalog.catalog('query', 'skills-sh')).rejects.toThrow('did not resolve exclusively to public addresses')
    expect(fetchMock).not.toHaveBeenCalled()

    resolve4Mock.mockResolvedValueOnce(['64.239.109.65'])
    resolve6Mock.mockResolvedValueOnce([])
    fetchMock.mockResolvedValueOnce(response(SKILLS_SH_RESPONSE))
    const page = await catalog.catalog('seo', 'skills-sh')
    expect(page.items).toHaveLength(1)
  })
  it.each([
    ['loopback', '127.0.0.1', 4],
    ['10/8', '10.1.2.3', 4],
    ['172.16/12', '172.16.0.1', 4],
    ['192.168/16', '192.168.0.1', 4],
    ['link-local', '169.254.1.1', 4],
    ['IPv6 unique-local', 'fc00::1', 6],
  ])('rejects %s DNS answers before issuing HTTP', async (_range, address, family) => {
    lookupMock.mockResolvedValue([{ address, family }])
    const catalog = new SkillCatalog(new Context(), {})

    await expect(catalog.catalog('query', 'skills-sh')).rejects.toThrow('did not resolve exclusively to public addresses')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows TUN benchmark addresses across trusted origins and pins them per request', async () => {
    lookupMock.mockResolvedValue([{ address: '198.18.1.24', family: 4 }])
    fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
      const url = requestUrl(input)
      if (url.origin === 'https://raw.githubusercontent.com' && url.pathname.endsWith('/skills_index.json')) return response(INDEX_RESPONSE)
      if (url.origin === 'https://skills.sh' && url.pathname === '/api/search') return response(SKILLS_SH_RESPONSE)
      if (url.origin === 'https://api.github.com' && url.pathname.includes('/commits/')) return response({ sha: COMMIT })
      if (url.origin === 'https://api.github.com' && url.pathname.includes('/contents/')) {
        return response([{ name: 'SKILL.md', path: 'skills/seo/SKILL.md', type: 'file', size: SKILL_BYTES.byteLength }])
      }
      if (url.origin === 'https://raw.githubusercontent.com') return response(SKILL_BYTES)
      return response({}, 404)
    })
    const catalog = new SkillCatalog(new Context(), {})

    await catalog.catalog('seo', 'all')
    await catalog.detail('github:sickn33/agentic-awesome-skills/skills/seo')

    const requests = fetchMock.mock.calls.map(([input]) => requestUrl(input))
    expect(new Set(requests.map(url => url.origin))).toEqual(new Set([
      'https://raw.githubusercontent.com', 'https://skills.sh', 'https://api.github.com',
    ]))
    expect(lookupMock).toHaveBeenCalledTimes(requests.length)
    expect(agentLookups).toHaveLength(requests.length)
    for (const [index, url] of requests.entries()) {
      expect(lookupMock).toHaveBeenNthCalledWith(index + 1, url.hostname, { all: true, order: 'verbatim' })
      const pinned = agentLookups[index]
      if (pinned === undefined) throw new Error(`Direct HTTPS request ${index} did not receive a pinned lookup.`)
      let resolved: string | LookupAddress[] | undefined
      pinned(url.hostname, { all: true }, (error, address) => {
        if (error !== null) throw error
        resolved = address
      })
      expect(resolved).toEqual([{ address: '198.18.1.24', family: 4 }])
    }
  })

  it('does not resolve DNS locally when explicit HTTPS_PROXY handles the request', async () => {
    fetchMock.mockResolvedValue(response(SKILLS_SH_RESPONSE))
    const dispose = await installProxyFromEnvironment({
      get(name) { return name === 'HTTPS_PROXY' ? { value: 'http://proxy.test:8080' } : undefined },
    }, () => undefined)
    try {
      const catalog = new SkillCatalog(new Context(), {})
      await catalog.catalog('seo', 'skills-sh')
      expect(lookupMock).not.toHaveBeenCalled()
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally { await dispose() }
  })

  it('rejects redirects from upstream endpoints', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockResolvedValueOnce(response({}, 302, { location: 'https://raw.githubusercontent.com/attacker/repo/main/file' }))
    const catalog = new SkillCatalog(new Context(), {})

    await expect(catalog.catalog('query', 'skills-sh')).rejects.toThrow('redirects are not allowed')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    [429, 'skill-catalog/rate-limited', 'skills-sh'],
    [503, 'skill-catalog/source-unavailable', 'skills-sh'],
  ])('maps skills.sh HTTP %s failures to typed errors', async (status, code, source) => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockResolvedValue(response({}, status))
    const catalog = new SkillCatalog(new Context(), {})

    await expect(catalog.catalog('query', 'skills-sh')).rejects.toMatchObject({ code, details: { source, status } })
  })

  it('keeps configured GitHub credentials scoped exclusively to api.github.com', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
      const url = requestUrl(input)
      if (url.origin === 'https://raw.githubusercontent.com' && url.pathname.endsWith('/skills_index.json')) return response(INDEX_RESPONSE)
      if (url.origin === 'https://skills.sh' && url.pathname === '/api/search') return response(SKILLS_SH_RESPONSE)
      if (url.origin === 'https://api.github.com' && url.pathname.includes('/commits/')) return response({ sha: COMMIT })
      if (url.origin === 'https://api.github.com' && url.pathname.includes('/contents/')) {
        return response([{ name: 'SKILL.md', path: 'skills/seo/SKILL.md', type: 'file', size: SKILL_BYTES.byteLength }])
      }
      if (url.origin === 'https://raw.githubusercontent.com') return response(SKILL_BYTES)
      return response({}, 404)
    })
    const ctx = new Context()
    const resolveCredential = vi.fn(async (_reference: string) => ({ value: 'ghp_secret_token_value', source: 'test' }))
    ctx.provide('credentials', { resolve: resolveCredential } as never)
    const catalog = new SkillCatalog(ctx, { githubCredentialKey: 'GITHUB_TOKEN' })

    await catalog.catalog('seo', 'all')
    await catalog.detail('github:sickn33/agentic-awesome-skills/skills/seo')

    expect(resolveCredential.mock.calls.map(([ref]) => ref)).toEqual(['GITHUB_TOKEN', 'GITHUB_TOKEN'])
    for (const [input, init] of fetchMock.mock.calls) {
      const url = requestUrl(input)
      const headers = new Headers(init?.headers)
      if (url.origin === 'https://api.github.com') expect(headers.get('authorization')).toBe('Bearer ghp_secret_token_value')
      else expect(headers.has('authorization')).toBe(false)
    }
    await ctx.fiber.dispose()
  })

  it('fails clearly when a configured GitHub credential reference is unavailable', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
      const url = requestUrl(input)
      if (url.origin === 'https://raw.githubusercontent.com' && url.pathname.endsWith('/skills_index.json')) return response(INDEX_RESPONSE)
      return response({}, 404)
    })
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined } as never)
    const catalog = new SkillCatalog(ctx, { githubCredentialKey: 'MISSING_GITHUB_TOKEN' })

    await catalog.catalog('seo', 'github-index')
    await expect(catalog.detail('github:sickn33/agentic-awesome-skills/skills/seo')).rejects.toThrow('configured GitHub credential reference is unavailable')
    await ctx.fiber.dispose()
  })
})
