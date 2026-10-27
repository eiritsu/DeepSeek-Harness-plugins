// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { GlobalStandardProps, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { generateQrPath } from '../src/client/QrCodeCard.tsx'
import { ImSettingsPage } from '../src/client/ImSettingsPage.tsx'
import { zh, type ImLocaleKey } from '../src/client/locales.ts'
import { generateWhatsappPairingPayload } from '../src/client/whatsapp-baileys.ts'

afterEach(cleanup)

const t: TranslateNS<'settings.im'> = key => zh[key as ImLocaleKey] ?? key

const unusedHook = (): never => { throw new Error('IM configuration fixture does not provide global state') }
const standard: Pick<GlobalStandardProps, 'usePanelInfo' | 'useSessions' | 'useSessionStatus' | 'useSessionRetainInfo' | 'useResource' | 'useWorkspaces'> = {
  usePanelInfo: unusedHook,
  useSessions: unusedHook,
  useSessionStatus: unusedHook,
  useSessionRetainInfo: unusedHook,
  useResource: unusedHook,
  useWorkspaces: unusedHook,
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
    render(<ImSettingsPage t={t} view="page" {...standard} />)

    // Switch to WeChat tab
    const weixinTab = screen.getByRole('button', { name: zh.tabWeixin })
    fireEvent.click(weixinTab)

    // Button to open QR code
    const scanBtn = screen.getByRole('button', { name: zh.weixinScanButton })
    fireEvent.click(scanBtn)

    // Modal should now be visible
    expect(screen.getByRole('dialog', { name: zh.qrModalTitleWeixin })).toBeTruthy()
    expect(screen.getByText(zh.qrModalHintWeixin)).toBeTruthy()

    // Close button should close modal
    const closeBtns = screen.getAllByRole('button', { name: zh.qrModalClose })
    fireEvent.click(closeBtns[0]!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens WhatsApp QR code modal and allows switching between Web and Cloud API modes', () => {
    render(<ImSettingsPage t={t} view="page" {...standard} />)

    // Switch to WhatsApp tab
    const whatsappTab = screen.getByRole('button', { name: zh.tabWhatsapp })
    fireEvent.click(whatsappTab)

    // Initially in Web pairing mode
    const pairBtn = screen.getByRole('button', { name: zh.whatsappScanButton })
    fireEvent.click(pairBtn)

    // Modal should now be visible with Noise pairing payload
    expect(screen.getByRole('dialog', { name: zh.qrModalTitleWhatsapp })).toBeTruthy()
    expect(screen.getByText(zh.qrModalStatusWaiting)).toBeTruthy()
    expect(screen.getByText(zh.qrModalHintWhatsapp)).toBeTruthy()

    // Close modal
    const closeBtns = screen.getAllByRole('button', { name: zh.qrModalClose })
    fireEvent.click(closeBtns[0]!)

    // Switch to Cloud API mode
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'cloud' } })
    expect(screen.getByText(zh.whatsappPhoneNumberId)).toBeTruthy()
    expect(screen.getByText(zh.whatsappAccessToken)).toBeTruthy()
    expect(screen.getByText(zh.whatsappWabaId)).toBeTruthy()
  })
})
