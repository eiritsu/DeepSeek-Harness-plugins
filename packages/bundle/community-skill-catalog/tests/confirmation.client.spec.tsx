// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  SkillCatalogDetail,
  SkillCatalogItem,
  SkillCatalogPage,
  SkillCatalogTaxonomy,
} from '@deepseek-ai/dsh-community-skill-catalog/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { GlobalStandardProps, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh } from '../src/client/locales.ts'
import { SkillCatalogPanel, type SkillCatalogPanelInjected } from '../src/client/SkillCatalogPanel.tsx'
import css from '../src/client/SkillCatalogPage.module.css'

const githubSkill: SkillCatalogItem = {
  id: 'github:sickn33/agentic-awesome-skills/skills/example-skill',
  name: 'Example Skill',
  installDir: 'example-skill',
  skillId: 'example-skill',
  repo: 'sickn33/agentic-awesome-skills',
  author: 'example',
  description: 'A curated sample skill.',
  category: 'development',
  risk: 'safe',
  githubUrl: 'https://github.com/sickn33/agentic-awesome-skills/tree/main/skills/example-skill',
  url: 'https://github.com/sickn33/agentic-awesome-skills/tree/main/skills/example-skill',
  source: 'github-index',
  sources: ['github-index', 'skills-sh'],
  installs: 12450,
  updatedAt: 1_791_446_400,
  dateAdded: '2026-03-10',
}

const skillsShSkill: SkillCatalogItem = {
  id: 'skills-sh:vercel-labs/agent-skills/vercel-react-best-practices',
  name: 'vercel-react-best-practices',
  installDir: 'vercel-react-best-practices',
  skillId: 'vercel-react-best-practices',
  repo: 'vercel-labs/agent-skills',
  author: 'vercel-labs',
  description: '',
  githubUrl: 'https://github.com/vercel-labs/agent-skills',
  url: 'https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
  source: 'skills-sh',
  sources: ['skills-sh'],
  installs: 887059,
}

const samplePage: SkillCatalogPage = {
  items: [githubSkill],
  total: 1,
  totalIsExact: true,
  hasNext: false,
  page: 1,
  pageSize: 24,
}

const sampleDetail: SkillCatalogDetail = {
  skill: { ...skillsShSkill, description: 'React best practices.' },
  commitSha: '0123456789abcdef0123456789abcdef01234567',
  resolvedPath: 'skills/react-best-practices',
  files: [{ path: 'SKILL.md', size: 24, sha: 'a'.repeat(40) }],
  totalBytes: 24,
  skillMarkdown: '<script>alert("x")</script>\n# Example',
}

const defaultTaxonomy: SkillCatalogTaxonomy = {
  categories: [
    { id: 'development', count: 240 },
    { id: 'security', count: 180 },
  ],
  totalIndexed: 420,
  indexRepo: 'sickn33/agentic-awesome-skills',
  fetchedAt: 1_791_446_400_000,
}

function unusedGlobalHook(): never { throw new Error('SkillCatalogPanel does not use global hooks.') }
const globalProps: GlobalStandardProps = {
  usePanelInfo: unusedGlobalHook,
  useSessions: unusedGlobalHook,
  useSessionStatus: unusedGlobalHook,
  useSessionRetainInfo: unusedGlobalHook,
  useWorkspaces: unusedGlobalHook,
  useResource: unusedGlobalHook,
}

function translateFrom(locale: typeof en): TranslateNS<'skillCatalog'> {
  return (key, values) => Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    locale[key as keyof typeof locale] ?? key,
  )
}
const translate = translateFrom(en)
const translateZh = translateFrom(zh)

type TestApi = Omit<SkillCatalogPanelInjected['api'], 'taxonomy'> & {
  readonly taxonomy?: SkillCatalogPanelInjected['api']['taxonomy']
}

function renderPanel(api: TestApi, t: TranslateNS<'skillCatalog'> = translate, onNotifyInstalled = vi.fn()) {
  const fullApi: SkillCatalogPanelInjected['api'] = {
    ...api,
    taxonomy: api.taxonomy ?? vi.fn().mockResolvedValue({ ok: true, value: defaultTaxonomy }),
    listInstalledSkills: api.listInstalledSkills ?? vi.fn().mockResolvedValue({ ok: true, value: [] }),
  }
  const useStore = <S,>(selector: (state: { open: boolean; installRevision: number }) => S): S => (
    selector({ open: true, installRevision: 0 })
  )
  return {
    onNotifyInstalled,
    ...render(
      <SkillCatalogPanel
        {...globalProps}
        api={fullApi}
        useStore={useStore}
        actions={{ open: vi.fn(), close: vi.fn(), notifyInstalled: onNotifyInstalled }}
        t={t}
      />,
    ),
  }
}

afterEach(cleanup)

describe('Dual-source SkillCatalogPanel', () => {
  it('keeps English and Chinese dictionaries in exact key parity', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('loads skills immediately on open with source tabs, category pills, and installed indicator', async () => {
    const catalog = vi.fn().mockResolvedValue({ ok: true, value: samplePage })
    const listInstalledSkills = vi.fn().mockResolvedValue({ ok: true, value: [{ id: 'example-skill', name: 'example-skill' }] })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn(), listInstalledSkills })

    expect(await screen.findByRole('button', { name: githubSkill.name })).toBeTruthy()
    expect(catalog).toHaveBeenCalledWith('', 'all', 'all', 'popular', 1, 24, expect.any(AbortSignal))
    expect(screen.getByText(en.installedTag)).toBeTruthy()
    expect(screen.getByText(en.dualSourceBadge)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Development/i })).toBeTruthy()
  })

  it('switches sources, sorts, and category pills interactively', async () => {
    const catalog = vi.fn().mockResolvedValue({ ok: true, value: samplePage })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() })
    await screen.findByRole('button', { name: githubSkill.name })

    fireEvent.click(screen.getByRole('button', { name: en.sourceSkillsSh }))
    await waitFor(() => {
      expect(catalog).toHaveBeenLastCalledWith('', 'skills-sh', 'all', 'popular', 1, 24, expect.any(AbortSignal))
    })
    expect(screen.getByRole('region', { name: en.quickTopics })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.topic_react }))
    await waitFor(() => {
      expect(catalog).toHaveBeenLastCalledWith('react', 'skills-sh', 'all', 'popular', 1, 24, expect.any(AbortSignal))
    })

    fireEvent.click(screen.getByRole('button', { name: en.sourceAll }))
    fireEvent.click(screen.getByRole('button', { name: /Security/i }))
    await waitFor(() => {
      expect(catalog).toHaveBeenLastCalledWith('react', 'all', 'security', 'popular', 1, 24, expect.any(AbortSignal))
    })

    fireEvent.click(screen.getByRole('button', { name: en.installs }))
    await waitFor(() => {
      expect(catalog).toHaveBeenLastCalledWith('react', 'all', 'security', 'installs', 1, 24, expect.any(AbortSignal))
    })
  })

  it('emptying the search box clears the committed search query and aborts an unsettled keyword request', async () => {
    let resolveSecond: (result: { ok: true; value: SkillCatalogPage }) => void = () => undefined
    const catalog = vi.fn((query: string) => query === 'planner'
      ? new Promise<{ ok: true; value: SkillCatalogPage }>((resolve) => { resolveSecond = resolve })
      : Promise.resolve({ ok: true as const, value: samplePage }))
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() })
    await screen.findByRole('button', { name: githubSkill.name })

    const searchbox = screen.getByRole('searchbox', { name: en.searchPlaceholder })
    fireEvent.change(searchbox, { target: { value: 'planner' } })
    fireEvent.click(screen.getByRole('button', { name: en.search }))
    await waitFor(() => { expect(catalog).toHaveBeenCalledWith('planner', 'all', 'all', 'popular', 1, 24, expect.any(AbortSignal)) })
    const plannerSignal = catalog.mock.calls.find(call => call[0] === 'planner')?.[6]
    expect(plannerSignal?.aborted).toBe(false)

    fireEvent.change(searchbox, { target: { value: '' } })
    await waitFor(() => { expect(plannerSignal?.aborted).toBe(true) })
    await act(async () => { resolveSecond({ ok: true, value: { ...samplePage, items: [skillsShSkill] } }) })
    expect(screen.queryByRole('button', { name: skillsShSkill.name })).toBeNull()
  })

  it('shows degraded partial source warnings without blocking results', async () => {
    const catalog = vi.fn().mockResolvedValue({
      ok: true,
      value: { ...samplePage, warnings: [{ source: 'skills-sh', code: 'unavailable' }] },
    })
    renderPanel({ catalog, detail: vi.fn(), installSkill: vi.fn() }, translateZh)
    expect(await screen.findByText(zh.partialWarningSkillsSh)).toBeTruthy()
    expect(screen.getByRole('button', { name: githubSkill.name })).toBeTruthy()
  })

  it('renders plain-text SKILL.md preview, GitHub and skills.sh links, and confirmed pinned commit install', async () => {
    const notifyInstalled = vi.fn()
    const install = vi.fn().mockResolvedValue({
      ok: true,
      value: { id: 'vercel-react-best-practices', commitSha: sampleDetail.commitSha, path: '/skills/vercel-react-best-practices', files: 1, totalBytes: 24 },
    })
    renderPanel({
      catalog: vi.fn().mockResolvedValue({ ok: true, value: { ...samplePage, items: [skillsShSkill] } }),
      detail: vi.fn().mockResolvedValue({ ok: true, value: sampleDetail }),
      installSkill: install,
    }, translate, notifyInstalled)

    fireEvent.click(await screen.findByRole('button', { name: skillsShSkill.name }))
    const ghLink = await screen.findByRole('link', { name: en.openGitHub })
    const shLink = screen.getByRole('link', { name: en.openSkillsSh })
    expect(ghLink.getAttribute('href')).toBe(skillsShSkill.githubUrl)
    expect(shLink.getAttribute('href')).toBe(skillsShSkill.url)
    expect(shLink.getAttribute('rel')).toContain('noopener')
    expect(document.querySelector('pre')?.textContent).toBe('<script>alert("x")</script>\n# Example')
    expect(document.querySelector('script')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect(install).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: en.reviewTitle })
    expect(dialog.classList.contains(css.confirmDialog ?? '')).toBe(true)
    expect(within(dialog).getByRole('button', { name: en.cancel }).classList.contains(css.cancelButton ?? '')).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: en.confirmInstall }))
    await waitFor(() => {
      expect(install).toHaveBeenCalledWith(skillsShSkill.id, sampleDetail.commitSha, true, expect.any(AbortSignal))
    })
    expect(notifyInstalled).toHaveBeenCalledOnce()
    expect(await screen.findByText(en.installed)).toBeTruthy()
  })

  it('cancels an in-flight install cleanly and keeps the detail view open', async () => {
    type FailedInstall = Extract<Awaited<ReturnType<SkillCatalogPanelInjected['api']['installSkill']>>, { readonly ok: false }>
    let resolveInstall: (value: FailedInstall) => void = () => undefined
    const install = vi.fn(() => new Promise<FailedInstall>((resolve) => { resolveInstall = resolve }))
    renderPanel({
      catalog: vi.fn().mockResolvedValue({ ok: true, value: { ...samplePage, items: [skillsShSkill] } }),
      detail: vi.fn().mockResolvedValue({ ok: true, value: sampleDetail }),
      installSkill: install,
    })

    fireEvent.click(await screen.findByRole('button', { name: skillsShSkill.name }))
    await screen.findByText('SKILL.md')
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmInstall }))
    await waitFor(() => { expect(install).toHaveBeenCalledOnce() })

    const signal = (install.mock.calls[0] as unknown[] | undefined)?.[3] as AbortSignal | undefined
    fireEvent.click(within(screen.getByRole('dialog', { name: en.reviewTitle })).getByRole('button', { name: en.cancel }))
    expect(signal?.aborted).toBe(true)
    resolveInstall({ ok: false, error: new RemoteError('gateway/cancelled', 'cancelled', {}) })
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: en.reviewTitle })).toBeNull() })
    expect(screen.getByText('SKILL.md')).toBeTruthy()
  })

  it('localizes typed errors and redacts tokens in technical details', async () => {
    renderPanel({
      catalog: vi.fn().mockResolvedValue({
        ok: false,
        error: new RemoteError('skill-catalog/rate-limited', 'Authorization: Bearer ghp_secret12345678901234567890', { source: 'github', status: 403 }),
      }),
      detail: vi.fn(),
      installSkill: vi.fn(),
    }, translateZh)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(zh.rateLimited)
    fireEvent.click(screen.getByText(zh.technicalDetails))
    expect(document.body.textContent).not.toContain('ghp_secret12345678901234567890')
    expect(document.body.textContent).toContain('[redacted]')
  })
})
