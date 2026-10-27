// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { GlobalStandardProps, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { generateQrPath } from '../src/client/QrCodeCard.tsx'
import { ImSettingsPage } from '../src/client/ImSettingsPage.tsx'
import { zh, type ImLocaleKey } from '../src/client/locales.ts'

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
  it('generates authentic SVG path data for QR code', () => {
    const path1 = generateQrPath('https://weixin.qq.com/dsh/test1')
    const path2 = generateQrPath('https://wa.me/dsh/test2')

    expect(path1).toContain('M')
    expect(path1).toContain('h1v1h-1z')
    expect(path2).toContain('M')
    expect(path1).not.toBe(path2)
  })

  it('handles long input strings without throwing', () => {
    const longString = 'https://example.com/very/long/path/that/exceeds/the/fifty/three/bytes/capacity/limit/in/version/3'
    const path = generateQrPath(longString)
    expect(path).toContain('M')
  })

  it('opens and closes WeChat QR code modal when clicking scan button', () => {
    render(<ImSettingsPage t={t} view="page" {...standard} />)

    // Switch to WeChat tab
    const weixinTab = screen.getByRole('button', { name: zh.tabWeixin })
    fireEvent.click(weixinTab)

    // Button to open QR code
    const scanBtn = screen.getByRole('button', { name: zh.weixinScanButton })
    fireEvent.click(scanBtn)

    // Modal should now be visible
    expect(screen.getByRole('dialog', { name: zh.qrModalTitleWeixin })).toBeTruthy()
    expect(screen.getByText(zh.qrModalStatusWaiting)).toBeTruthy()
    expect(screen.getByText(zh.qrModalHintWeixin)).toBeTruthy()

    // Refresh button should work
    const refreshBtn = screen.getByRole('button', { name: zh.qrModalRefresh })
    fireEvent.click(refreshBtn)
    expect(screen.getByRole('dialog', { name: zh.qrModalTitleWeixin })).toBeTruthy()

    // Close button should close modal
    const closeBtns = screen.getAllByRole('button', { name: zh.qrModalClose })
    fireEvent.click(closeBtns[0]!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens WhatsApp QR code modal when clicking WhatsApp scan button', () => {
    render(<ImSettingsPage t={t} view="page" {...standard} />)

    // Switch to WhatsApp tab
    const whatsappTab = screen.getByRole('button', { name: zh.tabWhatsapp })
    fireEvent.click(whatsappTab)

    // Button to open QR pairing
    const pairBtn = screen.getByRole('button', { name: zh.whatsappScanButton })
    fireEvent.click(pairBtn)

    // Modal should now be visible
    expect(screen.getByRole('dialog', { name: zh.qrModalTitleWhatsapp })).toBeTruthy()
    expect(screen.getByText(zh.qrModalStatusWaiting)).toBeTruthy()
    expect(screen.getByText(zh.qrModalHintWhatsapp)).toBeTruthy()
  })
})
