/** Tencent WeChat iLink Bot Protocol integration (WeChat ClawBot). */

export interface WeixinBotQrResult {
  readonly qrcode: string
  readonly qrcodeUrl: string
}

export interface WeixinBotQrStatus {
  readonly status: 'wait' | 'scaned' | 'need_verifycode' | 'ok' | 'expired'
  readonly token?: string | undefined
  readonly botId?: string | undefined
  readonly userId?: string | undefined
}

/**
 * Request real WeChat ClawBot login QR code.
 * Routes through the Host proxy `/api/im.weixin.qrcode` to avoid browser CORS restrictions.
 * @returns QR ticket and image content URL.
 */
export async function fetchWeixinBotQrCode(): Promise<WeixinBotQrResult> {
  // 1. Try host-side proxy route first (primary path in DSH Web UI)
  try {
    const response = await fetch('/api/im.weixin.qrcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (response.ok) {
      const data = (await response.json()) as {
        readonly ok?: boolean
        readonly qrcode?: string
        readonly qrcodeUrl?: string
        readonly error?: string
      }
      if (data.ok && data.qrcode && data.qrcodeUrl) {
        return {
          qrcode: data.qrcode,
          qrcodeUrl: data.qrcodeUrl,
        }
      }
    }
  } catch {
    // Fall through to direct iLink fetch (e.g. Node tests or non-sandboxed environment)
  }

  // 2. Direct upstream fallback (works in Node.js / non-browser environments)
  const randomBytes = new Uint8Array(4)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes)
  }
  const uint32 = ((randomBytes[0] ?? 0) << 24) | ((randomBytes[1] ?? 0) << 16) | ((randomBytes[2] ?? 0) << 8) | (randomBytes[3] ?? 0)
  const uin = btoa(String(uint32))
  const clientVersion = 65546

  const response = await fetch('https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      'X-WECHAT-UIN': uin,
      'iLink-App-Id': 'bot',
      'iLink-App-ClientVersion': String(clientVersion),
    },
    body: JSON.stringify({ local_token_list: [] }),
  })

  if (!response.ok) {
    throw new Error(`iLink HTTP error ${response.status}: ${response.statusText}`)
  }

  const data = (await response.json()) as {
    readonly ret?: number
    readonly qrcode?: string
    readonly qrcode_img_content?: string
  }

  if (data.ret !== 0 || !data.qrcode || !data.qrcode_img_content) {
    throw new Error(`Failed to obtain Weixin ClawBot QR code: ret=${data.ret}`)
  }

  return {
    qrcode: data.qrcode,
    qrcodeUrl: data.qrcode_img_content,
  }
}

/**
 * Poll WeChat ClawBot authorization status for an active QR code ticket.
 * Routes through the Host proxy `/api/im.weixin.status`.
 * @param qrcode - The active QR code ticket returned by fetchWeixinBotQrCode.
 * @param verifyCode - Optional verification digits when status is `need_verifycode`.
 * @returns Status: 'wait' | 'scaned' | 'need_verifycode' | 'ok' | 'expired'.
 */
export async function pollWeixinBotQrStatus(
  qrcode: string,
  verifyCode?: string,
): Promise<WeixinBotQrStatus> {
  // 1. Try host proxy route first
  try {
    const params = new URLSearchParams({ qrcode })
    if (verifyCode) {
      params.set('verify_code', verifyCode)
    }
    const response = await fetch(`/api/im.weixin.status?${params.toString()}`, {
      method: 'GET',
    })
    if (response.ok) {
      const data = (await response.json()) as {
        readonly ok?: boolean
        readonly status?: string
        readonly token?: string
        readonly botId?: string
        readonly userId?: string
      }
      if (data.status === 'confirmed' || data.status === 'ok') {
        return { status: 'ok', token: data.token, botId: data.botId, userId: data.userId }
      }
      if (data.status === 'need_verifycode') {
        return { status: 'need_verifycode' }
      }
      if (data.status === 'scaned') {
        return { status: 'scaned' }
      }
      if (data.status === 'expired') {
        return { status: 'expired' }
      }
      return { status: 'wait' }
    }
  } catch {
    // Fall through to direct poll
  }

  // 2. Direct upstream fallback
  const randomBytes = new Uint8Array(4)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes)
  }
  const uint32 = ((randomBytes[0] ?? 0) << 24) | ((randomBytes[1] ?? 0) << 16) | ((randomBytes[2] ?? 0) << 8) | (randomBytes[3] ?? 0)
  const uin = btoa(String(uint32))
  const clientVersion = 65546

  try {
    let endpoint = `https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
    if (verifyCode) {
      endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`
    }
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        'X-WECHAT-UIN': uin,
        'iLink-App-Id': 'bot',
        'iLink-App-ClientVersion': String(clientVersion),
      },
    })

    if (!response.ok) {
      return { status: 'wait' }
    }

    const data = (await response.json()) as {
      readonly status?: string
      readonly bot_token?: string
      readonly ilink_bot_id?: string
      readonly ilink_user_id?: string
    }

    if (data.status === 'confirmed' || data.status === 'ok') {
      return { status: 'ok', token: data.bot_token, botId: data.ilink_bot_id, userId: data.ilink_user_id }
    }
    if (data.status === 'need_verifycode') {
      return { status: 'need_verifycode' }
    }
    if (data.status === 'scaned') {
      return { status: 'scaned' }
    }
    if (data.status === 'expired') {
      return { status: 'expired' }
    }
    return { status: 'wait' }
  } catch {
    return { status: 'wait' }
  }
}
