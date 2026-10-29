// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { generateQrPath } from '../src/client/QrCodeCard.tsx'
import { ImSettingsPage, type ImSettingsPageProps } from '../src/client/ImSettingsPage.tsx'
import type { ImSettingsState } from '../src/client/controller.ts'
import { zh, type ImLocaleKey } from '../src/client/locales.ts'
import { generateWhatsappPairingPayload } from '../src/client/whatsapp-baileys.ts'
// Keep Baileys payload unit coverage even though Settings no longer offers a live Web QR.

afterEach(cleanup)

const shell: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}
const field = (text = ''): SettingsFieldState => ({ text, overridden: false, invalid: false })

function buildState(overrides: Partial<ImSettingsState> = {}): ImSettingsState {
  return {
    ...shell,
    activePlatform: field('lark'),
    enabled: field('false'),
    whitelistEnabled: field('false'),
    authorizedUsers: field(''),
    moderationEnabled: field('false'),
    approvalPolicy: field('high_risk'),
    sensitiveKeywords: field(''),
    cliEnabled: field('false'),
    larkCliEnabled: field('true'),
    wecomCliEnabled: field('false'),
    dingtalkCliEnabled: field('false'),
    cliTimeoutMs: field('30000'),
    cliMaxOutputBytes: field('262144'),
    cliGraceMs: field('2000'),
    larkAppId: field(''),
    larkAppSecretEnv: field('LARK_APP_SECRET'),
    larkBrand: field('feishu'),
    dingtalkClientId: field(''),
    dingtalkClientSecretEnv: field('DINGTALK_CLIENT_SECRET'),
    wecomBotId: field(''),
    wecomBotSecretEnv: field('WECOM_BOT_SECRET'),
    weixinEnabled: field('false'),
    weixinBotTokenEnv: field('WEIXIN_BOT_TOKEN'),
    qqAppId: field(''),
    qqAppSecretEnv: field('QQ_BOT_SECRET'),
    qqSandbox: field('false'),
    telegramBotTokenEnv: field('TELEGRAM_BOT_TOKEN'),
    discordBotTokenEnv: field('DISCORD_BOT_TOKEN'),
    whatsappEnabled: field('false'),
    whatsappPhoneNumberId: field(''),
    whatsappWabaId: field(''),
    whatsappAccessTokenEnv: field('WHATSAPP_ACCESS_TOKEN'),
    connectionStatus: { platform: 'lark', state: 'disabled' },
    larkAppSecret: field(''),
    dingtalkClientSecret: field(''),
    wecomBotSecret: field(''),
    qqAppSecret: field(''),
    telegramBotToken: field(''),
    discordBotToken: field(''),
    whatsappAccessToken: field(''),
    secretsConfigured: {
      larkAppSecret: false,
      dingtalkClientSecret: false,
      wecomBotSecret: false,
      qqAppSecret: false,
      telegramBotToken: false,
      discordBotToken: false,
      whatsappAccessToken: false,
    },
    setupBusy: false,
    ...overrides,
  }
}

function renderPage(state: ImSettingsState = buildState()) {
  const store = createSnapshotStore(state)
  const edit = vi.fn((fieldName: string, text: string) => {
    const current = store.getSnapshot()
    if (fieldName === 'activePlatform') {
      store.set({
        ...current,
        activePlatform: field(text),
        connectionStatus: {
          platform: text as ImSettingsState['connectionStatus']['platform'],
          state: 'disabled',
        },
      })
      return
    }
    if (fieldName in current) {
      store.set({ ...current, [fieldName]: field(text) })
    }
  })
  const props = {
    t: (key: ImLocaleKey) => zh[key],
    view: 'page' as const,
    useImSettings: bindSnapshotSelector(store),
    edit,
    resetField: vi.fn(),
    save: vi.fn(),
    discard: vi.fn(),
    selectPlatform: vi.fn((platform: ImSettingsState['connectionStatus']['platform']) => {
      const current = store.getSnapshot()
      store.set({
        ...current,
        activePlatform: field(platform),
        connectionStatus: { platform, state: current.connectionStatus.state },
      })
    }),
    commitWeixinAuthorization: vi.fn(async () => true),
    clearWeixinAuthorization: vi.fn(async () => {}),
  } as unknown as ImSettingsPageProps
  return { ...render(<ImSettingsPage {...props} />), edit }
}

describe('IM QR Code Generation & Modal', () => {
  it('generates authentic SVG path data for QR code using uqr', () => {
    const path1 = generateQrPath('https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=test1&bot_type=3')
    const path2 = generateQrPath('2@ref,noise,identity,secret')

    expect(path1).toContain('M')
    expect(path1).toContain('h1v1h-1z')
    expect(path2).toContain('M')
    expect(path1).not.toBe(path2)
  })

  it('generates valid WhatsApp Noise Multi-Device pairing payload', () => {
    const payload = generateWhatsappPairingPayload()
    const pattern = /^2@([A-Za-z0-9+/=]+),([A-Za-z0-9+/=]+),([A-Za-z0-9+/=]+),([A-Za-z0-9+/=]+)$/
    expect(pattern.test(payload)).toBe(true)
  })

  it('handles long input strings without throwing', () => {
    const longString = 'https://example.com/very/long/path/that/exceeds/the/fifty/three/bytes/capacity/limit/in/version/3/and/automatically/scales/with/uqr'
    const path = generateQrPath(longString)
    expect(path).toContain('M')
  })

  it('opens and closes WeChat QR code modal when clicking scan button', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: zh.tabWeixin }))
    fireEvent.click(screen.getByRole('button', { name: zh.weixinScanButton }))

    expect(screen.getByRole('dialog', { name: zh.qrModalTitleWeixin })).toBeTruthy()
    expect(screen.getByText(zh.qrModalHintWeixin)).toBeTruthy()

    const closeBtns = screen.getAllByRole('button', { name: zh.qrModalClose })
    fireEvent.click(closeBtns[0]!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('defaults WhatsApp to Cloud API fields and marks Web pairing unavailable', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: zh.tabWhatsapp }))
    expect(screen.getByText(zh.whatsappCloudHint)).toBeTruthy()
    expect(screen.getByText(zh.whatsappPhoneNumberId)).toBeTruthy()
    expect(screen.getByText(zh.whatsappWabaId)).toBeTruthy()
    expect(screen.getByText(zh.whatsappAccessToken)).toBeTruthy()

    const select = screen.getByDisplayValue(zh.whatsappModeCloud)
    fireEvent.change(select, { target: { value: 'web' } })
    expect(screen.getByText(zh.whatsappWebUnavailable)).toBeTruthy()
    expect(screen.queryByRole('button', { name: zh.whatsappScanButton })).toBeNull()
  })

  it('edits CLI channel switches and shared limits', () => {
    const page = renderPage(buildState({ cliEnabled: field('true'), larkCliEnabled: field('true') }))
    fireEvent.click(screen.getByRole('checkbox', { name: zh.larkCliEnabled }))
    fireEvent.change(screen.getByLabelText(zh.cliTimeoutMs), { target: { value: '45000' } })
    fireEvent.change(screen.getByLabelText(zh.cliMaxOutputBytes), { target: { value: '8192' } })
    fireEvent.change(screen.getByLabelText(zh.cliGraceMs), { target: { value: '1500' } })
    expect(page.edit).toHaveBeenCalledWith('larkCliEnabled', 'false')
    expect(page.edit).toHaveBeenCalledWith('cliTimeoutMs', '45000')
    expect(page.edit).toHaveBeenCalledWith('cliMaxOutputBytes', '8192')
    expect(page.edit).toHaveBeenCalledWith('cliGraceMs', '1500')

    cleanup()
    renderPage(buildState({ activePlatform: field('dingtalk'), dingtalkCliEnabled: field('false') }))
    fireEvent.click(screen.getByRole('checkbox', { name: zh.dingtalkCliEnabled }))

    cleanup()
    renderPage(buildState({ activePlatform: field('wecom'), wecomCliEnabled: field('false') }))
    fireEvent.click(screen.getByRole('checkbox', { name: zh.wecomCliEnabled }))
  })

  it('renders expired overlay when QR status transitions to expired', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: zh.tabWeixin }))
    fireEvent.click(screen.getByRole('button', { name: zh.weixinScanButton }))

    expect(screen.getByRole('dialog', { name: zh.qrModalTitleWeixin })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh.qrModalRefresh }))
    expect(screen.getByRole('dialog', { name: zh.qrModalTitleWeixin })).toBeTruthy()
  })
})
