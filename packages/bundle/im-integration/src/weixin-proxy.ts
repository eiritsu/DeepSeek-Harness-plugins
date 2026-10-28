/** Tencent iLink Bot (WeChat ClawBot) host-side proxy endpoints to bypass browser CORS restrictions. */

export const WEIXIN_QRCODE_PATH = '/api/im.weixin.qrcode'
export const WEIXIN_STATUS_PATH = '/api/im.weixin.status'

const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'
const ILINK_BOT_TYPE = '3'
const ILINK_CLIENT_VERSION = '65546' // Encoded 2.4.10 client version

/**
 * Handle incoming POST /api/im.weixin.qrcode to request a live WeChat ClawBot QR code from Tencent.
 * @param _request - Incoming fetch Request.
 * @returns Response containing qrcode ticket and image content URL.
 */
export async function handleWeixinQrCode(_request: Request): Promise<Response> {
  try {
    const randomBytes = new Uint8Array(4)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(randomBytes)
    }
    const uint32 = ((randomBytes[0] ?? 0) << 24) | ((randomBytes[1] ?? 0) << 16) | ((randomBytes[2] ?? 0) << 8) | (randomBytes[3] ?? 0)
    const uin = Buffer.from(String(uint32)).toString('base64')

    const upstream = await fetch(`${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(ILINK_BOT_TYPE)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': uin,
        'iLink-App-Id': 'bot',
        'iLink-App-ClientVersion': ILINK_CLIENT_VERSION,
      },
      body: JSON.stringify({ local_token_list: [] }),
    })

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
 * @param request - Incoming fetch Request with query parameters `qrcode` and optional `verify_code`.
 * @returns Response containing authorization status.
 */
export async function handleWeixinQrStatus(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const qrcode = url.searchParams.get('qrcode')
  const verifyCode = url.searchParams.get('verify_code') ?? url.searchParams.get('verifyCode')

  if (!qrcode) {
    return Response.json({ ok: false, error: 'Missing required qrcode parameter' }, { status: 400 })
  }

  try {
    const randomBytes = new Uint8Array(4)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(randomBytes)
    }
    const uint32 = ((randomBytes[0] ?? 0) << 24) | ((randomBytes[1] ?? 0) << 16) | ((randomBytes[2] ?? 0) << 8) | (randomBytes[3] ?? 0)
    const uin = Buffer.from(String(uint32)).toString('base64')

    let endpoint = `${ILINK_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
    if (verifyCode) {
      endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`
    }

    // Keep upstream polls short so overlapping Client polls cannot pile up and stall the Host.
    const upstream = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': uin,
        'iLink-App-Id': 'bot',
        'iLink-App-ClientVersion': ILINK_CLIENT_VERSION,
      },
      signal: AbortSignal.timeout(8_000),
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
