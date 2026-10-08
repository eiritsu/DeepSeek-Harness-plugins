import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { afterEach, describe, expect, it, vi } from 'vitest'

type FetchMock = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>
const { fetchMock, lookupMock } = vi.hoisted(() => ({ fetchMock: vi.fn<FetchMock>(), lookupMock: vi.fn() }))
vi.mock('undici', () => ({
  Agent: class { close(): Promise<void> { return Promise.resolve() } },
  fetch: fetchMock,
}))
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))

import { SkillsMpCatalog } from '../src/host/skillsmp-catalog.ts'
import * as SkillsMpHostPlugin from '../src/index.ts'
import type { SkillsMpLocale } from '../src/types.ts'

interface Fixture {
  readonly docsHtml: string
  readonly occupationsHtml: string
  leafGroups: {
    readonly groups: {
      readonly parentSlug: string
      readonly items: readonly { readonly slug: string; readonly label: string; readonly skillCount: number }[]
    }[]
  }
}

const ROOT_SLUG = 'management-occupations'
const MID_SLUG = 'top-executives'
const GROUP_SLUG = 'chief-executives-11101'
const LEAF_SLUG = 'chief-executives-111011'

/** Small excerpts copied from the saved SkillsMP Chinese docs, occupation page, and leaf response. */
const REAL_ZH_FIXTURE: Fixture = {
  docsHtml: flightHtml([
    `1:${JSON.stringify({ type: 'category', categories: [{ slug: 'defi', name: 'Defi', domain: 'blockchain', count: 1586 }] })}`,
    `2:${JSON.stringify({ type: 'occupation', occupations: [
      { slug: 'management-occupations', name: 'Management Occupations', parentId: null, level: 1 },
      { slug: 'top-executives', name: 'Top Executives', parentId: 'management-occupations', level: 2 },
      { slug: 'chief-executives-11101', name: 'Chief Executives', parentId: 'top-executives', level: 3 },
      { slug: 'chief-executives-111011', name: 'Chief Executives', parentId: 'chief-executives-11101', level: 4 },
      { slug: 'general-and-operations-managers-111021', name: 'General and Operations Managers', parentId: 'chief-executives-11101', level: 4 },
      { slug: 'legislators-111031', name: 'Legislators', parentId: 'chief-executives-11101', level: 4 },
    ] })}`,
    `3:${JSON.stringify({
      domainNames: { blockchain: '区块链' }, categoryNames: { blockchain: '区块链', defi: 'DeFi' },
      l1Names: { 'management-occupations': '管理类职业' },
    })}`,
  ].join('\n')),
  occupationsHtml: '<!doctype html><html lang="zh"><body>'
    + '<a class="group sticky" href="/zh/occupations/management-occupations"><div><h2>管理类职业</h2><span>SOC 11-0000</span></div><span>1.1万 个 skills</span></a>'
    + '<a class="group" href="/zh/occupations/top-executives"><span>高级管理人员</span><span>SOC 11-1000</span><span>4460 个 skills</span></a>'
    + '<a class="group/tag" href="/zh/occupations/chief-executives-111011"><span>首席执行官</span><span>2452 个 skills</span></a>'
    + '<a class="group/tag" href="/zh/occupations/general-and-operations-managers-111021"><span>综合与运营经理</span><span>1969 个 skills</span></a>'
    + '<a class="group/tag" href="/zh/occupations/legislators-111031"><span>立法者</span><span>39 个 skills</span></a></body></html>',
  leafGroups: {
    groups: [{ parentSlug: 'top-executives', items: [
      { slug: 'chief-executives-111011', label: '首席执行官', skillCount: 2452 },
      { slug: 'general-and-operations-managers-111021', label: '综合与运营经理', skillCount: 1969 },
      { slug: 'legislators-111031', label: '立法者', skillCount: 0 },
    ] }],
  },
}

function response(body: unknown, status = 200): Response {
  const bytes = typeof body === 'string' ? body : JSON.stringify(body)
  return new Response(bytes, { status })
}

function requestUrl(input: URL | RequestInfo): URL {
  if (input instanceof URL) return input
  return new URL(typeof input === 'string' ? input : input.url)
}

function flightHtml(payload: string): string {
  return `<html><body><script>self.__next_f.push(${JSON.stringify([1, payload])})</script></body></html>`
}

function htmlEscape(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
}

function docsHtml(
  categories: readonly Record<string, unknown>[],
  occupations: readonly Record<string, unknown>[],
  messages: {
    readonly categoryNames: Record<string, string>
    readonly domainNames: Record<string, string>
    readonly l1Names: Record<string, string>
  },
): string {
  const frames = [
    `1:${JSON.stringify({ type: 'category', categories })}`,
    `2:${JSON.stringify({ type: 'occupation', occupations })}`,
    `3:${JSON.stringify(messages)}`,
  ]
  return flightHtml(frames.join('\n'))
}

function occupationsHtml(locale: SkillsMpLocale, names: ReadonlyMap<string, { readonly name: string; readonly code?: string }>): string {
  const links = [...names].map(([slug, item]) => {
    const code = item.code === undefined ? '' : `<span>SOC ${htmlEscape(item.code)}</span>`
    return `<a href="/${locale}/occupations/${slug}"><span>${htmlEscape(item.name)}</span>${code}<span>0 skills</span></a>`
  }).join('')
  return `<html><body>${links}</body></html>`
}

function smallFixture(locale: SkillsMpLocale): Fixture {
  const names = locale === 'zh'
    ? { categoryNames: { blockchain: '区块链', defi: '去中心化金融' }, domainNames: { blockchain: '区块链' }, l1Names: { [ROOT_SLUG]: '管理类职业' } }
    : { categoryNames: { blockchain: 'Blockchain', defi: 'Defi' }, domainNames: { blockchain: 'Blockchain' }, l1Names: { [ROOT_SLUG]: 'Management Occupations' } }
  const occupations = [
    { slug: ROOT_SLUG, name: 'Management Occupations', parentId: null, level: 1 },
    { slug: MID_SLUG, name: 'Top Executives', parentId: ROOT_SLUG, level: 2 },
    { slug: GROUP_SLUG, name: 'Chief Executives', parentId: MID_SLUG, level: 3 },
    { slug: LEAF_SLUG, name: 'Chief Executives', parentId: GROUP_SLUG, level: 4 },
    { slug: 'other-management-occupations', name: 'Other Management Occupations', parentId: MID_SLUG, level: 3 },
    { slug: 'farmers-ranchers-and-other-agricultural-managers-119013', name: 'Farmers, Ranchers, and Other Agricultural Managers', parentId: 'other-management-occupations', level: 4 },
  ]
  const anchors = new Map<string, { name: string; code?: string }>([
    [ROOT_SLUG, { name: locale === 'zh' ? '管理类职业' : 'Management Occupations', code: '11-0000' }],
    [MID_SLUG, { name: locale === 'zh' ? '高级管理人员' : 'Top Executives', code: '11-1000' }],
    ['farmers-ranchers-and-other-agricultural-managers-119013', { name: locale === 'zh' ? '农民、牧场主与农业经理' : 'Farmers, Ranchers, and Other Agricultural Managers' }],
  ])
  const leafLabels = locale === 'zh'
    ? [{ slug: LEAF_SLUG, label: '首席执行官', skillCount: 0 }, { slug: 'farmers-ranchers-and-other-agricultural-managers-119013', label: '农业经理', skillCount: 27 }]
    : [{ slug: LEAF_SLUG, label: 'Chief Executives', skillCount: 0 }, { slug: 'farmers-ranchers-and-other-agricultural-managers-119013', label: 'Agricultural Managers', skillCount: 27 }]
  const firstLeaf = leafLabels[0]
  const secondLeaf = leafLabels[1]
  if (firstLeaf === undefined || secondLeaf === undefined) throw new Error('Small taxonomy fixture requires two leaf labels.')
  return {
    docsHtml: docsHtml([{ slug: 'defi', name: 'Defi', domain: 'blockchain', count: 1586 }], occupations, names),
    occupationsHtml: occupationsHtml(locale, anchors),
    leafGroups: {
      groups: [
        { parentSlug: MID_SLUG, items: [firstLeaf] },
        { parentSlug: MID_SLUG, items: [secondLeaf] },
      ],
    },
  }
}

function fullFixture(locale: SkillsMpLocale): Fixture {
  const domainNames: Record<string, string> = {}
  const categoryNames: Record<string, string> = {}
  const categories: Record<string, unknown>[] = []
  for (let index = 0; index < 12; index += 1) {
    const slug = `domain-${index}`
    domainNames[slug] = locale === 'zh' ? `领域 ${index}` : `Domain ${index}`
    categoryNames[slug] = domainNames[slug]!
  }
  for (let index = 0; index < 63; index += 1) {
    const slug = `category-${index}`
    const domain = `domain-${index % 12}`
    categories.push({ slug, name: `Category ${index}`, domain, count: index })
    categoryNames[slug] = locale === 'zh' ? `分类 ${index}` : `Category ${index}`
  }
  const occupations: Record<string, unknown>[] = []
  const l1Names: Record<string, string> = {}
  const anchors = new Map<string, { name: string; code?: string }>()
  const majorSlugs: string[] = []
  const minorSlugs: string[] = []
  const groupSlugs: string[] = []
  const sourceNames = new Map<string, string>()
  for (let index = 0; index < 23; index += 1) {
    const slug = `major-${index}`
    const name = index === 0 ? 'Management Occupations' : `Major ${index}`
    majorSlugs.push(slug)
    sourceNames.set(slug, name)
    occupations.push({ slug, name, parentId: null, level: 1 })
    l1Names[slug] = locale === 'zh' ? `大类 ${index}` : name
    anchors.set(slug, { name: locale === 'zh' ? `大类 ${index}` : name, ...(index === 0 ? { code: '11-0000' } : {}) })
  }
  for (let index = 0; index < 98; index += 1) {
    const slug = `minor-${index}`
    const name = index === 0 ? 'Top Executives' : `Minor ${index}`
    const parentId = majorSlugs[index % majorSlugs.length]
    if (parentId === undefined) throw new Error('Full taxonomy fixture is missing a level-one parent.')
    minorSlugs.push(slug)
    sourceNames.set(slug, name)
    occupations.push({ slug, name, parentId, level: 2 })
    anchors.set(slug, { name: locale === 'zh' ? `中类 ${index}` : name })
  }
  for (let index = 0; index < 459; index += 1) {
    const slug = `group-${index}`
    const name = index === 0 ? 'Chief Executives' : `Occupation Group ${index}`
    const parentId = minorSlugs[index % minorSlugs.length]
    if (parentId === undefined) throw new Error('Full taxonomy fixture is missing a level-two parent.')
    groupSlugs.push(slug)
    sourceNames.set(slug, name)
    occupations.push({ slug, name, parentId, level: 3 })
  }
  const groupedLeaves = new Map<string, { slug: string; label: string; skillCount: number }[]>()
  const leafSlugs: string[] = []
  for (let index = 0; index < 867; index += 1) {
    const slug = `leaf-${index}`
    const parentSlug = groupSlugs[index % groupSlugs.length]
    if (parentSlug === undefined) throw new Error('Full taxonomy fixture is missing a level-three parent.')
    const name = index === 0 ? 'Chief Executives' : `Occupation Leaf ${index}`
    const label = index === 0 ? (locale === 'zh' ? '首席执行官' : name) : (locale === 'zh' ? `职业标签 ${index}` : name)
    leafSlugs.push(slug)
    sourceNames.set(slug, name)
    occupations.push({ slug, name, parentId: parentSlug, level: 4 })
    const parentGroup = minorSlugs[groupSlugs.indexOf(parentSlug) % minorSlugs.length]
    if (parentGroup === undefined) throw new Error('Full taxonomy fixture is missing a level-two parent.')
    const items = groupedLeaves.get(parentGroup) ?? []
    items.push({ slug, label, skillCount: index === 0 ? 0 : index })
    groupedLeaves.set(parentGroup, items)
    if (index === 0) anchors.set(slug, { name: locale === 'zh' ? '首席执行官' : name, code: '11-1011' })
    else anchors.set(slug, { name: locale === 'zh' ? `职业标签 ${index}` : name })
  }
  const occupationRows = occupations.map(row => ({
    ...row,
    name: sourceNames.get(String(row.slug)),
  }))
  return {
    docsHtml: docsHtml( categories, occupationRows, { domainNames, categoryNames, l1Names }),
    occupationsHtml: occupationsHtml(locale, anchors),
    leafGroups: { groups: [...groupedLeaves].map(([parentSlug, items]) => ({ parentSlug, items })) },
  }
}

function installFixture(fixtureByLocale: Record<SkillsMpLocale, Fixture>): string[] {
  const requests: string[] = []
  lookupMock.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  fetchMock.mockReset().mockImplementation(async (input: URL | RequestInfo) => {
    const url = requestUrl(input)
    requests.push(url.href)
    const locale = (url.searchParams.get('locale') ?? url.pathname.split('/')[1]) as SkillsMpLocale
    const fixture = fixtureByLocale[locale]
    if (url.pathname === `/${locale}/docs/api`) return response(fixture.docsHtml)
    if (url.pathname === `/${locale}/occupations`) return response(fixture.occupationsHtml)
    if (url.pathname === '/api/occupations/leaf-groups') return response(fixture.leafGroups)
    return response({ error: 'unexpected taxonomy URL' }, 404)
  })
  return requests
}

async function withCatalog<T>(run: (catalog: SkillsMpCatalog, ctx: Context) => Promise<T>): Promise<T> {
  const ctx = new Context()
  const catalog = new SkillsMpCatalog(ctx, {})
  try { return await run(catalog, ctx) }
  finally { await ctx.fiber.dispose() }
}

afterEach(() => { fetchMock.mockReset(); lookupMock.mockReset() })

describe('SkillsMP taxonomy Remote', () => {
  it('parses the saved Chinese SkillsMP RSC, occupation-page, and leaf-group source fragments', async () => {
    const requests = installFixture({ zh: REAL_ZH_FIXTURE, en: smallFixture('en') })
    await withCatalog(async (catalog) => {
      const taxonomy = await catalog.taxonomy('zh')
      expect(taxonomy.categories).toEqual([
        { slug: 'blockchain', name: '区块链' },
        { slug: 'defi', name: 'DeFi', group: '区块链' },
      ])
      expect(taxonomy.occupations).toHaveLength(6)
      expect(taxonomy.occupations[0]).toMatchObject({ name: '管理类职业', code: '11-0000' })
      expect(taxonomy.occupations.find(item => item.slug === MID_SLUG)).toMatchObject({ name: '高级管理人员', code: '11-1000' })
      expect(taxonomy.occupations.find(item => item.slug === GROUP_SLUG)?.name).toBe('首席执行官')
      expect(taxonomy.occupations.find(item => item.slug === 'legislators-111031')).toMatchObject({ skillCount: 0, level: 4 })
      expect(requests.map(url => new URL(url).pathname)).toEqual(['/zh/docs/api', '/zh/occupations', '/api/occupations/leaf-groups'])
    })
  })

  it.each(['zh', 'en'] as const)('parses the local official-source RSC, occupation HTML, and leaf JSON fixture for %s', async (locale) => {
    const fixture = smallFixture(locale)
    const requests = installFixture({ zh: fixture, en: fixture })
    await withCatalog(async (catalog) => {
      const taxonomy = await catalog.taxonomy(locale)
      expect(taxonomy.categories).toEqual([
        { slug: 'blockchain', name: locale === 'zh' ? '区块链' : 'Blockchain' },
        { slug: 'defi', name: locale === 'zh' ? '去中心化金融' : 'Defi', group: locale === 'zh' ? '区块链' : 'Blockchain' },
      ])
      expect(taxonomy.occupations).toHaveLength(6)
      expect(taxonomy.occupations[0]).toMatchObject({ slug: ROOT_SLUG, level: 1, name: locale === 'zh' ? '管理类职业' : 'Management Occupations', code: '11-0000' })
      expect(taxonomy.occupations.find(item => item.slug === GROUP_SLUG)?.name).toBe(locale === 'zh' ? '首席执行官' : 'Chief Executives')
      expect(taxonomy.occupations.find(item => item.slug === 'other-management-occupations')?.name).toBe('Other Management Occupations')
      expect(taxonomy.occupations.find(item => item.slug === LEAF_SLUG)).toMatchObject({ skillCount: 0, parentId: GROUP_SLUG, level: 4 })
      expect(requests).toHaveLength(3)
    })
  })

  it('merges all current domains and categories and validates the full SOC hierarchy', async () => {
    const fixture = fullFixture('zh')
    installFixture({ zh: fixture, en: fixture })
    await withCatalog(async (catalog) => {
      const taxonomy = await catalog.taxonomy('zh')
      expect(taxonomy.categories).toHaveLength(75)
      expect(taxonomy.occupations).toHaveLength(1447)
      expect(Object.fromEntries([1, 2, 3, 4].map(level => [level, taxonomy.occupations.filter(item => item.level === level).length])))
        .toEqual({ 1: 23, 2: 98, 3: 459, 4: 867 })
      expect(taxonomy.categories.find(item => item.slug === 'domain-0')).toEqual({ slug: 'domain-0', name: '领域 0' })
      expect(taxonomy.categories.find(item => item.slug === 'category-0')).toMatchObject({ name: '分类 0', group: '领域 0' })
      expect(taxonomy.occupations.find(item => item.slug === 'major-0')).toMatchObject({ level: 1, name: '大类 0' })
      expect(taxonomy.occupations.find(item => item.slug === 'minor-0')).toMatchObject({ level: 2, parentId: 'major-0', name: '中类 0' })
      expect(taxonomy.occupations.find(item => item.slug === 'group-0')).toMatchObject({ level: 3, parentId: 'minor-0', name: '首席执行官' })
      expect(taxonomy.occupations.find(item => item.slug === 'group-1')?.name).toBe('Occupation Group 1')
      expect(taxonomy.occupations.find(item => item.slug === 'leaf-0')).toMatchObject({ level: 4, parentId: 'group-0', name: '首席执行官', skillCount: 0, code: '11-1011' })
    })
  })

  it('loads the taxonomy Remote through a real Loader composition', async () => {
    const fixture = smallFixture('zh')
    const requests = installFixture({ zh: fixture, en: smallFixture('en') })
    const root = await mkdtemp(join(tmpdir(), 'dsh-skillsmp-taxonomy-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-community-skill-catalog'",
      '  config:',
      `    skillRoot: ${JSON.stringify(join(root, 'skills'))}`,
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
      if (catalog === undefined) throw new Error('Loader did not mount skillsMpCatalog.')
      const taxonomy = await catalog.taxonomy('zh')
      expect(taxonomy.categories).toHaveLength(2)
      expect(taxonomy.occupations).toHaveLength(6)
      expect(requests).toHaveLength(3)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('caches each locale, force refreshes, and sends no search credential to metadata endpoints', async () => {
    const requests = installFixture({ zh: smallFixture('zh'), en: smallFixture('en') })
    const resolveCredential = vi.fn(async () => ({ value: 'private-skillsmp-key', source: 'test' }))
    const ctx = new Context()
    ctx.provide('credentials', { resolve: resolveCredential } as never)
    const catalog = new SkillsMpCatalog(ctx, { skillsmpCredentialKey: 'SKILLSMP_API_KEY' })
    try {
      await catalog.taxonomy('zh')
      await catalog.taxonomy('zh')
      expect(requests).toHaveLength(3)
      await catalog.taxonomy('en')
      expect(requests).toHaveLength(6)
      await catalog.taxonomy('zh', true)
      expect(requests).toHaveLength(9)
      expect(resolveCredential).not.toHaveBeenCalled()
      expect(fetchMock.mock.calls.every(([, init]) => !new Headers(init?.headers).has('authorization'))).toBe(true)
      expect(requests.every(url => !url.includes('/api/v1/skills/search'))).toBe(true)
    } finally { await ctx.fiber.dispose() }
  })

  it('does not cache an incomplete leaf source', async () => {
    const fixture = smallFixture('zh')
    const original = fixture.leafGroups
    fixture.leafGroups = { groups: [{ parentSlug: MID_SLUG, items: original.groups[0]?.items ?? [] }] }
    const requests = installFixture({ zh: fixture, en: smallFixture('en') })
    await withCatalog(async (catalog) => {
      await expect(catalog.taxonomy('zh')).rejects.toThrow('incomplete')
      expect(requests).toHaveLength(3)
      fixture.leafGroups = original
      const refreshed = await catalog.taxonomy('zh')
      expect(refreshed.occupations).toHaveLength(6)
      expect(requests).toHaveLength(6)
    })
  })
})
