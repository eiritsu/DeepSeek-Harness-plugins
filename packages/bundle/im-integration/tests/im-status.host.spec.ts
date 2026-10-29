import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { ImStatusService } from '../src/status.ts'
import { encodeIlinkClientVersion, ILINK_CLIENT_VERSION } from '../src/weixin-ilink-protocol.ts'
import { handleWeixinQrCode, handleWeixinQrStatus } from '../src/weixin-proxy.ts'
import type { ImConnectionStatus } from '../src/types.ts'

function testConfig(): Config {
  return {
    weixinBotTokenEnv: { get: () => 'WEIXIN_BOT_TOKEN' },
  } as unknown as Config
}

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

  it('encodes the official openclaw-weixin 2.4.10 client version as 132106', () => {
    expect(encodeIlinkClientVersion('2.4.10')).toBe('132106')
    expect(ILINK_CLIENT_VERSION).toBe('132106')
    expect(encodeIlinkClientVersion('1.0.10')).toBe('65546')
  })

  it('handles WeChat ClawBot QR code generation and status via proxy', async () => {
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: async () => undefined,
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const headers = new Headers(init?.headers)
      if (url.includes('/get_bot_qrcode')) {
        expect(headers.get('iLink-App-ClientVersion')).toBe('132106')
        expect(headers.get('AuthorizationType')).toBe('ilink_bot_token')
        const body = JSON.parse(String(init?.body ?? '{}')) as { local_token_list?: unknown }
        expect(body.local_token_list).toEqual([])
        return new Response(JSON.stringify({
          ret: 0,
          qrcode: 'test_ticket_123',
          qrcode_img_content: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=test_ticket_123&bot_type=3',
        }))
      }
      if (url.includes('/get_qrcode_status')) {
        // Official status poll omits AuthorizationType / X-WECHAT-UIN.
        expect(headers.get('AuthorizationType')).toBeNull()
        expect(headers.get('X-WECHAT-UIN')).toBeNull()
        expect(headers.get('iLink-App-ClientVersion')).toBe('132106')
        return new Response(JSON.stringify({
          ret: 0,
          status: 'need_verifycode',
        }))
      }
      return new Response('Not found', { status: 404 })
    })

    const qrRes = await handleWeixinQrCode(ctx, testConfig())
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

  it('includes stored WeChat bot tokens in local_token_list when issuing a QR code', async () => {
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: async () => ({ value: JSON.stringify({ token: 'stored-bot-token', botId: 'bot_1' }), source: 'test' }),
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { local_token_list?: string[] }
      expect(body.local_token_list).toEqual(['stored-bot-token'])
      return new Response(JSON.stringify({
        ret: 0,
        qrcode: 'ticket',
        qrcode_img_content: 'https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=ticket&bot_type=3',
      }))
    })

    const res = await handleWeixinQrCode(ctx, testConfig())
    expect(res.status).toBe(200)
  })

  it('reconciles platform status to connected when WeChat credentials exist', async () => {
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: async (ref: { toString(): string }) =>
        String(ref) === 'WEIXIN_BOT_TOKEN'
          ? { value: JSON.stringify({ token: 'tok_active' }), source: 'test' }
          : undefined,
    })
    const { applyImRuntime } = await import('../src/runtime.ts')
    const service = new ImStatusService(ctx)
    const published: ImConnectionStatus[] = []
    service.publish = (item) => { published.push(item) }

    const config = {
      enabled: { get: () => true },
      weixinEnabled: { get: () => true },
      weixinBotTokenEnv: { get: () => 'WEIXIN_BOT_TOKEN' },
      larkAppId: { get: () => '' },
      larkAppSecretEnv: { get: () => '' },
      dingtalkClientId: { get: () => '' },
      dingtalkClientSecretEnv: { get: () => '' },
      wecomBotId: { get: () => '' },
      wecomBotSecretEnv: { get: () => '' },
      qqAppId: { get: () => '' },
      qqAppSecretEnv: { get: () => '' },
      telegramBotTokenEnv: { get: () => '' },
      discordBotTokenEnv: { get: () => '' },
      whatsappPhoneNumberId: { get: () => '' },
      whatsappAccessTokenEnv: { get: () => '' },
      whatsappEnabled: { get: () => false },
    } as unknown as Config

    const dispose = applyImRuntime(ctx, config, service)
    await new Promise(resolve => setTimeout(resolve, 50))
    dispose()

    const weixinStatus = published.find(p => p.platform === 'weixin')
    expect(weixinStatus).toEqual({ platform: 'weixin', state: 'connected' })
  })
})
