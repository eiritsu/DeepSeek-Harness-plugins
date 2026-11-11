import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as SkillCatalogHostPlugin from '../src/index.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FetchMock = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>
const { fetchMock, lookupMock } = vi.hoisted(() => ({ fetchMock: vi.fn<FetchMock>(), lookupMock: vi.fn() }))
vi.mock('undici', () => ({
  Agent: class { close(): Promise<void> { return Promise.resolve() } },
  fetch: fetchMock,
}))
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import { SkillCatalog, type Config } from '../src/host/skill-catalog.ts'

const COMMIT = 'a'.repeat(40)
const SKILL_MARKDOWN = '---\nname: vercel-react-best-practices\ndescription: React guidance for reviewed installs.\n---\n\n# React skill\n'
const SKILL_BYTES = Buffer.from(SKILL_MARKDOWN)
const BLOB_SHA = createHash('sha1').update(Buffer.from(`blob ${SKILL_BYTES.byteLength}\0`)).update(SKILL_BYTES).digest('hex')

const INDEX_ENTRIES = [
  {
    id: 'react-best-practices',
    path: 'skills/react-best-practices',
    category: 'frontend',
    name: 'react-best-practices',
    description: 'React performance rules from Vercel Engineering',
    risk: 'safe',
    source: 'https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices',
    date_added: '2026-03-10',
    plugin: { targets: { claude: 'supported', codex: 'supported' } },
  },
  {
    id: 'security-audit',
    path: 'skills/security-audit',
    category: 'security',
    name: 'security-audit',
    description: 'Security audit workflow',
    risk: 'critical',
    source: 'community',
    date_added: '2026-04-01',
    plugin: { targets: { claude: 'supported' } },
  },
]

const SKILLS_SH_RESULTS = {
  skills: [
    {
      id: 'vercel-labs/agent-skills/react-best-practices',
      source: 'vercel-labs/agent-skills',
      skillId: 'react-best-practices',
      name: 'react-best-practices',
      installs: 887059,
    },
    {
      id: 'vercel-labs/agent-skills/vercel-react-best-practices',
      source: 'vercel-labs/agent-skills',
      skillId: 'vercel-react-best-practices',
      name: 'vercel-react-best-practices',
      installs: 450000,
    },
    {
      id: 'open.feishu.cn/lark-event',
      source: 'open.feishu.cn',
      skillId: 'lark-event',
      name: 'lark-event',
      installs: 881424,
    },
  ],
}

const roots: string[] = []
async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-catalog-test-'))
  roots.push(root)
  return root
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  const payload = body instanceof Uint8Array ? Buffer.from(body) : typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(payload, { status, ...(headers === undefined ? {} : { headers }) })
}

function requestUrl(input: URL | RequestInfo): URL {
  if (input instanceof URL) return input
  return new URL(typeof input === 'string' ? input : input.url)
}

interface FixtureHandle {
  setIndex(value: unknown): void
  setSkillsSh(value: unknown, status?: number): void
  setSkillBytes(bytes: Uint8Array): void
  setTreeTruncated(truncated: boolean): void
}

function installHttpFixture(asset?: Uint8Array): FixtureHandle {
  let indexData: unknown = INDEX_ENTRIES
  let skillsShData: unknown = SKILLS_SH_RESULTS
  let skillsShStatus = 200
  let skillBytes = SKILL_BYTES
  let truncated = false

  lookupMock.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  fetchMock.mockReset().mockImplementation(async (input: URL | RequestInfo) => {
    const url = requestUrl(input)
    if (url.origin === 'https://raw.githubusercontent.com' && url.pathname.endsWith('/skills_index.json')) {
      return response(indexData)
    }
    if (url.origin === 'https://skills.sh' && url.pathname === '/api/search') {
      return response(skillsShData, skillsShStatus)
    }
    if (url.origin === 'https://api.github.com' && url.pathname.includes('/commits/')) {
      return response(`${COMMIT}\n`, 200, { 'content-type': 'application/vnd.github.sha' })
    }
    if (url.origin === 'https://api.github.com' && url.pathname.includes('/git/trees/')) {
      const tree: unknown[] = []
      if (!truncated) {
        tree.push({ type: 'blob', path: 'skills/react-best-practices/SKILL.md', sha: gitShaOf(skillBytes), size: skillBytes.byteLength })
        if (asset !== undefined) {
          tree.push({ type: 'blob', path: 'skills/react-best-practices/assets/image.bin', sha: gitShaOf(asset), size: asset.byteLength })
        }
      }
      return response({ truncated, tree })
    }
    if (url.origin === 'https://api.github.com' && url.pathname.includes('/contents/skills/react-best-practices')) {
      return response([
        { name: 'SKILL.md', path: 'skills/react-best-practices/SKILL.md', type: 'file', size: skillBytes.byteLength, sha: gitShaOf(skillBytes) },
        ...(asset === undefined
          ? []
          : [{ name: 'image.bin', path: 'skills/react-best-practices/assets/image.bin', type: 'file', size: asset.byteLength, sha: gitShaOf(asset) }]),
      ])
    }
    if (url.origin === 'https://raw.githubusercontent.com') {
      if (url.pathname.endsWith('/image.bin') && asset !== undefined) return response(asset)
      return response(skillBytes)
    }
    return response({ message: 'not found' }, 404)
  })

  return {
    setIndex(value) { indexData = value },
    setSkillsSh(value, status = 200) { skillsShData = value; skillsShStatus = status },
    setSkillBytes(bytes) { skillBytes = bytes },
    setTreeTruncated(value) { truncated = value },
  }
}

function gitShaOf(bytes: Uint8Array): string {
  return createHash('sha1').update(Buffer.from(`blob ${bytes.byteLength}\0`)).update(bytes).digest('hex')
}

async function withCatalog<T>(
  root: string,
  run: (catalog: SkillCatalog, ctx: Context) => Promise<T>,
  config: Partial<Config> = {},
): Promise<T> {
  const ctx = new Context()
  const catalog = new SkillCatalog(ctx, { ...config, skillRoot: root })
  try { return await run(catalog, ctx) }
  finally { await ctx.fiber.dispose() }
}

afterEach(async () => {
  fetchMock.mockReset()
  lookupMock.mockReset()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Dual-source skill catalog search, resolution, and install', () => {
  it('merges GitHub index and skills.sh hits, filters non-GitHub hosts, and deduplicates matching attribution', async () => {
    installHttpFixture()
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      const page = await catalog.catalog('react', 'all', 'all', 'installs', 1, 24)
      expect(page.warnings).toBeUndefined()
      expect(page.total).toBe(2)
      expect(page.items[0]).toMatchObject({
        id: 'github:sickn33/agentic-awesome-skills/skills/react-best-practices',
        source: 'github-index',
        sources: ['github-index', 'skills-sh'],
        installs: 887059,
        category: 'frontend',
        installDir: 'react-best-practices',
      })
      expect(page.items[1]).toMatchObject({
        id: 'skills-sh:vercel-labs/agent-skills/vercel-react-best-practices',
        source: 'skills-sh',
        sources: ['skills-sh'],
        installs: 450000,
        installDir: 'vercel-react-best-practices',
      })

      const filtered = await catalog.catalog('', 'github-index', 'security', 'recent', 1, 24)
      expect(filtered.total).toBe(1)
      expect(filtered.items[0]?.id).toBe('github:sickn33/agentic-awesome-skills/skills/security-audit')
    })
  })

  it('degrades gracefully with a partial warning when one upstream source fails', async () => {
    const fixture = installHttpFixture()
    fixture.setSkillsSh({}, 429)
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      const page = await catalog.catalog('react', 'all', 'all', 'popular', 1, 24)
      expect(page.items).toHaveLength(1)
      expect(page.items[0]?.source).toBe('github-index')
      expect(page.warnings).toEqual([{ source: 'skills-sh', code: 'rate-limited' }])
    })
  })

  it('resolves skills.sh directory via frontmatter name match in recursive tree and installs pinned files atomically', async () => {
    const asset = Buffer.alloc(128, 9)
    installHttpFixture(asset)
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('react', 'skills-sh')
      const detail = await catalog.detail('skills-sh:vercel-labs/agent-skills/vercel-react-best-practices')
      expect(detail.commitSha).toBe(COMMIT)
      expect(detail.resolvedPath).toBe('skills/react-best-practices')
      expect(detail.skill.description).toBe('React guidance for reviewed installs.')
      expect(detail.skill.githubUrl).toBe(`https://github.com/vercel-labs/agent-skills/tree/${COMMIT}/skills/react-best-practices`)
      expect(detail.files).toEqual([
        { path: 'SKILL.md', size: SKILL_BYTES.byteLength, sha: BLOB_SHA },
        { path: 'assets/image.bin', size: asset.byteLength, sha: gitShaOf(asset) },
      ])

      await expect(catalog.installSkill(detail.skill.id, detail.commitSha, false)).rejects.toThrow('Confirm')
      const installed = await catalog.installSkill(detail.skill.id, detail.commitSha, true)
      expect(installed).toMatchObject({
        id: 'vercel-react-best-practices',
        commitSha: COMMIT,
        files: 2,
        totalBytes: SKILL_BYTES.byteLength + asset.byteLength,
      })
      expect(await readFile(join(root, 'vercel-react-best-practices/SKILL.md'), 'utf8')).toBe(SKILL_MARKDOWN)
      expect(await readFile(join(root, 'vercel-react-best-practices/assets/image.bin'))).toEqual(asset)
      expect((await readdir(root)).sort()).toEqual(['.skill-catalog', 'vercel-react-best-practices'])
    })
  })

  it('falls back to Contents API when the recursive Git tree is truncated', async () => {
    const fixture = installHttpFixture()
    fixture.setTreeTruncated(true)
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('react', 'skills-sh')
      const detail = await catalog.detail('skills-sh:vercel-labs/agent-skills/react-best-practices')
      expect(detail.resolvedPath).toBe('skills/react-best-practices')
      expect(detail.skillMarkdown).toBe(SKILL_MARKDOWN)
    })
  })

  it('preserves existing installation if file integrity check or cancellation fails mid-install', async () => {
    const fixture = installHttpFixture()
    const root = await temporaryRoot()
    const target = join(root, 'react-best-practices')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), '# Previous install')
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('react', 'github-index')
      const detail = await catalog.detail('github:sickn33/agentic-awesome-skills/skills/react-best-practices')
      fixture.setSkillBytes(Buffer.from('tampered bytes'))
      await expect(catalog.installSkill(detail.skill.id, detail.commitSha, true))
        .rejects.toMatchObject({ code: 'skill-catalog/file-integrity-failed', details: { path: 'SKILL.md' } })
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('# Previous install')
      expect(await readdir(join(root, '.skill-catalog'))).toEqual([])
    })
  })

  it('rejects skills failing FileSystemSkillProvider frontmatter validation while leaving existing files untouched', async () => {
    const fixture = installHttpFixture()
    fixture.setSkillBytes(Buffer.from('---\nname: Invalid Name\ndescription: Bad skill.\n---\n# Bad'))
    const root = await temporaryRoot()
    const target = join(root, 'react-best-practices')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), '# Valid old skill')
    await withCatalog(root, async (catalog) => {
      await catalog.catalog('react', 'github-index')
      const detail = await catalog.detail('github:sickn33/agentic-awesome-skills/skills/react-best-practices')
      await expect(catalog.installSkill(detail.skill.id, detail.commitSha, true))
        .rejects.toMatchObject({ code: 'skill-catalog/skill-incompatible' })
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('# Valid old skill')
    })
  })

  it('requires search and reviewed commit SHA before detail/install and honors LRU eviction', async () => {
    installHttpFixture()
    const root = await temporaryRoot()
    await withCatalog(root, async (catalog) => {
      await expect(catalog.detail('github:sickn33/agentic-awesome-skills/skills/react-best-practices'))
        .rejects.toMatchObject({ code: 'skill-catalog/search-required' })
      await catalog.catalog('react', 'github-index')
      await expect(catalog.installSkill('github:sickn33/agentic-awesome-skills/skills/react-best-practices', COMMIT, true))
        .rejects.toMatchObject({ code: 'skill-catalog/review-required' })
      const detail = await catalog.detail('github:sickn33/agentic-awesome-skills/skills/react-best-practices')
      await expect(catalog.installSkill(detail.skill.id, '0'.repeat(40), true))
        .rejects.toMatchObject({ code: 'skill-catalog/review-required' })
    })
  })

  it('mounts through Loader, exposes skillCatalog, and supports listInstalledSkills and removeInstalledSkill', async () => {
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
    const internal = ctx.loader.internal
    if (internal === undefined) throw new Error('Loader has no module importer.')
    const importPlugin = async (specifier: string): Promise<typeof SkillCatalogHostPlugin> => {
      if (specifier !== '@deepseek-ai/dsh-community-skill-catalog') throw new Error(`unexpected Loader import: ${specifier}`)
      return SkillCatalogHostPlugin
    }
    internal.import = async (specifier: string) => importPlugin(specifier)
    try {
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
      const catalog = Reflect.get(ctx, 'skillCatalog') as SkillCatalog | undefined
      expect(catalog).toBeDefined()
      if (catalog === undefined) throw new Error('Loader did not mount skillCatalog.')
      await expect(catalog.listInstalledSkills()).resolves.toEqual([{ id: 'legacy-skill', name: 'legacy-skill' }])
      await expect(catalog.removeInstalledSkill('legacy-skill', false)).rejects.toThrow('Confirm')
      await expect(catalog.removeInstalledSkill('../outside', true)).rejects.toThrow('id is invalid')
      await expect(catalog.removeInstalledSkill('legacy-skill', true)).resolves.toBe('legacy-skill')
      await expect(readFile(join(existing, 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
