// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SkillHubDetail, SkillHubPage } from '@deepseek-ai/dsh-community-skill-catalog/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { GlobalStandardProps, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh } from '../src/client/locales.ts'
import { SkillCatalogPanel } from '../src/client/SkillCatalogPanel.tsx'
import type { SkillCatalogPanelInjected } from '../src/client/SkillCatalogPanel.tsx'

const page: SkillHubPage = {
  total: 1,
  items: [{ canonicalName: '@example/example-skill', slug: 'example-skill', name: 'Example Skill', description: 'A sample skill', category: 'coding', source: 'community', version: '1.2.0', downloads: 12, stars: 2, requiresApiKey: false, url: 'https://skillhub.cn/skills/example-skill' }],
}
const detail: SkillHubDetail = {
  skill: page.items[0]!, owner: 'publisher', changelog: 'Security fixes', files: [{ path: 'SKILL.md', size: 24, sha256: 'a'.repeat(64) }], totalBytes: 24,
}
type FailedInstall = Extract<Awaited<ReturnType<SkillCatalogPanelInjected['api']['installSkill']>>, { readonly ok: false }>
function unusedGlobalHook(): never {
  throw new Error('SkillCatalogPanel does not use global standard hooks.')
}
const globalProps: GlobalStandardProps = {
  usePanelInfo: unusedGlobalHook,
  useSessions: unusedGlobalHook,
  useSessionStatus: unusedGlobalHook,
  useSessionRetainInfo: unusedGlobalHook,
  useWorkspaces: unusedGlobalHook,
  useResource: unusedGlobalHook,
}
const translate: TranslateNS<'skillCatalog'> = (key, values) => Object.entries(values ?? {}).reduce(
  (text, [name, value]) => text.replace(`{${name}}`, String(value)),
  en[key as keyof typeof en] ?? key,
)
const translateZh: TranslateNS<'skillCatalog'> = (key, values) => Object.entries(values ?? {}).reduce(
  (text, [name, value]) => text.replace(`{${name}}`, String(value)),
  zh[key as keyof typeof zh] ?? key,
)

afterEach(cleanup)

describe('SkillHub install confirmation', () => {
  it('explains when network policy blocks a non-public DNS answer', async () => {
    const props = {
      api: {
        catalog: vi.fn().mockRejectedValue(new Error('SkillHub URL host api.skillhub.cn did not resolve exclusively to public addresses.')),
        detail: vi.fn(),
        installSkill: vi.fn(),
      },
      useStore: <S,>(selector: (state: { open: boolean }) => S): S => selector({ open: true }),
      actions: { open: vi.fn(), close: vi.fn() },
      t: translate,
    }
    render(<SkillCatalogPanel {...globalProps} {...props} />)
    expect((await screen.findByRole('alert')).textContent).toContain(en.networkDenied)
    expect(screen.queryByText('Page 1 of 0')).toBeNull()
    expect(screen.queryByText('0 skills')).toBeNull()
  })

  it('uses localized search and dropdown filters populated from observed results', async () => {
    const nextPage: SkillHubPage = {
      total: 48,
      items: [{ ...page.items[0]!, canonicalName: '@example/docs-skill', slug: 'docs-skill', name: 'Docs Skill', category: 'documentation', source: 'partner' }],
    }
    const catalog = vi.fn(async (
      _query?: string,
      _category?: string,
      _source?: string,
      _apiKey?: string,
      _sort?: string,
      requestedPage?: number,
    ) => ({ ok: true as const, value: requestedPage === 2 ? nextPage : { ...page, total: 48 } }))
    const props = {
      api: { catalog, detail: vi.fn(), installSkill: vi.fn() },
      useStore: <S,>(selector: (state: { open: boolean }) => S): S => selector({ open: true }),
      actions: { open: vi.fn(), close: vi.fn() },
      t: translate,
    }
    render(<SkillCatalogPanel {...globalProps} {...props} />)
    expect(await screen.findByRole('button', { name: en.search })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: en.searchPlaceholder })).toBeTruthy()

    const category = screen.getByLabelText(en.category) as HTMLSelectElement
    const source = screen.getByLabelText(en.source) as HTMLSelectElement
    await screen.findByRole('option', { name: 'coding' })
    expect(within(source).getByRole('option', { name: en.official })).toBeTruthy()
    expect(within(source).getByRole('option', { name: en.community })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: en.next }))
    await screen.findByRole('option', { name: 'documentation' })
    expect(within(source).getByRole('option', { name: 'partner' })).toBeTruthy()

    fireEvent.change(category, { target: { value: 'documentation' } })
    await waitFor(() => { expect(category.value).toBe('documentation') })
    expect(catalog).toHaveBeenLastCalledWith('', 'documentation', 'all', 'all', 'score', 1, 24, expect.any(AbortSignal))
    fireEvent.change(source, { target: { value: 'partner' } })
    await waitFor(() => { expect(source.value).toBe('partner') })
    expect(catalog).toHaveBeenLastCalledWith('', 'documentation', 'partner', 'all', 'score', 1, 24, expect.any(AbortSignal))
  })

  it('shows a zero result count instead of a nonexistent page range', async () => {
    const props = {
      api: {
        catalog: vi.fn().mockResolvedValue({ ok: true, value: { items: [], total: 0 } }),
        detail: vi.fn(),
        installSkill: vi.fn(),
      },
      useStore: <S,>(selector: (state: { open: boolean }) => S): S => selector({ open: true }),
      actions: { open: vi.fn(), close: vi.fn() },
      t: translate,
    }
    render(<SkillCatalogPanel {...globalProps} {...props} />)
    expect(await screen.findByText('0 skills')).toBeTruthy()
    expect(screen.queryByText('Page 1 of 0')).toBeNull()
  })

  it('installs only after explicit confirmation of the selected exact release', async () => {
    const install = vi.fn().mockResolvedValue({ ok: true, value: { canonicalName: '@example/example-skill', slug: 'example-skill', version: '1.2.0', path: '/skills/example-skill', files: 1, totalBytes: 24 } })
    const props = {
      api: {
        catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
        detail: vi.fn().mockResolvedValue({ ok: true, value: detail }),
        installSkill: install,
      },
      useStore: <S,>(selector: (state: { open: boolean }) => S): S => selector({ open: true }),
      actions: { open: vi.fn(), close: vi.fn() },
      t: translate,
    }
    render(<SkillCatalogPanel {...globalProps} {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Example Skill' }))
    await screen.findByText('SKILL.md')
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    expect(screen.getByRole('button', { name: en.confirmInstall })).toHaveProperty('disabled', false)
    expect(install).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.confirmInstall }))
    await waitFor(() => { expect(install).toHaveBeenCalledWith('@example/example-skill', '1.2.0', true, expect.any(AbortSignal)) })
    expect(await screen.findByText(en.installed)).toBeTruthy()
  })

  it('localizes a configured ZIP budget failure with an actionable limit', async () => {
    const install = vi.fn().mockResolvedValue({
      ok: false,
      error: new RemoteError('skillhub/install-limit', 'Host resource limit', { budget: 'archive', limit: 134217728 }),
    })
    const props = {
      api: {
        catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
        detail: vi.fn().mockResolvedValue({ ok: true, value: detail }),
        installSkill: install,
      },
      useStore: <S,>(selector: (state: { open: boolean }) => S): S => selector({ open: true }),
      actions: { open: vi.fn(), close: vi.fn() },
      t: translateZh,
    }
    render(<SkillCatalogPanel {...globalProps} {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Example Skill' }))
    await screen.findByText('SKILL.md')
    fireEvent.click(screen.getByRole('button', { name: zh.install }))
    fireEvent.click(screen.getByRole('button', { name: zh.confirmInstall }))
    const alert = (await screen.findByRole('alert')).textContent ?? ''
    expect(alert).toContain('压缩包大小')
    expect(alert).toContain('134,217,728')
    expect(alert).not.toContain('SkillHub installation exceeds')
    expect(screen.queryByText(zh.installing)).toBeNull()
  })

  it('keeps confirmation open and detail navigation disabled until cancellation settles', async () => {
    let resolveInstall: (result: FailedInstall) => void = () => undefined
    const install = vi.fn((_slug: string, _version: string, _confirmed: boolean, _signal: AbortSignal) => (
      new Promise<FailedInstall>((resolve) => { resolveInstall = resolve })
    ))
    const props = {
      api: {
        catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
        detail: vi.fn().mockResolvedValue({ ok: true, value: detail }),
        installSkill: install,
      },
      useStore: <S,>(selector: (state: { open: boolean }) => S): S => selector({ open: true }),
      actions: { open: vi.fn(), close: vi.fn() },
      t: translate,
    }
    render(<SkillCatalogPanel {...globalProps} {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Example Skill' }))
    await screen.findByText('SKILL.md')
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmInstall }))
    await waitFor(() => { expect(install).toHaveBeenCalledWith('@example/example-skill', '1.2.0', true, expect.any(AbortSignal)) })
    const signal = install.mock.calls[0]?.[3]
    expect(screen.getByRole('button', { name: en.back })).toHaveProperty('disabled', true)
    const reviewDialog = screen.getByRole('dialog', { name: en.reviewTitle })
    expect(reviewDialog).toBeTruthy()
    expect(within(reviewDialog).getAllByRole('button', { name: en.cancel })).toHaveLength(1)
    expect(within(reviewDialog).getAllByText(en.installing)).toHaveLength(1)
    expect(screen.queryAllByText(en.installing)).toHaveLength(1)
    expect(screen.getByRole('button', { name: en.close })).toHaveProperty('disabled', true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: en.reviewTitle })).toBeTruthy()
    const reviewBackdrop = reviewDialog.previousElementSibling
    expect(reviewBackdrop).not.toBeNull()
    fireEvent.click(reviewBackdrop!)
    expect(screen.getByRole('dialog', { name: en.reviewTitle })).toBeTruthy()
    fireEvent.click(within(reviewDialog).getByRole('button', { name: en.cancel }))
    expect(signal?.aborted).toBe(true)
    expect(screen.getByRole('dialog', { name: en.reviewTitle })).toBeTruthy()
    resolveInstall({ ok: false, error: new RemoteError('gateway/cancelled', 'Skill installation cancelled.', {}) })
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: en.reviewTitle })).toBeNull() })
    expect(screen.getByText('SKILL.md')).toBeTruthy()
  })

  it('aborts an active archive installation when the panel unmounts', async () => {
    let resolveInstall: (result: FailedInstall) => void = () => undefined
    const install = vi.fn((_slug: string, _version: string, _confirmed: boolean, _signal: AbortSignal) => (
      new Promise<FailedInstall>((resolve) => { resolveInstall = resolve })
    ))
    const props = {
      api: {
        catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
        detail: vi.fn().mockResolvedValue({ ok: true, value: detail }),
        installSkill: install,
      },
      useStore: <S,>(selector: (state: { open: boolean }) => S): S => selector({ open: true }),
      actions: { open: vi.fn(), close: vi.fn() },
      t: translate,
    }
    const view = render(<SkillCatalogPanel {...globalProps} {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Example Skill' }))
    await screen.findByText('SKILL.md')
    fireEvent.click(screen.getByRole('button', { name: en.install }))
    fireEvent.click(screen.getByRole('button', { name: en.confirmInstall }))
    await waitFor(() => { expect(install).toHaveBeenCalledOnce() })
    const signal = install.mock.calls[0]?.[3]
    view.unmount()
    expect(signal?.aborted).toBe(true)
    resolveInstall({ ok: false, error: new RemoteError('gateway/cancelled', 'Skill installation cancelled.', {}) })
  })

  it('keeps duplicate slugs distinct and requests detail by each publisher identity', async () => {
    const first = { ...page.items[0]!, canonicalName: '@first/dev-expert', slug: 'dev-expert', name: 'First expert' }
    const second = { ...page.items[0]!, canonicalName: '@second/dev-expert', slug: 'dev-expert', name: 'Second expert' }
    const detailFor = (skill: typeof first): SkillHubDetail => ({ ...detail, skill, owner: skill.canonicalName })
    const detailRequest = vi.fn(async (identity: string) => ({
      ok: true as const, value: detailFor(identity === first.canonicalName ? first : second),
    }))
    const props = {
      api: {
        catalog: vi.fn().mockResolvedValue({ ok: true, value: { items: [first, second], total: 2 } }),
        detail: detailRequest,
        installSkill: vi.fn(),
      },
      useStore: <S,>(selector: (state: { open: boolean }) => S): S => selector({ open: true }),
      actions: { open: vi.fn(), close: vi.fn() },
      t: translate,
    }
    render(<SkillCatalogPanel {...globalProps} {...props} />)
    await screen.findByRole('button', { name: 'First expert' })
    const secondButton = screen.getByRole('button', { name: 'Second expert' })
    expect(document.querySelectorAll('article')).toHaveLength(2)
    fireEvent.click(secondButton)
    await screen.findByText('SKILL.md')
    expect(detailRequest).toHaveBeenCalledWith('@second/dev-expert', expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: en.back }))
    fireEvent.click(screen.getByRole('button', { name: 'First expert' }))
    await screen.findByText('SKILL.md')
    expect(detailRequest).toHaveBeenLastCalledWith('@first/dev-expert', expect.any(AbortSignal))
  })

  it.each([
    { code: 'skillhub/identity-ambiguous' as const, locale: en, t: translate },
    { code: 'skillhub/identity-changed' as const, locale: zh, t: translateZh },
  ])('localizes $code and ends the detail loading state', async ({ code, locale, t }) => {
    const detailRequest = vi.fn().mockResolvedValue({
      ok: false,
      error: new RemoteError(code, 'Raw English Host diagnostic that must not be shown.', {}),
    })
    const props = {
      api: {
        catalog: vi.fn().mockResolvedValue({ ok: true, value: page }),
        detail: detailRequest,
        installSkill: vi.fn(),
      },
      useStore: <S,>(selector: (state: { open: boolean }) => S): S => selector({ open: true }),
      actions: { open: vi.fn(), close: vi.fn() },
      t,
    }
    render(<SkillCatalogPanel {...globalProps} {...props} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Example Skill' }))
    expect((await screen.findByRole('alert')).textContent).toContain(locale[code === 'skillhub/identity-ambiguous' ? 'identityAmbiguous' : 'identityChanged'])
    expect(screen.queryByText(locale.loading)).toBeNull()
    expect(screen.queryByText('Raw English Host diagnostic that must not be shown.')).toBeNull()
    expect(screen.getByRole('button', { name: locale.retry })).toBeTruthy()
  })
})
