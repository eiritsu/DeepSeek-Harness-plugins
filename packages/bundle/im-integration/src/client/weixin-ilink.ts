/** Tencent WeChat iLink Bot Protocol integration (WeChat ClawBot). */

import {
  ILINK_BASE_URL,
  ILINK_BOT_TYPE,
  ILINK_CLIENT_VERSION,
  ilinkQrIssueHeaders,
  ilinkQrStatusHeaders,
} from '../weixin-ilink-protocol.ts'

export interface WeixinBotQrResult {
  readonly qrcode: string
  readonly qrcodeUrl: string
}

export interface WeixinBotQrStatus {
  readonly status: 'wait' | 'scaned' | 'need_verifycode' | 'ok' | 'expired' | 'blocked'
  readonly token?: string | undefined
  readonly botId?: string | undefined
  readonly userId?: string | undefined
  /** Upstream API base after `scaned_but_redirect` / `binded_redirect`. */
  readonly baseUrl?: string | undefined
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
  const response = await fetch(
    `${ILINK_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(ILINK_BOT_TYPE)}`,
    {
      method: 'POST',
      headers: ilinkQrIssueHeaders(randomWechatUin()),
      body: JSON.stringify({ local_token_list: [] }),
    },
  )

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
 * @param signal - Optional cancellation for overlapping Client polls.
 * @param baseUrl - Optional redirected API base from a previous status frame.
 * @returns Status: wait / scaned / need_verifycode / ok / expired / blocked.
 */
export async function pollWeixinBotQrStatus(
  qrcode: string,
  verifyCode?: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<WeixinBotQrStatus> {
  // 1. Try host proxy route first
  try {
    const params = new URLSearchParams({ qrcode })
    if (verifyCode) {
      params.set('verify_code', verifyCode)
    }
    if (baseUrl) {
      params.set('base_url', baseUrl)
    }
    const response = await fetch(`/api/im.weixin.status?${params.toString()}`, {
      method: 'GET',
      ...(signal === undefined ? {} : { signal }),
    })
    if (response.ok) {
      const data = (await response.json()) as {
        readonly ok?: boolean
        readonly status?: string
        readonly token?: string
        readonly botId?: string
        readonly userId?: string
        readonly baseUrl?: string
        readonly redirectHost?: string
      }
      return mapStatus(data)
    }
  } catch {
    // Fall through to direct poll
  }

  // 2. Direct upstream fallback
  try {
    const apiBase = baseUrl && /^https:\/\//.test(baseUrl) ? baseUrl.replace(/\/$/, '') : ILINK_BASE_URL
    let endpoint = `${apiBase}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`
    if (verifyCode) {
      endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`
    }
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: ilinkQrStatusHeaders(),
      ...(signal === undefined ? {} : { signal }),
    })

    if (!response.ok) {
      return { status: 'wait' }
    }

    const data = (await response.json()) as {
      readonly status?: string
      readonly bot_token?: string
      readonly ilink_bot_id?: string
      readonly ilink_user_id?: string
      readonly baseurl?: string
      readonly redirect_host?: string
    }

    return mapStatus({
      ...(data.status === undefined ? {} : { status: data.status }),
      ...(data.bot_token === undefined ? {} : { token: data.bot_token }),
      ...(data.ilink_bot_id === undefined ? {} : { botId: data.ilink_bot_id }),
      ...(data.ilink_user_id === undefined ? {} : { userId: data.ilink_user_id }),
      ...(data.baseurl === undefined ? {} : { baseUrl: data.baseurl }),
      ...(data.redirect_host === undefined ? {} : { redirectHost: data.redirect_host }),
    })
  } catch (error: unknown) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return { status: 'wait' }
    }
    return { status: 'wait' }
  }
}

function mapStatus(data: {
  readonly status?: string
  readonly token?: string
  readonly botId?: string
  readonly userId?: string
  readonly baseUrl?: string
  readonly redirectHost?: string
}): WeixinBotQrStatus {
  const redirect = normalizeRedirectBase(data.baseUrl ?? data.redirectHost)
  if (data.status === 'confirmed' || data.status === 'ok' || data.status === 'binded_redirect') {
    return {
      status: 'ok',
      token: data.token,
      botId: data.botId,
      userId: data.userId,
      ...(redirect === undefined ? {} : { baseUrl: redirect }),
    }
  }
  if (data.status === 'need_verifycode') {
    return { status: 'need_verifycode', ...(redirect === undefined ? {} : { baseUrl: redirect }) }
  }
  if (data.status === 'verify_code_blocked') {
    return { status: 'blocked', ...(redirect === undefined ? {} : { baseUrl: redirect }) }
  }
  if (data.status === 'scaned' || data.status === 'scaned_but_redirect') {
    return { status: 'scaned', ...(redirect === undefined ? {} : { baseUrl: redirect }) }
  }
  if (data.status === 'expired') {
    return { status: 'expired' }
  }
  return { status: 'wait', ...(redirect === undefined ? {} : { baseUrl: redirect }) }
}

function normalizeRedirectBase(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined
  try {
    // Official `redirect_host` is a bare hostname; `baseurl` is a full https origin.
    const candidate = value.startsWith('https://') || value.startsWith('http://')
      ? value
      : `https://${value.replace(/^\/\//, '')}`
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

function randomWechatUin(): string {
  const randomBytes = new Uint8Array(4)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes)
  }
  const uint32 = ((randomBytes[0] ?? 0) << 24)
    | ((randomBytes[1] ?? 0) << 16)
    | ((randomBytes[2] ?? 0) << 8)
    | (randomBytes[3] ?? 0)
  return btoa(String(uint32 >>> 0))
}

/** Exposed for diagnostics and tests. */
export const WEIXIN_ILINK_CLIENT_VERSION = ILINK_CLIENT_VERSION
