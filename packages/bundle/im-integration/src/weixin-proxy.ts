/** Tencent iLink Bot (WeChat ClawBot) host-side proxy endpoints to bypass browser CORS restrictions. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Config } from './config.ts'
import {
  ILINK_BASE_URL,
  ILINK_BOT_TYPE,
  ILINK_QR_STATUS_TIMEOUT_MS,
  ilinkQrIssueHeaders,
  ilinkQrStatusHeaders,
} from './weixin-ilink-protocol.ts'

export const WEIXIN_QRCODE_PATH = '/api/im.weixin.qrcode'
export const WEIXIN_STATUS_PATH = '/api/im.weixin.status'

function randomWechatUin(): string {
  const randomBytes = new Uint8Array(4)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes)
  }
  const uint32 = ((randomBytes[0] ?? 0) << 24)
    | ((randomBytes[1] ?? 0) << 16)
    | ((randomBytes[2] ?? 0) << 8)
    | (randomBytes[3] ?? 0)
  return Buffer.from(String(uint32 >>> 0)).toString('base64')
}

/** Read stored WeChat bot tokens for `local_token_list` (at most 10). */
async function localBotTokenList(ctx: Context, config: Config): Promise<string[]> {
  const configured = config.weixinBotTokenEnv.get().trim() || 'WEIXIN_BOT_TOKEN'
  const current = await ctx.credentials.resolve(credentialRef(configured))
  if (current === undefined) return []
  try {
    const parsed: unknown = JSON.parse(current.value)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const token = (parsed as Record<string, unknown>).token
      if (typeof token === 'string' && token.trim().length > 0) return [token.trim()]
    }
  } catch {
    // Legacy plain-token credential values are still accepted.
  }
  const plain = current.value.trim()
  return plain.length > 0 ? [plain] : []
}

/**
 * Handle incoming POST /api/im.weixin.qrcode to request a live WeChat ClawBot QR code from Tencent.
 * @param ctx - Host context used to resolve previously stored bot tokens.
 * @param config - live IM configuration (credential reference).
 * @returns Response containing qrcode ticket and image content URL.
 */
export async function handleWeixinQrCode(ctx: Context, config: Config): Promise<Response> {
  try {
    const local_token_list = await localBotTokenList(ctx, config)
    const upstream = await fetch(
      `${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(ILINK_BOT_TYPE)}`,
      {
        method: 'POST',
        headers: ilinkQrIssueHeaders(randomWechatUin()),
        body: JSON.stringify({ local_token_list }),
      },
    )

    if (!upstream.ok) {
      return Response.json(
        { ok: false, error: `Tencent iLink HTTP ${upstream.status}` },
        { status: 502 },
      )
    }

    const data = (await upstream.json()) as {
      readonly ret?: number
      readonly qrcode?: string
      readonly qrcode_img_content?: string
    }

    if (data.ret !== 0 || !data.qrcode || !data.qrcode_img_content) {
      return Response.json(
        { ok: false, error: `Tencent iLink error ret=${data.ret}` },
        { status: 502 },
      )
    }

    return Response.json({
      ok: true,
      qrcode: data.qrcode,
      qrcodeUrl: data.qrcode_img_content,
    })
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

/**
 * Handle incoming GET /api/im.weixin.status to long-poll QR scan and authorization status.
 * @param request - Incoming fetch Request with query parameters `qrcode`, optional `verify_code`, and optional `base_url` after redirect.
 * @returns Response containing authorization status.
 */
export async function handleWeixinQrStatus(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const qrcode = url.searchParams.get('qrcode')
  const verifyCode = url.searchParams.get('verify_code') ?? url.searchParams.get('verifyCode')
  const redirectBase = url.searchParams.get('base_url')?.trim()

  if (!qrcode) {
    return Response.json({ ok: false, error: 'Missing required qrcode parameter' }, { status: 400 })
  }

  const apiBase = safeIlinkBase(redirectBase) ?? ILINK_BASE_URL

  try {
    let endpoint = `${apiBase}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
    if (verifyCode) {
      endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`
    }

    // Match the official channel's long-poll budget so the phone-side confirm can complete.
    const upstream = await fetch(endpoint, {
      method: 'GET',
      headers: ilinkQrStatusHeaders(),
      signal: AbortSignal.timeout(ILINK_QR_STATUS_TIMEOUT_MS),
    })

    if (!upstream.ok) {
      return Response.json({ ok: true, status: 'wait' })
    }

    const data = (await upstream.json()) as {
      readonly status?: string
      readonly bot_token?: string
      readonly ilink_bot_id?: string
      readonly ilink_user_id?: string
      readonly baseurl?: string
      readonly redirect_host?: string
    }

    return Response.json({
      ok: true,
      status: data.status ?? 'wait',
      token: data.bot_token,
      botId: data.ilink_bot_id,
      userId: data.ilink_user_id,
      baseUrl: data.baseurl,
      redirectHost: data.redirect_host,
    })
  } catch {
    return Response.json({ ok: true, status: 'wait' })
  }
}

/** Accept only https iLink hosts returned by Tencent redirect responses. */
function safeIlinkBase(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined
  try {
    const candidate = value.startsWith('https://') || value.startsWith('http://')
      ? value
      : `https://${value}`
    const url = new URL(candidate)
    if (url.protocol !== 'https:') return undefined
    if (!url.hostname.endsWith('.weixin.qq.com') && url.hostname !== 'ilinkai.weixin.qq.com') {
      return undefined
    }
    return url.origin
  } catch {
    return undefined
  }
}
