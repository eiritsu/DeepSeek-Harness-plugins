/** Tencent WeChat iLink Bot Protocol integration (WeChat ClawBot). */

export interface WeixinBotQrResult {
  readonly qrcode: string
  readonly qrcodeUrl: string
}

export interface WeixinBotQrStatus {
  readonly status: 'wait' | 'scaned' | 'ok' | 'expired'
  readonly token?: string | undefined
  readonly botId?: string | undefined
}

/**
 * Request real WeChat ClawBot login QR code from Tencent iLink service.
 * @returns QR ticket and image content URL.
 */
export async function fetchWeixinBotQrCode(): Promise<WeixinBotQrResult> {
  const randomBytes = new Uint8Array(4)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes)
  }
  const uint32 = ((randomBytes[0] ?? 0) << 24) | ((randomBytes[1] ?? 0) << 16) | ((randomBytes[2] ?? 0) << 8) | (randomBytes[3] ?? 0)
  const uin = btoa(String(uint32))

  const clientVersion = 65546 // 2.4.10 encoded
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
    ret?: number
    qrcode?: string
    qrcode_img_content?: string
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
 * Poll WeChat ClawBot authorization status for a scanned QR code.
 * @param qrcode - The active QR code ticket returned by fetchWeixinBotQrCode.
 * @returns Status: 'wait' | 'scaned' | 'ok' | 'expired'.
 */
export async function pollWeixinBotQrStatus(qrcode: string): Promise<WeixinBotQrStatus> {
  const randomBytes = new Uint8Array(4)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes)
  }
  const uint32 = ((randomBytes[0] ?? 0) << 24) | ((randomBytes[1] ?? 0) << 16) | ((randomBytes[2] ?? 0) << 8) | (randomBytes[3] ?? 0)
  const uin = btoa(String(uint32))
  const clientVersion = 65546

  try {
    const response = await fetch(`https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, {
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
      status?: string
      bot_token?: string
      bot_id?: string
    }

    if (data.status === 'ok') {
      return { status: 'ok', token: data.bot_token, botId: data.bot_id }
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
