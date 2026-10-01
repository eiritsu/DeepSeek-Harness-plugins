// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { LarkSettingsPage, type LarkSettingsPageProps } from '../src/client/LarkSettingsPage.tsx'
import type { LarkSettingsState } from '../src/client/controller.ts'
import { en } from '../src/client/locales.ts'
import css from '../src/client/LarkSettingsPage.module.css'

afterEach(cleanup)

const shell: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}
const field = (text = ''): SettingsFieldState => ({ text, overridden: false, invalid: false })

function buildState(overrides: Partial<LarkSettingsState> = {}): LarkSettingsState {
  return {
    ...shell,
    appId: field('cli_mock'), appSecretEnv: field('LARK_APP_SECRET'), brand: field('feishu'),
    authorizedUserOpenId: field(''), enabled: field('false'),
    registrationTimeoutMs: field('600000'), cliEnabled: field('false'),
    cliTimeoutMs: field('30000'), cliMaxOutputBytes: field('262144'), cliGraceMs: field('2000'),
    conversationCwd: field(''),
    connectionStatus: { state: 'disabled' },
    appSecret: field(''), appSecretConfigured: true, appSecretWritable: true,
    connectionPath: 'existing', setupBusy: false,
    ...overrides,
  }
}

function renderPage(state: LarkSettingsState, extra: Partial<LarkSettingsPageProps> = {}) {
  const store = createSnapshotStore(state)
  const baseProps = {
    t: (key: keyof typeof en) => en[key],
    useLarkSettings: bindSnapshotSelector(store),
    edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn(),
    chooseConnectionPath: vi.fn(),
    beginQuickConnect: vi.fn(), completeQuickConnect: vi.fn(),
    beginUserAuthorization: vi.fn(), completeUserAuthorization: vi.fn(), cancelSetupFlow: vi.fn(),
  } as unknown as LarkSettingsPageProps
  return render(<LarkSettingsPage {...baseProps} {...extra} />)
}

describe('Lark bundle detail page status banner accuracy', () => {
  it('renders the plain "disabled" label and no reason when the plugin is off', () => {
    renderPage(buildState({ connectionStatus: { state: 'disabled' } }))
    const banner = screen.getByRole('status')
    expect(banner.dataset.state).toBe('disabled')
    expect(banner.textContent).toContain(en.statusDisabled)
    expect(banner.textContent).not.toContain(en.statusError)
  })

  it('renders "connecting" without treating it as an error', () => {
    renderPage(buildState({ connectionStatus: { state: 'connecting' } }))
    const banner = screen.getByRole('status')
    expect(banner.dataset.state).toBe('connecting')
    expect(banner.textContent).toContain(en.statusConnecting)
    expect(banner.textContent).not.toContain(en.statusError)
  })

  it('renders "connected" without any error tone or hint', () => {
    renderPage(buildState({ connectionStatus: { state: 'connected' } }))
    const banner = screen.getByRole('status')
    expect(banner.dataset.state).toBe('connected')
    expect(banner.textContent).toContain(en.statusConnected)
  })

  it('renders "unavailable" with the dedicated label rather than connection-failed', () => {
    renderPage(buildState({ connectionStatus: { state: 'unavailable' } }))
    const banner = screen.getByRole('status')
    expect(banner.dataset.state).toBe('unavailable')
    expect(banner.textContent).toContain(en.statusUnavailable)
    expect(banner.textContent).not.toContain(en.statusConnectionFailed)
  })

  it('marks an OAuth-not-finished error with the pending tone, the "Waiting for user authorization" heading, and never renders the "Connection error" label', () => {
    renderPage(buildState({
      connectionStatus: { state: 'error', reason: 'missing-identity' },
      authorizedUserOpenId: field(''),
    }))
    const banner = screen.getByRole('status')
    expect(banner.dataset.state).toBe('error')
    expect(banner.dataset.tone).toBe('pending')
    expect(banner.textContent).toContain(en.statusPendingAuthorization)
    expect(banner.textContent).toContain(en.statusMissingIdentityHint)
    expect(banner.textContent).not.toContain(en.statusError)
    expect(banner.textContent).not.toContain(en.statusConnectionFailed)
  })

  it('keeps the error tone and reason for a true connection failure', () => {
    renderPage(buildState({
      connectionStatus: { state: 'error', reason: 'connection-failed' },
      authorizedUserOpenId: field('ou_verified'),
    }))
    const banner = screen.getByRole('status')
    expect(banner.dataset.tone).toBe('error')
    expect(banner.textContent).toContain(en.statusConnectionFailed)
    expect(banner.textContent).not.toContain(en.statusMissingIdentityHint)
  })

  it('reports a missing application credential with the dedicated reason', () => {
    renderPage(buildState({
      connectionStatus: { state: 'error', reason: 'missing-credential' },
      authorizedUserOpenId: field('ou_verified'),
    }))
    const banner = screen.getByRole('status')
    expect(banner.dataset.tone).toBe('error')
    expect(banner.textContent).toContain(en.statusMissingCredential)
  })
})

describe('Lark bundle detail page connection-path branches', () => {
  it('quick path exposes only the "Create app and authorize" trigger', () => {
    const beginQuickConnect = vi.fn()
    renderPage(buildState({ connectionPath: 'quick' }), { beginQuickConnect } as Partial<LarkSettingsPageProps>)
    expect(screen.getByRole('button', { name: en.startQuickConnect })).toBeDefined()
    expect(screen.queryByRole('button', { name: en.saveAndAuthorize })).toBeNull()
    expect(screen.queryByLabelText(en.appId)).toBeNull()
  })

  it('existing path exposes appId/appSecret and the "Save and authorize" trigger inside a vertical field group', () => {
    const beginUserAuthorization = vi.fn()
    const { container } = renderPage(buildState({ connectionPath: 'existing' }),
      { beginUserAuthorization } as Partial<LarkSettingsPageProps>)
    expect(screen.getByRole('button', { name: en.saveAndAuthorize })).toBeDefined()
    expect(screen.queryByRole('button', { name: en.startQuickConnect })).toBeNull()
    const appIdInput = screen.getByLabelText(en.appId)
    const appSecretInput = screen.getByLabelText(en.appSecret)
    expect(appIdInput).toBeDefined()
    expect(appSecretInput).toBeDefined()
    // The two inputs must live inside a fieldGroup rather than being siblings
    // of the action button in a single flex row.
    const commonAncestor = appIdInput.closest(`.${css.fieldGroup}`)
    expect(commonAncestor).not.toBeNull()
    expect(commonAncestor?.contains(appSecretInput)).toBe(true)
    expect(commonAncestor?.contains(screen.getByRole('button', { name: en.saveAndAuthorize }))).toBe(true)
    // Belt-and-suspenders: nothing in the existing branch should also live
    // directly inside a .flow row alongside the button.
    const flowParents = container.querySelectorAll(`.${css.flow}`)
    for (const flow of flowParents) {
      const button = flow.querySelector('button')
      if (button?.textContent?.includes(en.saveAndAuthorize)) {
        expect(flow.querySelectorAll('input,textarea').length).toBe(0)
      }
    }
  })

  it('the registration callout routes the complete button to completeQuickConnect', () => {
    const completeQuickConnect = vi.fn()
    renderPage(buildState({
      connectionPath: 'quick',
      verificationUrl: 'https://accounts.feishu.cn/oauth/v1/app/registration',
      pendingFlow: 'registration',
    }), { completeQuickConnect } as Partial<LarkSettingsPageProps>)
    const callout = screen.getByRole('region', { name: en.quickPath })
    const link = screen.getByRole('link', { name: en.openVerificationPage })
    expect(link.getAttribute('href')).toBe('https://accounts.feishu.cn/oauth/v1/app/registration')
    expect(callout.contains(link)).toBe(true)
    const complete = screen.getByRole('button', { name: en.completeQuickConnect })
    complete.click()
    expect(completeQuickConnect).toHaveBeenCalledOnce()
  })

  it('the user-authorization callout routes the complete button to completeUserAuthorization', () => {
    const completeUserAuthorization = vi.fn()
    const completeQuickConnect = vi.fn()
    renderPage(buildState({
      verificationUrl: 'https://accounts.feishu.cn/oauth/device?code=public',
      pendingFlow: 'user-authorization',
    }), { completeQuickConnect, completeUserAuthorization } as Partial<LarkSettingsPageProps>)
    const complete = screen.getByRole('button', { name: en.completeUserAuthorization })
    expect(complete).toBeDefined()
    complete.click()
    expect(completeUserAuthorization).toHaveBeenCalledOnce()
    expect(completeQuickConnect).not.toHaveBeenCalled()
  })

  it('keeps the resume-after-refresh complete button distinct from the registration path', () => {
    const completeUserAuthorization = vi.fn()
    const completeQuickConnect = vi.fn()
    renderPage(buildState({
      pendingAuthorization: {
        appId: 'cli_mock', brand: 'feishu', appSecretEnv: 'LARK_APP_SECRET',
        createdAt: Date.now(), matchesIdentity: true, expired: false,
      },
    }), { completeQuickConnect, completeUserAuthorization } as Partial<LarkSettingsPageProps>)
    expect(screen.queryByRole('link', { name: en.openVerificationPage })).toBeNull()
    const complete = screen.getByRole('button', { name: en.completeUserAuthorization })
    complete.click()
    expect(completeUserAuthorization).toHaveBeenCalledOnce()
    expect(completeQuickConnect).not.toHaveBeenCalled()
  })

  it('hides the resume callout when the verificationUrl is still live so the official auth card is not duplicated', () => {
    renderPage(buildState({
      verificationUrl: 'https://accounts.feishu.cn/oauth/device?code=public',
      pendingFlow: 'user-authorization',
      pendingAuthorization: {
        appId: 'cli_mock', brand: 'feishu', appSecretEnv: 'LARK_APP_SECRET',
        createdAt: Date.now(), matchesIdentity: true, expired: false,
      },
    }))
    expect(screen.queryByText(en.authorizationResumable)).toBeNull()
    expect(screen.getByRole('region', { name: en.authorizationCallout })).toBeDefined()
    expect(screen.getByRole('link', { name: en.openVerificationPage })).toBeDefined()
  })

  it('exposes a "Restart authorization" path inside the resume callout for users who never finished the OAuth', () => {
    const beginUserAuthorization = vi.fn()
    renderPage(buildState({
      pendingAuthorization: {
        appId: 'cli_mock', brand: 'feishu', appSecretEnv: 'LARK_APP_SECRET',
        createdAt: Date.now(), matchesIdentity: true, expired: false,
      },
    }), { beginUserAuthorization } as Partial<LarkSettingsPageProps>)
    const restart = screen.getByRole('button', { name: en.authorizationRestart })
    restart.click()
    expect(beginUserAuthorization).toHaveBeenCalledOnce()
  })
})

/**
 * The official-authorization link once rendered as plain text because its
 * stylesheet named variables the theme never defines (`--text-link`,
 * `--surface-primary`, …), so every colour, border, and fill rule silently
 * dropped and the anchor inherited body text. These assertions read the real
 * stylesheet and the real design platform so that class of failure cannot come
 * back unnoticed.
 */
describe('Lark bundle detail page styling', () => {
  const repositoryFile = (...segments: readonly string[]): string =>
    readFileSync(resolve(import.meta.dirname, ...segments), 'utf8')
  const stylesheet = repositoryFile('..', 'src', 'client', 'LarkSettingsPage.module.css')
  const definedTokens = new Set(
    ['design-platform.css', 'base.css', 'focus.css']
      .flatMap(file => [
        ...repositoryFile('..', '..', '..', 'client', 'ui-theme', 'src', 'styles', file).matchAll(/(--[a-z0-9-]+)\s*:/g),
      ].map(match => match[1])),
  )
  const usedTokens = [...stylesheet.matchAll(/var\((--[a-z0-9-]+)/g)].map(match => match[1])

  it('references only design tokens the theme actually defines', () => {
    expect(usedTokens.length).toBeGreaterThan(0)
    const undefinedTokens = [...new Set(usedTokens)].filter(token => !definedTokens.has(token))
    expect(undefinedTokens).toEqual([])
  })

  it('renders the official link ahead of the confirm button so the required step reads first', () => {
    const { container } = renderPage(buildState({
      verificationUrl: 'https://accounts.feishu.cn/oauth/device?code=public',
      pendingFlow: 'user-authorization',
    }))
    const callout = screen.getByRole('region', { name: en.authorizationCallout })
    const link = callout.querySelector(`.${css.authorizeLink}`)
    expect(link).not.toBeNull()
    if (link === null) throw new Error('authorization link is missing')
    expect(link?.tagName).toBe('A')
    const confirm = screen.getByRole('button', { name: en.completeUserAuthorization })
    // Document order carries the sequence: go to the page, then confirm.
    expect(link.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The confirm step is a real button, so it never inherits the link's classes.
    const authorizeLinkClass = css.authorizeLink
    if (authorizeLinkClass === undefined) throw new Error('authorization link class is missing')
    expect(confirm.classList.contains(authorizeLinkClass)).toBe(false)
    expect(container.querySelectorAll(`.${css.authorizeLink}`)).toHaveLength(1)
  })
})

describe('Lark bundle detail page cancel affordance', () => {
  const cancelIsDanger = (): void => {
    const cancel = screen.getByRole('button', { name: en.cancelAuthorization })
    const dangerCancelClass = css.dangerCancel
    if (dangerCancelClass === undefined) throw new Error('danger cancel class is missing')
    expect(cancel.classList.contains(dangerCancelClass)).toBe(true)
  }

  it('marks cancel as destructive on the registration card', () => {
    renderPage(buildState({
      connectionPath: 'quick',
      verificationUrl: 'https://accounts.feishu.cn/oauth/v1/app/registration',
      pendingFlow: 'registration',
    }))
    cancelIsDanger()
  })

  it('marks cancel as destructive on the user-authorization card', () => {
    renderPage(buildState({
      verificationUrl: 'https://accounts.feishu.cn/oauth/device?code=public',
      pendingFlow: 'user-authorization',
    }))
    cancelIsDanger()
  })

  it('marks cancel as destructive on the resume card', () => {
    renderPage(buildState({
      pendingAuthorization: {
        appId: 'cli_mock', brand: 'feishu', appSecretEnv: 'LARK_APP_SECRET',
        createdAt: Date.now(), matchesIdentity: true, expired: false,
      },
    }))
    cancelIsDanger()
  })

  it('keeps cancel wired to the same handler in every branch', () => {
    const cancelSetupFlow = vi.fn()
    renderPage(buildState({
      verificationUrl: 'https://accounts.feishu.cn/oauth/device?code=public',
      pendingFlow: 'user-authorization',
    }), { cancelSetupFlow } as Partial<LarkSettingsPageProps>)
    screen.getByRole('button', { name: en.cancelAuthorization }).click()
    expect(cancelSetupFlow).toHaveBeenCalledOnce()
  })
})
