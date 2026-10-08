// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SkillsMpDetail, SkillsMpPage, SkillsMpSkill, SkillsMpTaxonomy } from '@deepseek-ai/dsh-community-skill-catalog/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { GlobalStandardProps, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh } from '../src/client/locales.ts'
import { SkillCatalogPanel } from '../src/client/SkillCatalogPanel.tsx'
import type { SkillCatalogPanelInjected } from '../src/client/SkillCatalogPanel.tsx'
import css from '../src/client/SkillCatalogPage.module.css'

const skill: SkillsMpSkill = {
  id: 'example/skill', name: 'Example Skill', author: 'example', description: 'A sample skill',
  contentLanguage: 'en', githubUrl: 'https://github.com/example/skill', url: 'https://skillsmp.com/skills/example/skill', stars: 12, updatedAt: 1_791_446_400,
}
const page: SkillsMpPage = { items: [skill], total: 1, totalIsExact: true, hasNext: false, page: 1 }
const detail: SkillsMpDetail = {
  skill, commitSha: '0123456789abcdef0123456789abcdef01234567', files: [{ path: 'SKILL.md', size: 24, sha: 'a'.repeat(40) }], totalBytes: 24,
  skillMarkdown: '<script>alert("x")</script>\n# Example',
}
function unusedGlobalHook(): never { throw new Error('SkillCatalogPanel does not use global standard hooks.') }
const globalProps: GlobalStandardProps = {
  usePanelInfo: unusedGlobalHook, useSessions: unusedGlobalHook, useSessionStatus: unusedGlobalHook,
  useSessionRetainInfo: unusedGlobalHook, useWorkspaces: unusedGlobalHook, useResource: unusedGlobalHook,
}
function translateFrom(locale: typeof en): TranslateNS<'skillCatalog'> {
  return (key, values) => Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    locale[key as keyof typeof locale] ?? key,
  )
}
const translate = translateFrom(en)
const translateZh = translateFrom(zh)
const openStore = <S,>(selector: (state: { open: boolean }) => S): S => selector({ open: true })

type TestCatalogApi = Omit<SkillCatalogPanelInjected['api'], 'taxonomy'> & {
  readonly taxonomy?: SkillCatalogPanelInjected['api']['taxonomy']
}

function renderPanel(api: TestCatalogApi, t: TranslateNS<'skillCatalog'> = translate) {
  const fullApi: SkillCatalogPanelInjected['api'] = {
    ...api,
    taxonomy: api.taxonomy ?? vi.fn().mockResolvedValue({ ok: true, value: { categories: [], occupations: [] } }),
  }
  return render(<SkillCatalogPanel {...globalProps} api={fullApi} useStore={openStore} actions={{ open: vi.fn(), close: vi.fn() }} t={t} />)
}

afterEach(cleanup)

describe('SkillsMP catalog', () => {
  it('keeps English and Chinese dictionaries in parity', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('shows the requested task prompt and does not fetch an empty query', async () => {
    const catalog = vi.fn()
    const taxonomy = vi.fn().mockResolvedValue({ ok: true, value: { categories: [], occupations: [] } })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn(), taxonomy })
    expect(screen.getByRole('searchbox', { name: en.searchPlaceholder })).toBeTruthy()
    expect(screen.getByText(en.searchPrompt)).toBeTruthy()
    expect(screen.getByRole('region', { name: en.useCasesTitle }).textContent).toMatchSnapshot('initial use-case buttons')
    expect(catalog).not.toHaveBeenCalled()
    await waitFor(() => { expect(taxonomy).toHaveBeenCalledWith('en', false, expect.any(AbortSignal)) })
    expect(screen.getAllByRole('button').some(button => button.textContent === en.programming)).toBe(true)
  })

  it('keeps advanced filters open across rerenders and exposes keyboard-operable disclosure semantics', async () => {
    let resolveTaxonomy: (result: { readonly ok: true; readonly value: SkillsMpTaxonomy }) => void = () => undefined
    const taxonomy = vi.fn(() => new Promise<{ readonly ok: true; readonly value: SkillsMpTaxonomy }>((resolve) => {
      resolveTaxonomy = resolve
    }))
    renderPanel({ catalog: vi.fn(), detail: vi.fn(), installSkill: vi.fn(), taxonomy })
    await waitFor(() => { expect(taxonomy).toHaveBeenCalledWith('en', false, expect.any(AbortSignal)) })
    const toggle = screen.getByRole('button', { name: en.advancedFilters })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    toggle.focus()
    const keyboardActivation = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    expect(toggle.dispatchEvent(keyboardActivation)).toBe(true)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('status').textContent).toBe(en.taxonomyLoading)
    resolveTaxonomy({ ok: true, value: { categories: [], occupations: [] } })
    await screen.findByRole('combobox', { name: /^Category:/u })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: en.advancedFilters })).toBeTruthy()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const keyboardExpand = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    expect(toggle.dispatchEvent(keyboardExpand)).toBe(true)
    fireEvent.click(toggle)
    fireEvent.change(screen.getByLabelText(en.language), { target: { value: 'zh' } })
    expect(screen.getByRole('button', { name: en.advancedFilters }).getAttribute('aria-expanded')).toBe('true')
    const collapse = screen.getByRole('button', { name: en.advancedFilters })
    const enterCollapse = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    expect(collapse.dispatchEvent(enterCollapse)).toBe(true)
    fireEvent.click(collapse)
    expect(screen.getByRole('button', { name: en.advancedFilters }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: en.advancedFilters })).toBeNull()
  })

  it('submits a visible task query from a common use case', async () => {
    const catalog = vi.fn().mockResolvedValue({ ok: true, value: page })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: en.programming }))
    await screen.findByRole('button', { name: skill.name })
    expect(screen.getByRole<HTMLInputElement>('searchbox', { name: en.searchPlaceholder }).value).toBe('typescript code review')
    expect(catalog).toHaveBeenCalledWith('typescript code review', undefined, undefined, undefined, 'stars', 1, 24, expect.any(AbortSignal))
  })

  it('returns to the initial browse state when an emptied query box follows a search', async () => {
    const catalog = vi.fn().mockResolvedValue({ ok: true, value: page })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() })
    const searchbox = screen.getByRole('searchbox', { name: en.searchPlaceholder })
    fireEvent.change(searchbox, { target: { value: 'planner' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    await screen.findByRole('button', { name: skill.name })
    expect(document.querySelector('footer')?.textContent).toContain('Page 1')

    fireEvent.change(searchbox, { target: { value: 'weekly plan' } })
    expect(catalog).toHaveBeenCalledOnce()
    fireEvent.change(searchbox, { target: { value: '' } })
    expect(screen.queryByRole('button', { name: skill.name })).toBeNull()
    expect(screen.getByRole('region', { name: en.useCasesTitle }).textContent).toMatchSnapshot('initial use-case buttons')
    expect(screen.getByText(en.searchPrompt)).toBeTruthy()
    expect(document.querySelector('footer')).toBeNull()
    expect(catalog).toHaveBeenCalledOnce()
  })

  it('aborts an unsettled search when the query box empties and drops its late result', async () => {
    let resolveSearch: (result: { ok: true; value: SkillsMpPage }) => void = () => undefined
    const catalog = vi.fn((..._call: Parameters<SkillCatalogPanelInjected['api']['catalog']>) =>
      new Promise<{ ok: true; value: SkillsMpPage }>((resolve) => { resolveSearch = resolve }))
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() })
    const searchbox = screen.getByRole('searchbox', { name: en.searchPlaceholder })
    fireEvent.change(searchbox, { target: { value: 'planner' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    await waitFor(() => { expect(catalog).toHaveBeenCalledOnce() })
    const request = catalog.mock.calls[0]?.[7]
    expect(request?.aborted).toBe(false)

    fireEvent.change(searchbox, { target: { value: '' } })
    await waitFor(() => { expect(request?.aborted).toBe(true) })
    await act(async () => { resolveSearch({ ok: true, value: page }) })
    expect(screen.queryByRole('button', { name: skill.name })).toBeNull()
    expect(screen.getByRole('region', { name: en.useCasesTitle })).toBeTruthy()
    expect(document.querySelector('footer')).toBeNull()
  })

  it('keeps a late search failure from returning an error after the query box empties', async () => {
    let rejectSearch: (reason: unknown) => void = () => undefined
    const catalog = vi.fn(() => new Promise<never>((_resolve, reject) => { rejectSearch = reject }))
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() })
    const searchbox = screen.getByRole('searchbox', { name: en.searchPlaceholder })
    fireEvent.change(searchbox, { target: { value: 'planner' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    await waitFor(() => { expect(catalog).toHaveBeenCalledOnce() })

    fireEvent.change(searchbox, { target: { value: '' } })
    await act(async () => { rejectSearch(new RemoteError('skillsmp/rate-limited', 'Try again later.', { status: 429 })) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('region', { name: en.useCasesTitle })).toBeTruthy()
  })

  it('treats a whitespace-only query box as empty and leaves the advanced filter drafts in place', async () => {
    const catalog = vi.fn().mockResolvedValue({ ok: true, value: page })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() })
    fireEvent.click(screen.getByRole('button', { name: en.advancedFilters }))
    fireEvent.change(await screen.findByLabelText(en.language), { target: { value: 'zh' } })
    fireEvent.change(screen.getByLabelText(en.sort), { target: { value: 'recent' } })
    const searchbox = screen.getByRole('searchbox', { name: en.searchPlaceholder })
    fireEvent.change(searchbox, { target: { value: 'planner' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    await screen.findByRole('button', { name: skill.name })

    fireEvent.change(searchbox, { target: { value: '   ' } })
    expect(screen.queryByRole('button', { name: skill.name })).toBeNull()
    expect(screen.getByRole('region', { name: en.useCasesTitle })).toBeTruthy()
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.language }).value).toBe('zh')
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.sort }).value).toBe('recent')
    expect(screen.getByRole('button', { name: en.search })).toHaveProperty('disabled', true)
    expect(catalog).toHaveBeenCalledOnce()
  })

  it('keeps older catalog responses from replacing the current search results', async () => {
    let resolveOld: (result: { ok: true; value: SkillsMpPage }) => void = () => undefined
    const catalog = vi.fn((query: string) => query === 'old query'
      ? new Promise<{ ok: true; value: SkillsMpPage }>((resolve) => { resolveOld = resolve })
      : Promise.resolve({ ok: true as const, value: { ...page, items: [{ ...skill, id: 'new', name: 'New result' }] } }))
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() })
    const searchbox = screen.getByRole('searchbox', { name: en.searchPlaceholder })
    fireEvent.change(searchbox, { target: { value: 'old query' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    await waitFor(() => { expect(catalog).toHaveBeenCalledOnce() })
    fireEvent.change(searchbox, { target: { value: 'new query' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    expect(await screen.findByRole('button', { name: 'New result' })).toBeTruthy()
    resolveOld({ ok: true, value: page })
    await waitFor(() => { expect(screen.queryByRole('button', { name: skill.name })).toBeNull() })
    expect(screen.getByRole('button', { name: 'New result' })).toBeTruthy()
  })

  it('loads localized taxonomy, groups every occupation, and submits only selected slugs', async () => {
    const catalog = vi.fn().mockResolvedValue({ ok: true, value: { ...page, page: 1 } })
    const taxonomyValue: SkillsMpTaxonomy = {
      categories: [{ slug: 'data-ai', name: '数据分析', group: '数据与技术' }],
      occupations: [
        { slug: 'software-developers', name: '软件开发人员', level: 1, code: '15-1252', skillCount: 28 },
        { slug: 'application-development', name: '应用开发', parentId: 'software-developers', level: 2, code: '15-1250', skillCount: 28 },
        { slug: 'application-development-areas', name: '软件职业 27', parentId: 'application-development', level: 3 },
        ...Array.from({ length: 28 }, (_, index): SkillsMpTaxonomy['occupations'][number] => ({
          slug: `software-role-${index}`,
          name: `软件职业 ${index}`,
          parentId: 'application-development-areas',
          level: 4,
          code: `15-${String(1000 + index)}`,
          skillCount: index + 1,
        })),
        { slug: 'marketing-managers', name: '市场营销经理', level: 1 },
        { slug: 'marketing-operations', name: '营销运营', parentId: 'marketing-managers', level: 2 },
        { slug: 'marketing-operations-leaf', name: '营销运营专员', parentId: 'marketing-operations', level: 4 },
      ],
    }
    const taxonomy = vi.fn().mockResolvedValue({
      ok: true,
      value: taxonomyValue,
    })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn(), taxonomy }, translateZh)
    fireEvent.change(screen.getByRole('searchbox', { name: zh.searchPlaceholder }), { target: { value: 'incident response' } })
    fireEvent.click(screen.getByRole('button', { name: zh.search }))
    await screen.findByRole('button', { name: skill.name })
    fireEvent.click(screen.getByText(zh.advancedFilters))
    await waitFor(() => { expect(taxonomy).toHaveBeenCalledWith('zh', false, expect.any(AbortSignal)) })
    const category = screen.getByRole('combobox', { name: /^分类:/u })
    fireEvent.click(category)
    const categorySearch = screen.getByRole('searchbox', { name: zh.searchCategories })
    fireEvent.click(await screen.findByRole('option', { name: '数据与技术' }))
    expect(await screen.findByRole('option', { name: /数据分析/u })).toBeTruthy()
    fireEvent.keyDown(categorySearch, { key: 'ArrowLeft' })
    expect(await screen.findByRole('option', { name: '数据与技术' })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: '数据与技术' }))
    fireEvent.change(categorySearch, { target: { value: 'data-ai' } })
    expect(screen.queryByRole('option', { name: 'data-ai' })).toBeNull()
    fireEvent.change(categorySearch, { target: { value: '数据' } })
    fireEvent.click(await screen.findByRole('option', { name: /数据分析/u }))
    expect(category.textContent).toContain('数据分析')
    expect(document.body.textContent).not.toContain('data-ai')
    const occupationField = screen.getByRole('button', { name: new RegExp(`^${zh.occupation}:`, 'u') })
    fireEvent.click(occupationField)
    expect(await screen.findByRole('listbox', { name: zh.occupationMajorGroups })).toBeTruthy()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: zh.title })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: zh.occupationPickerTitle })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /^软件开发人员/u }))
    fireEvent.click(screen.getByRole('option', { name: /^应用开发/u }))
    expect(within(screen.getByRole('listbox', { name: '应用开发' })).getAllByRole('option')).toHaveLength(28)
    const search = screen.getByRole<HTMLInputElement>('combobox', { name: zh.searchOccupations })
    fireEvent.change(search, { target: { value: 'software-role-27' } })
    expect(screen.queryByRole('option', { name: /software-role-27/u })).toBeNull()
    fireEvent.change(search, { target: { value: '软件职业 27' } })
    expect(await screen.findByRole('option', { name: /^软件职业 27/u })).toBeTruthy()
    expect(screen.getAllByRole('option', { name: /^软件职业 27/u })).toHaveLength(1)
    expect(screen.getByText('软件开发人员 › 应用开发')).toBeTruthy()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.queryByRole('combobox', { name: zh.searchOccupations })).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(`^${zh.occupation}:`, 'u') }).textContent).toContain('软件开发人员 › 应用开发 › 软件职业 27')
    expect(document.body.textContent).not.toContain('software-role-27')
    fireEvent.change(screen.getByLabelText(zh.language), { target: { value: 'zh' } })
    fireEvent.change(screen.getByLabelText(zh.sort), { target: { value: 'recent' } })
    expect(catalog).toHaveBeenCalledTimes(1)
    expect(taxonomy).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: zh.applyFilters }))
    await waitFor(() => {
      expect(catalog).toHaveBeenLastCalledWith('incident response', 'data-ai', 'software-role-27', 'zh', 'recent', 1, 24, expect.any(AbortSignal))
    })
    expect(screen.getByRole('option', { name: zh.language_ja })).toBeTruthy()
    expect(taxonomy).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: zh.refreshTaxonomy }))
    await waitFor(() => { expect(taxonomy).toHaveBeenLastCalledWith('zh', true, expect.any(AbortSignal)) })
  })

  it('uses hasNext without presenting an inexact total as a count', async () => {
    const catalog = vi.fn().mockResolvedValue({ ok: true, value: { ...page, total: 301, totalIsExact: false, hasNext: true } })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() })
    fireEvent.change(screen.getByRole('searchbox', { name: en.searchPlaceholder }), { target: { value: 'planner' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    await screen.findByRole('button', { name: skill.name })
    expect(document.querySelector('footer')?.textContent).toContain('Items on this page: 1')
    expect(document.querySelector('footer')?.textContent).not.toContain('301')
    const next = screen.getByRole('button', { name: en.next })
    expect(next).toHaveProperty('disabled', false)
    fireEvent.click(next)
    await waitFor(() => {
      expect(catalog).toHaveBeenLastCalledWith('planner', undefined, undefined, undefined, 'stars', 2, 24, expect.any(AbortSignal))
    })
    expect(document.querySelector('footer')?.textContent).toContain('Page 2 · Items on this page: 1')
  })

  it('renders the source link, plain text preview, file inventory, and pinned commit', async () => {
    const api = {
      catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
      detail: vi.fn().mockResolvedValue({ ok: true, value: detail }),
      installSkill: vi.fn(),
    }
    renderPanel(api)
    fireEvent.change(screen.getByRole('searchbox', { name: en.searchPlaceholder }), { target: { value: 'example skill' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    fireEvent.click(await screen.findByRole('button', { name: skill.name }))
    const skillsMpLink = await screen.findByRole('link', { name: en.openSkillsMp })
    expect(skillsMpLink.getAttribute('href')).toBe(skill.url)
    expect(skillsMpLink.getAttribute('rel')).toContain('noopener')
    const githubLink = screen.getByRole('link', { name: en.openGitHub })
    expect(githubLink.getAttribute('href')).toBe(skill.githubUrl)
    expect(screen.getByText(detail.commitSha)).toBeTruthy()
    expect(document.querySelector('pre')?.textContent).toBe('<script>alert("x")</script>\n# Example')
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getByText('SKILL.md')).toBeTruthy()
    expect(document.querySelector('dl')?.textContent).toContain(en.starsMeaning)
  })

  it('installs only after confirmation and sends the reviewed commit SHA', async () => {
    const install = vi.fn().mockResolvedValue({ ok: true, value: { id: skill.id, commitSha: detail.commitSha, path: '/skills/example', files: 1, totalBytes: 24 } })
    renderPanel({
      catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
      detail: vi.fn().mockResolvedValue({ ok: true, value: detail }),
      installSkill: install,
    })
    fireEvent.change(screen.getByRole('searchbox', { name: en.searchPlaceholder }), { target: { value: 'example skill' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    fireEvent.click(await screen.findByRole('button', { name: skill.name }))
    await screen.findByText('SKILL.md')
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect(install).not.toHaveBeenCalled()
    const reviewDialog = screen.getByRole('dialog', { name: en.reviewTitle })
    const confirmDialogClass = css.confirmDialog
    if (confirmDialogClass === undefined) throw new Error('The confirmation dialog style is missing.')
    const cancelButtonClass = css.cancelButton
    if (cancelButtonClass === undefined) throw new Error('The cancel button style is missing.')
    expect(reviewDialog.classList.contains(confirmDialogClass)).toBe(true)
    expect(within(reviewDialog).getByRole('button', { name: en.cancel }).classList.contains(cancelButtonClass)).toBe(true)
    expect(within(reviewDialog).getByText(en.confirmBody.replace('{name}', skill.name).replace('{commit}', detail.commitSha).replace('{files}', '1').replace('{target}', en.installTarget))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.confirmInstall }))
    await waitFor(() => {
      expect(install).toHaveBeenCalledWith(skill.githubUrl, detail.commitSha, true, expect.any(AbortSignal))
    })
    expect(await screen.findByText(en.installed)).toBeTruthy()
  })

  it('cancels a pending installation and keeps its confirmation until the request settles', async () => {
    type FailedInstall = Extract<Awaited<ReturnType<SkillCatalogPanelInjected['api']['installSkill']>>, { readonly ok: false }>
    let resolveInstall: (value: FailedInstall) => void = () => undefined
    const install = vi.fn((_url: string, _sha: string, _confirmed: boolean, _signal?: AbortSignal) => (
      new Promise<FailedInstall>((resolve) => { resolveInstall = resolve })
    ))
    renderPanel({
      catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
      detail: vi.fn().mockResolvedValue({ ok: true, value: detail }),
      installSkill: install,
    })
    fireEvent.change(screen.getByRole('searchbox', { name: en.searchPlaceholder }), { target: { value: 'example skill' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    fireEvent.click(await screen.findByRole('button', { name: skill.name }))
    await screen.findByText('SKILL.md')
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmInstall }))
    await waitFor(() => { expect(install).toHaveBeenCalledOnce() })
    const signal = install.mock.calls[0]?.[3]
    const dialog = screen.getByRole('dialog', { name: en.reviewTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
    expect(signal?.aborted).toBe(true)
    expect(screen.getByRole('dialog', { name: en.reviewTitle })).toBeTruthy()
    resolveInstall({ ok: false, error: new RemoteError('gateway/cancelled', 'cancelled', {}) })
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: en.reviewTitle })).toBeNull() })
    expect(screen.getByText('SKILL.md')).toBeTruthy()
  })

  it('shows errors in the active locale', async () => {
    const catalog = vi.fn().mockRejectedValue({ code: 'gateway/unavailable', message: 'provider offline', details: { status: 503 } })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() }, translateZh)
    fireEvent.change(screen.getByRole('searchbox', { name: zh.searchPlaceholder }), { target: { value: '搜索' } })
    fireEvent.click(screen.getByRole('button', { name: zh.search }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.retry })).toBeTruthy()
    fireEvent.click(screen.getByText(zh.technicalDetails))
    expect(document.body.textContent).toContain('"code":"gateway/unavailable"')
    expect(document.body.textContent).not.toContain('[object Object]')
  })

  it('localizes a typed unavailable source and shows redacted details on demand', async () => {
    const api = {
      catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
      detail: vi.fn().mockResolvedValue({ ok: false, error: new RemoteError('skillsmp/source-unavailable', 'Authorization: Bearer secret-token', { status: 503 }) }),
      installSkill: vi.fn(),
    }
    renderPanel(api, translateZh)
    fireEvent.change(screen.getByRole('searchbox', { name: zh.searchPlaceholder }), { target: { value: '技能' } })
    fireEvent.click(screen.getByRole('button', { name: zh.search }))
    fireEvent.click(await screen.findByRole('button', { name: skill.name }))
    expect((await screen.findByRole('alert')).textContent).toContain(zh.skillsMpSourceUnavailable)
    fireEvent.click(screen.getByText(zh.technicalDetails))
    expect(screen.getByText('Authorization: Bearer [redacted]')).toBeTruthy()
    expect(document.body.textContent).not.toContain('secret-token')
  })

  it('explains incomplete manifests without exposing paths or raw source errors', async () => {
    renderPanel({
      catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
      detail: vi.fn().mockResolvedValue({
        ok: false,
        error: new RemoteError('skillsmp/manifest-incomplete', 'Incomplete manifest', { skippedFiles: 2, limitReason: 'file_count' }),
      }),
      installSkill: vi.fn(),
    }, translateZh)
    fireEvent.change(screen.getByRole('searchbox', { name: zh.searchPlaceholder }), { target: { value: '技能' } })
    fireEvent.click(screen.getByRole('button', { name: zh.search }))
    fireEvent.click(await screen.findByRole('button', { name: skill.name }))
    expect((await screen.findByRole('alert')).textContent).toContain('2 个文件')
    expect(screen.getByRole('alert').textContent).toContain(zh.manifestFileCountLimit)
    expect(screen.getByText('Incomplete manifest').closest('details')?.open).toBe(false)
  })

  it('localizes source and review cache expiry prompts', async () => {
    const catalog = vi.fn().mockResolvedValue({
      ok: false,
      error: new RemoteError('skillsmp/search-required', 'Search required', {}),
    })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() })
    fireEvent.change(screen.getByRole('searchbox', { name: en.searchPlaceholder }), { target: { value: 'example skill' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    expect((await screen.findByRole('alert')).textContent).toContain(en.skillsMpSearchRequired)
  })

  it('asks the user to review the source again when its manifest cache expires', async () => {
    renderPanel({
      catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
      detail: vi.fn().mockResolvedValue({ ok: false, error: new RemoteError('skillsmp/review-required', 'Review required', {}) }),
      installSkill: vi.fn(),
    })
    fireEvent.change(screen.getByRole('searchbox', { name: en.searchPlaceholder }), { target: { value: 'example skill' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    fireEvent.click(await screen.findByRole('button', { name: skill.name }))
    expect((await screen.findByRole('alert')).textContent).toContain(en.skillsMpReviewRequired)
  })
})
