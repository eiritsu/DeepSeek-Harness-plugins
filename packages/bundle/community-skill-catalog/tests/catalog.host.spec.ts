import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as SkillsMpHostPlugin from '../src/index.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FetchMock = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>
const { fetchMock, lookupMock } = vi.hoisted(() => ({ fetchMock: vi.fn<FetchMock>(), lookupMock: vi.fn() }))
vi.mock('undici', () => ({
  Agent: class { close(): Promise<void> { return Promise.resolve() } },
  fetch: fetchMock,
}))
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import { SkillsMpCatalog } from '../src/host/skillsmp-catalog.ts'
import type { Config } from '../src/host/skillsmp-catalog.ts'

const COMMIT = 'a'.repeat(40)
const SKILL_URL = 'https://github.com/affaan-m/ECC/tree/main/skills/seo'
const DOWNLOAD_TARGET = { owner: 'affaan-m', repo: 'ECC', branch: 'main', path: 'skills/seo' }
const DOWNLOAD_TOKEN = 'temporary-download-token'
const SKILL_MARKDOWN = '---\nname: seo\ndescription: SEO guidance for reviewed installations.\ndisable-model-invocation: false\nuser-invocable: true\n---\n\n# Reviewed SEO skill\n'
const SKILL_BYTES = Buffer.from(SKILL_MARKDOWN)
const BLOB_SHA = createHash('sha1').update(Buffer.from(`blob ${SKILL_BYTES.byteLength}\0`)).update(SKILL_BYTES).digest('hex')
const SEARCH_RESPONSE = {
  success: true,
  data: {
    skills: [{
      id: 'affaan-m-ecc-docs-ja-jp-skills-seo-skill-md', name: 'seo', author: 'affaan-m',
      description: 'SEO skill', contentLanguage: 'ja', githubUrl: SKILL_URL,
      skillUrl: 'https://skillsmp.com/creators/affaan-m/ecc/docs-ja-jp-skills-seo', stars: 269367, updatedAt: 1778999500,
    }],
    pagination: { page: 1, limit: 2, total: 3, totalPages: 2, hasNext: true, hasPrev: false, totalIsExact: false },
    filters: { search: 'SEO', sortBy: 'stars' },
  },
  meta: { requestId: 'sample', responseTimeMs: 350 },
}

const roots: string[] = []
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skillsmp-test-'))
  roots.push(root)
  return root
}
function response(body: unknown, status = 200): Response {
  const responseBody = body instanceof Uint8Array ? Buffer.from(body) : typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(responseBody, { status })
}
function requestUrl(input: URL | RequestInfo): URL {
  if (input instanceof URL) return input
  return new URL(typeof input === 'string' ? input : input.url)
}
function installHttpFixture(
  asset?: Uint8Array,
  reviewedSkillContent: Uint8Array = SKILL_BYTES,
): {
  setSkillContent(bytes: Uint8Array): void
  setManifest(value: unknown): void
  setTarget(value: unknown): void
  setToken(value: unknown): void
  setSearchResponse(value: unknown): void
  setSearchResponseFor(query: string, value: unknown): void
} {
  let skillContent = reviewedSkillContent
  let manifest: unknown = makeManifest(asset, reviewedSkillContent)
  let target: unknown = DOWNLOAD_TARGET
  let token: unknown = DOWNLOAD_TOKEN
  let searchResponse: unknown = SEARCH_RESPONSE
  const searchResponses = new Map<string, unknown>()
  lookupMock.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  fetchMock.mockReset().mockImplementation(async (input: URL | RequestInfo) => {
    const url = requestUrl(input)
    if (url.origin === 'https://skillsmp.com' && url.pathname === '/api/v1/skills/search') {
      return response(searchResponses.get(url.searchParams.get('q') ?? '') ?? searchResponse)
    }
    if (url.origin === 'https://skillsmp.com' && url.pathname === '/api/github-contents/token') {
      return response({ token, target })
    }
    if (url.origin === 'https://skillsmp.com' && url.pathname === '/api/github-contents') return response(manifest)
    if (url.origin === 'https://raw.githubusercontent.com') {
      return response(url.pathname.endsWith('/assets/image.bin') && asset !== undefined ? asset : skillContent)
    }
    return response({ message: 'not found' }, 404)
  })
  return {
    setSkillContent(bytes) { skillContent = bytes },
    setManifest(value) { manifest = value },
    setTarget(value) { target = value },
    setToken(value) { token = value },
    setSearchResponse(value) { searchResponse = value },
    setSearchResponseFor(query, value) { searchResponses.set(query, value) },
  }
}

function makeManifest(asset?: Uint8Array, skillContent: Uint8Array = SKILL_BYTES): Record<string, unknown> {
  const files = [{ path: 'SKILL.md', size: skillContent.byteLength, rawUrl: rawUrl('SKILL.md') }]
  if (asset !== undefined) files.push({ path: 'assets/image.bin', size: asset.byteLength, rawUrl: rawUrl('assets/image.bin') })
  return { commitSha: COMMIT, files, limitReason: null, skippedFiles: 0, truncated: false }
}

function rawUrl(path: string, commit = COMMIT): string {
  const segments = [...DOWNLOAD_TARGET.path.split('/'), ...path.split('/')]
  return `https://raw.githubusercontent.com/${DOWNLOAD_TARGET.owner}/${DOWNLOAD_TARGET.repo}/${commit}/${segments.map(encodeURIComponent).join('/')}`
}

async function withCatalog<T>(
  root: string,
  run: (catalog: SkillsMpCatalog, ctx: Context) => Promise<T>,
  config: Partial<Config> = {},
): Promise<T> {
  const ctx = new Context()
  const catalog = new SkillsMpCatalog(ctx, { ...config, skillRoot: root })
  try { return await run(catalog, ctx) }
  finally { await ctx.fiber.dispose() }
}

afterEach(async () => {
  fetchMock.mockReset()
  lookupMock.mockReset()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('SkillsMP search and pinned GitHub installation', () => {
  it('validates the saved SkillsMP response and caches searches by the full query', async () => {
    installHttpFixture()
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      const first = await catalog.catalog('SEO', undefined, undefined, undefined, 'stars', 1, 2)
      const repeated = await catalog.catalog('SEO', undefined, undefined, undefined, 'stars', 1, 2)
      expect(first).toEqual({
        items: [{
          id: 'affaan-m-ecc-docs-ja-jp-skills-seo-skill-md', name: 'seo', author: 'affaan-m',
          description: 'SEO skill', contentLanguage: 'ja', githubUrl: SKILL_URL,
          url: 'https://skillsmp.com/creators/affaan-m/ecc/docs-ja-jp-skills-seo', stars: 269367, updatedAt: 1778999500,
        }], total: 3, totalIsExact: false, hasNext: true, page: 1,
      })
      expect(repeated).toEqual(first)
      expect(fetchMock).toHaveBeenCalledOnce()
      const call = fetchMock.mock.calls.at(0)
      if (call === undefined) throw new Error('Search did not issue an HTTP request.')
      const request = call[0]
      expect(requestUrl(request).toString()).toContain('/api/v1/skills/search?q=SEO&limit=2&page=1&sortBy=stars')
      await expect(catalog.catalog(' ', undefined, undefined, undefined, 'stars')).rejects.toThrow('must not be empty')
      await expect(catalog.catalog('*')).rejects.toThrow('wildcard')
    })
  })

  it('accepts a long valid occupation slug and sends it intact to SkillsMP', async () => {
    installHttpFixture()
    const root = await temporaryRoot()
    const occupation = 'military-enlisted-tactical-operations-and-air-weapons-specialists-and-crew-members-all-other'
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('military roles', undefined, occupation)
      const call = fetchMock.mock.calls.at(0)
      if (call === undefined) throw new Error('SkillsMP search did not issue an HTTP request.')
      expect(requestUrl(call[0]).searchParams.get('occupation')).toBe(occupation)
    })
  })

  it('requests a SkillsMP authorization and validated source manifest before reading pinned raw files', async () => {
    installHttpFixture()
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('SEO')
      const detail = await catalog.detail(SKILL_URL)
      expect(detail).toMatchObject({ commitSha: COMMIT, totalBytes: SKILL_BYTES.byteLength, skillMarkdown: SKILL_MARKDOWN })
      expect(detail.files).toEqual([{ path: 'SKILL.md', size: SKILL_BYTES.byteLength, sha: BLOB_SHA }])
      expect(fetchMock.mock.calls.map(([input]) => requestUrl(input).toString())).toContain(`https://raw.githubusercontent.com/affaan-m/ECC/${COMMIT}/skills/seo/SKILL.md`)
      const tokenCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).pathname === '/api/github-contents/token')
      if (tokenCall === undefined) throw new Error('SkillsMP authorization endpoint was not called.')
      expect(tokenCall[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ skillId: SEARCH_RESPONSE.data.skills[0]?.id }) })
      expect(new Headers(tokenCall[1]?.headers).get('referer')).toBe(SEARCH_RESPONSE.data.skills[0]?.skillUrl)
      expect(new Headers(tokenCall[1]?.headers).get('origin')).toBe('https://skillsmp.com')
      const manifestCall = fetchMock.mock.calls.find(([input]) => requestUrl(input).pathname === '/api/github-contents')
      if (manifestCall === undefined) throw new Error('SkillsMP source manifest endpoint was not called.')
      expect(requestUrl(manifestCall[0]).searchParams).toEqual(new URLSearchParams({ owner: 'affaan-m', repo: 'ECC', path: 'skills/seo', branch: 'main' }))
      expect(new Headers(manifestCall[1]?.headers).get('x-skillsmp-download-token')).toBe(DOWNLOAD_TOKEN)
      expect(fetchMock.mock.calls.filter(([input]) => requestUrl(input).origin !== 'https://skillsmp.com'))
        .toEqual([[expect.anything(), expect.anything()]])
    })
  })

  it('installs only the manifest reviewed at a commit SHA without resolving the branch again', async () => {
    installHttpFixture()
    const root = await temporaryRoot()
    const target = join(root, 'affaan-m-ecc-docs-ja-jp-skills-seo-skill-md')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), '# Previous version')
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('SEO')
      const detail = await catalog.detail(SKILL_URL)
      fetchMock.mockClear()
      fetchMock.mockImplementation(async (input: URL | RequestInfo) => {
        const url = requestUrl(input)
        if (url.origin === 'https://raw.githubusercontent.com') return response(SKILL_BYTES)
        return response({ message: 'not found' }, 404)
      })
      await expect(catalog.installSkill(SKILL_URL, detail.commitSha, false)).rejects.toThrow('Confirm')
      const result = await catalog.installSkill(SKILL_URL, detail.commitSha, true)
      expect(result).toMatchObject({ id: 'affaan-m-ecc-docs-ja-jp-skills-seo-skill-md', commitSha: COMMIT, files: 1, totalBytes: SKILL_BYTES.byteLength })
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN)
      expect(fetchMock.mock.calls.every(([input]) => requestUrl(input).origin === 'https://raw.githubusercontent.com')).toBe(true)
      expect(fetchMock.mock.calls.map(([input]) => requestUrl(input).toString())).toEqual([rawUrl('SKILL.md')])
      expect((await readdir(root)).sort()).toEqual(['.skillsmp', 'affaan-m-ecc-docs-ja-jp-skills-seo-skill-md'])
    })
  })

  it('installs a file within the manifest file limit and verifies its Git blob', async () => {
    const asset = Buffer.alloc(500_000, 7)
    installHttpFixture(asset)
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('SEO')
      const detail = await catalog.detail(SKILL_URL)
      expect(detail.files.map(file => file.path)).toEqual(['SKILL.md', 'assets/image.bin'])
      expect(detail.totalBytes).toBe(SKILL_BYTES.byteLength + asset.byteLength)
      const result = await catalog.installSkill(SKILL_URL, detail.commitSha, true)
      expect(result.files).toBe(2)
      expect(await readFile(join(result.path, 'assets/image.bin'))).toEqual(asset)
    })
  })

  it.each([
    ['raw file size mismatch', Buffer.from('short')],
    ['raw file hash mismatch', Buffer.from(SKILL_MARKDOWN.replace('reviewed', 'tampered'))],
  ])('keeps an existing installation after a %s or cancellation', async (_caseName, changedBytes) => {
    const fixture = installHttpFixture()
    const root = await temporaryRoot()
    const target = join(root, 'affaan-m-ecc-docs-ja-jp-skills-seo-skill-md')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), '# Existing installation')
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('SEO')
      const detail = await catalog.detail(SKILL_URL)
      fixture.setSkillContent(changedBytes)
      await expect(catalog.installSkill(SKILL_URL, detail.commitSha, true)).rejects.toMatchObject({ code: 'skillsmp/file-integrity-failed', details: { path: 'SKILL.md' } })
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('# Existing installation')
      expect(await readdir(join(root, '.skillsmp'))).toEqual([])

      fixture.setSkillContent(SKILL_BYTES)
      const controller = new AbortController()
      controller.abort(new Error('cancelled by caller'))
      await expect(catalog.installSkill(SKILL_URL, detail.commitSha, true, controller.signal)).rejects.toThrow('cancelled by caller')
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('# Existing installation')
      expect(await readdir(join(root, '.skillsmp'))).toEqual([])
    })
  })

  it.each([
    ['missing frontmatter', '# No frontmatter\n'],
    ['invalid kebab name', '---\nname: Not A Skill\ndescription: Invalid name.\n---\n\n# Content\n'],
    ['legacy invocation key', '---\nname: seo\ndescription: Legacy setting.\nmodelInvocable: false\n---\n\n# Content\n'],
  ])('preserves an existing installation when the official skill filesystem rejects %s', async (_caseName, contents) => {
    installHttpFixture(undefined, Buffer.from(contents))
    const root = await temporaryRoot()
    const target = join(root, 'affaan-m-ecc-docs-ja-jp-skills-seo-skill-md')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), '# Existing installation')
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('SEO')
      const detail = await catalog.detail(SKILL_URL)
      await expect(catalog.installSkill(SKILL_URL, detail.commitSha, true))
        .rejects.toMatchObject({ code: 'skillsmp/skill-incompatible' })
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('# Existing installation')
      expect(await readdir(join(root, '.skillsmp'))).toEqual([])
    })
  })

  it.each([
    ['omitted files', { limitReason: 'file_count', skippedFiles: 1, truncated: true }],
    ['truncated files', { limitReason: null, skippedFiles: 1, truncated: true }],
  ])('rejects a partial SkillsMP manifest with a typed error (%s)', async (_name, partial) => {
    const fixture = installHttpFixture()
    fixture.setManifest({ ...makeManifest(), ...partial })
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('SEO')
      await expect(catalog.detail(SKILL_URL)).rejects.toMatchObject({ code: 'skillsmp/manifest-incomplete' })
      expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).origin === 'https://raw.githubusercontent.com')).toBe(false)
    })
  })

  it.each([
    ['unsafe traversal', '../SKILL.md', rawUrl('SKILL.md')],
    ['noncanonical raw URL', 'SKILL.md', 'https://github.com/attacker/repo/SKILL.md'],
    ['wrong subtree raw URL', 'SKILL.md', rawUrl('other/SKILL.md')],
  ])('rejects manifest path or raw URL mismatch (%s)', async (_name, path, fileRawUrl) => {
    const fixture = installHttpFixture()
    fixture.setManifest({ ...makeManifest(), files: [{ path, size: SKILL_BYTES.byteLength, rawUrl: fileRawUrl }] })
    await withCatalog(await temporaryRoot(), async (catalog) => {
      await catalog.catalog('SEO')
      await expect(catalog.detail(SKILL_URL)).rejects.toThrow(/unsafe file path|raw URL/u)
      expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).origin === 'https://raw.githubusercontent.com')).toBe(false)
    })
  })

  it('rejects a token target that moves the selected GitHub source path', async () => {
    const fixture = installHttpFixture()
    fixture.setTarget({ ...DOWNLOAD_TARGET, path: 'skills/other' })
    await withCatalog(await temporaryRoot(), async (catalog) => {
      await catalog.catalog('SEO')
      await expect(catalog.detail(SKILL_URL)).rejects.toMatchObject({ code: 'skillsmp/github-source-invalid' })
      expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).pathname === '/api/github-contents')).toBe(false)
    })
  })

  it('requires the source authorization token to be a single string', async () => {
    const fixture = installHttpFixture()
    fixture.setToken([DOWNLOAD_TOKEN])
    await withCatalog(await temporaryRoot(), async (catalog) => {
      await catalog.catalog('SEO')
      await expect(catalog.detail(SKILL_URL)).rejects.toThrow('invalid download authorization')
      expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).pathname === '/api/github-contents')).toBe(false)
      expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).origin === 'https://raw.githubusercontent.com')).toBe(false)
    })
  })

  it('compares slash refs and path tails with the SkillsMP target without guessing a split', async () => {
    const fixture = installHttpFixture()
    const listed = SEARCH_RESPONSE.data.skills[0]
    if (listed === undefined) throw new Error('Search fixture has no skill.')
    const sourceUrl = 'https://github.com/affaan-m/ECC/tree/feature/docs/skills/seo'
    fixture.setSearchResponse({
      ...SEARCH_RESPONSE,
      data: { ...SEARCH_RESPONSE.data, skills: [{ ...listed, githubUrl: sourceUrl }] },
    })
    fixture.setTarget({ owner: 'affaan-m', repo: 'ECC', branch: 'feature/docs', path: 'skills/other' })
    await withCatalog(await temporaryRoot(), async (catalog) => {
      await catalog.catalog('SEO')
      await expect(catalog.detail(sourceUrl)).rejects.toMatchObject({ code: 'skillsmp/github-source-invalid' })
      expect(fetchMock.mock.calls.some(([input]) => requestUrl(input).pathname === '/api/github-contents')).toBe(false)
    })
  })

  it('rejects manifests over the file and entry count limits', async () => {
    const oversized = installHttpFixture()
    oversized.setManifest({ ...makeManifest(), files: [{ path: 'SKILL.md', size: 512_001, rawUrl: rawUrl('SKILL.md') }] })
    await withCatalog(await temporaryRoot(), async (catalog) => {
      await catalog.catalog('SEO')
      await expect(catalog.detail(SKILL_URL)).rejects.toMatchObject({ code: 'skillsmp/manifest-incomplete', details: { limitReason: 'file_size' } })
    })

    const tooMany = installHttpFixture()
    tooMany.setManifest({ ...makeManifest(), files: Array.from({ length: 101 }, (_value, index) => ({ path: `file-${index}.txt`, size: 1, rawUrl: rawUrl(`file-${index}.txt`) })) })
    await withCatalog(await temporaryRoot(), async (catalog) => {
      await catalog.catalog('SEO')
      await expect(catalog.detail(SKILL_URL)).rejects.toMatchObject({ code: 'skillsmp/manifest-incomplete', details: { limitReason: 'file_count' } })
    })
  })

  it('requires a retained SkillsMP source and an exact reviewed SHA before installation', async () => {
    installHttpFixture()
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      await expect(catalog.detail(SKILL_URL)).rejects.toMatchObject({ code: 'skillsmp/search-required' })
      await catalog.catalog('SEO')
      await expect(catalog.installSkill(SKILL_URL, COMMIT, true)).rejects.toMatchObject({ code: 'skillsmp/review-required' })
    })
  })

  it('keeps source identity and reviewed SHA through search page TTL while bounded in the Host LRU', async () => {
    installHttpFixture()
    const root = await temporaryRoot()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    try {
      await withCatalog(root, async (catalog) => {
        await catalog.catalog('SEO')
        clock.mockReturnValue(2002)
        const detail = await catalog.detail(SKILL_URL)
        fetchMock.mockClear()
        const installed = await catalog.installSkill(SKILL_URL, detail.commitSha, true)
        expect(installed.commitSha).toBe(COMMIT)
        expect(fetchMock.mock.calls.map(([input]) => requestUrl(input).toString())).toEqual([rawUrl('SKILL.md')])
      }, { cacheTtlMs: 1000, maxCacheEntries: 1 })
    } finally { clock.mockRestore() }
  })

  it('returns a typed miss when browsing evicts a source identity from the bounded Host LRU', async () => {
    const fixture = installHttpFixture()
    const first = SEARCH_RESPONSE.data.skills[0]
    if (first === undefined) throw new Error('Search fixture has no skill.')
    const filler = { ...first, id: 'filler-skill', githubUrl: 'https://github.com/affaan-m/other/tree/main/skills/seo' }
    const second = { ...first, id: 'second-skill', githubUrl: 'https://github.com/affaan-m/second/tree/main/skills/seo' }
    fixture.setSearchResponseFor('page-one', {
      ...SEARCH_RESPONSE,
      data: { ...SEARCH_RESPONSE.data, skills: [first, filler] },
    })
    fixture.setSearchResponseFor('page-two', {
      ...SEARCH_RESPONSE,
      data: { ...SEARCH_RESPONSE.data, skills: [second] },
    })
    await withCatalog(await temporaryRoot(), async (catalog) => {
      await catalog.catalog('page-one')
      await catalog.catalog('page-two')
      await expect(catalog.detail(SKILL_URL)).rejects.toMatchObject({ code: 'skillsmp/search-required' })
    }, { maxCacheEntries: 2 })
  })

  it('refreshes retained source identities when a cached search page is reopened', async () => {
    const fixture = installHttpFixture()
    const first = SEARCH_RESPONSE.data.skills[0]
    if (first === undefined) throw new Error('Search fixture has no skill.')
    const filler = { ...first, id: 'filler-skill', githubUrl: 'https://github.com/affaan-m/other/tree/main/skills/seo' }
    const second = { ...first, id: 'second-skill', githubUrl: 'https://github.com/affaan-m/second/tree/main/skills/seo' }
    fixture.setSearchResponseFor('page-one', {
      ...SEARCH_RESPONSE,
      data: { ...SEARCH_RESPONSE.data, skills: [first, filler] },
    })
    fixture.setSearchResponseFor('page-two', {
      ...SEARCH_RESPONSE,
      data: { ...SEARCH_RESPONSE.data, skills: [second] },
    })
    await withCatalog(await temporaryRoot(), async (catalog) => {
      await catalog.catalog('page-one')
      await catalog.catalog('page-two')
      await catalog.catalog('page-one')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await expect(catalog.detail(SKILL_URL)).resolves.toMatchObject({ commitSha: COMMIT })
    }, { maxCacheEntries: 2 })
  })

  it('rejects non GitHub origins and unsafe paths', async () => {
    installHttpFixture()
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('SEO')
      await expect(catalog.detail('https://github.com.evil.test/affaan-m/ECC/tree/main/skills/seo')).rejects.toMatchObject({ code: 'skillsmp/github-source-invalid' })
      await expect(catalog.installSkill(SKILL_URL, 'not-a-sha', true)).rejects.toThrow('40 hexadecimal')
    })
  })

  it('loads the Host plugin through Loader, exposes skillsMpCatalog, and preserves removal semantics', async () => {
    installHttpFixture()
    const root = await temporaryRoot()
    const existing = join(root, 'legacy-skill')
    await mkdir(existing)
    await writeFile(join(existing, 'SKILL.md'), '# legacy')
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-community-skill-catalog'",
      '  config:',
      `    skillRoot: ${JSON.stringify(root)}`,
      '',
    ].join('\n'))
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined } as never)
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const originalInternal = ctx.loader.internal
    if (originalInternal === undefined) throw new Error('Loader has no module importer.')
    const importPlugin = async (specifier: string): Promise<typeof SkillsMpHostPlugin> => {
      if (specifier !== '@deepseek-ai/dsh-community-skill-catalog') throw new Error(`unexpected Loader import: ${specifier}`)
      return SkillsMpHostPlugin
    }
    if (originalInternal.version === 'v1') {
      originalInternal.import = async (specifier, _parentUrl, _attributes) => importPlugin(specifier)
    } else {
      originalInternal.import = async (specifier, _parentUrl, _attributes, _phase, _isEntryPoint) => importPlugin(specifier)
    }
    try {
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
      const catalog = Reflect.get(ctx, 'skillsMpCatalog') as SkillsMpCatalog | undefined
      expect(catalog).toBeDefined()
      if (catalog === undefined) throw new Error('Loader did not mount skillsMpCatalog.')
      await catalog.catalog('SEO')
      await expect(catalog.listInstalledSkills()).resolves.toEqual([{ id: 'legacy-skill', name: 'legacy-skill' }])
      await expect(catalog.removeInstalledSkill('legacy-skill', false)).rejects.toThrow('Confirm')
      await expect(catalog.removeInstalledSkill('../outside', true)).rejects.toThrow('id is invalid')
      await expect(catalog.removeInstalledSkill('legacy-skill', true)).resolves.toBe('legacy-skill')
      await expect(readFile(join(existing, 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await ctx.fiber.dispose() }
  })
})
