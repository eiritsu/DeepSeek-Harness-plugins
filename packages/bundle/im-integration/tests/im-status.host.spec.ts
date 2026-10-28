import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImStatusService } from '../src/status.ts'
import { handleWeixinQrCode, handleWeixinQrStatus } from '../src/weixin-proxy.ts'
import type { ImConnectionStatus } from '../src/types.ts'

describe('ImStatusService', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('publishes and streams connection status across platforms', async () => {
    const ctx = new Context()
    const service = new ImStatusService(ctx)

    service.publish({ platform: 'lark', state: 'connected' })
    service.publish({ platform: 'dingtalk', state: 'connecting' })

    const controller = new AbortController()
    const received: ImConnectionStatus[] = []

    const stream = service.watch(controller.signal)
    const readPromise = (async () => {
      for await (const item of stream) {
        received.push(item)
        if (received.length >= 3) {
          controller.abort()
          break
        }
      }
    })()

    service.publish({ platform: 'wecom', state: 'connected' })

    await readPromise
    expect(received).toHaveLength(3)
    expect(received[0]).toEqual({ platform: 'lark', state: 'connected' })
    expect(received[1]).toEqual({ platform: 'dingtalk', state: 'connecting' })
    expect(received[2]).toEqual({ platform: 'wecom', state: 'connected' })
  })

  it('handles WeChat ClawBot QR code generation and status via proxy', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/get_bot_qrcode')) {
        return new Response(JSON.stringify({
          ret: 0,
          qrcode: 'test_ticket_123',
          qrcode_img_content: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=test_ticket_123&bot_type=3',
        }))
      }
      if (url.includes('/get_qrcode_status')) {
        return new Response(JSON.stringify({
          ret: 0,
          status: 'need_verifycode',
        }))
      }
      return new Response('Not found', { status: 404 })
    })

    const qrRes = await handleWeixinQrCode(new Request('http://localhost/api/im.weixin.qrcode', { method: 'POST' }))
    expect(qrRes.status).toBe(200)
    const qrData = (await qrRes.json()) as { ok: boolean; qrcode: string; qrcodeUrl: string }
    expect(qrData.ok).toBe(true)
    expect(qrData.qrcode).toBe('test_ticket_123')
    expect(qrData.qrcodeUrl).toContain('test_ticket_123')

    const missingRes = await handleWeixinQrStatus(new Request('http://localhost/api/im.weixin.status'))
    expect(missingRes.status).toBe(400)

    const statusRes = await handleWeixinQrStatus(new Request('http://localhost/api/im.weixin.status?qrcode=test_ticket_123'))
    expect(statusRes.status).toBe(200)
    const statusData = (await statusRes.json()) as { ok: boolean; status: string }
    expect(statusData.ok).toBe(true)
    expect(statusData.status).toBe('need_verifycode')
  })
})
