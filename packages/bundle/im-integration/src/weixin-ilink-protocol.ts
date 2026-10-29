import { Buffer } from 'node:buffer'

/** Shared Tencent iLink Bot (WeChat ClawBot) protocol constants.
 * Values follow `@tencent-weixin/openclaw-weixin` protocol docs.
 */

/** Default API base used before a successful QR redirect. */
export const ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'

/** ClawBot channel type for personal WeChat AI contacts. */
export const ILINK_BOT_TYPE = '3'

/** Plugin application id (`package.json` `ilink_appid` in the official channel). */
export const ILINK_APP_ID = 'bot'

/**
 * Encode a semver as the iLink `iLink-App-ClientVersion` decimal string.
 * Wire format is `0x00MMNNPP` (major<<16 | minor<<8 | patch).
 * @param version - dotted plugin version such as `2.4.10`.
 * @returns decimal string sent in the request header.
 */
export function encodeIlinkClientVersion(version: string): string {
  const parts = version.split('.').map(part => Number.parseInt(part, 10))
  const major = Number.isFinite(parts[0]) ? Number(parts[0]) : 0
  const minor = Number.isFinite(parts[1]) ? Number(parts[1]) : 0
  const patch = Number.isFinite(parts[2]) ? Number(parts[2]) : 0
  return String(((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff))
}

/** Pinned to the current official `@tencent-weixin/openclaw-weixin` release. */
export const ILINK_PLUGIN_VERSION = '2.4.10'

/** Decimal `iLink-App-ClientVersion` for {@link ILINK_PLUGIN_VERSION} (`2.4.10` → `132106`). */
export const ILINK_CLIENT_VERSION = encodeIlinkClientVersion(ILINK_PLUGIN_VERSION)

/** Official QR status long-poll budget used by the Host proxy. */
export const ILINK_QR_STATUS_TIMEOUT_MS = 35_000

/** Application headers required on every iLink request. */
export function ilinkAppHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': ILINK_CLIENT_VERSION,
  }
}

/**
 * Headers for unauthenticated QR issuance (`get_bot_qrcode`).
 * @param wechatUin - base64-encoded decimal uint32.
 */
export function ilinkQrIssueHeaders(wechatUin: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': wechatUin,
    ...ilinkAppHeaders(),
  }
}

/**
 * Headers for QR status polling.
 * Official protocol omits AuthorizationType / Authorization / X-WECHAT-UIN on this GET.
 */
export function ilinkQrStatusHeaders(): Record<string, string> {
  return ilinkAppHeaders()
}

/** Default long-poll budget for authenticated `getUpdates` (matches openclaw-weixin). */
export const ILINK_LONG_POLL_TIMEOUT_MS = 35_000

/** Default timeout for authenticated send / notify calls. */
export const ILINK_API_TIMEOUT_MS = 15_000

/** Server errcode when the bot token is stale or expired. */
export const ILINK_STALE_TOKEN_ERRCODE = -14

/** proto: MessageType — inbound user messages vs bot replies. */
export const ILINK_MESSAGE_TYPE = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const

/** proto: MessageItemType — text is required for the first DSH bridge path. */
export const ILINK_MESSAGE_ITEM_TYPE = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const

/** proto: MessageState for outbound bot replies. */
export const ILINK_MESSAGE_STATE = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const

/** `base_info` attached to every authenticated iLink POST body. */
export function ilinkBaseInfo(): { channel_version: string; bot_agent: string } {
  return {
    channel_version: ILINK_PLUGIN_VERSION,
    bot_agent: `DeepSeekHarness/im/${ILINK_PLUGIN_VERSION}`,
  }
}

/**
 * Headers for authenticated bot token calls (`getUpdates`, `sendmessage`, …).
 * @param token - bot token from QR authorization; when empty, Authorization is omitted.
 */
export function ilinkBotTokenHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
    ...ilinkAppHeaders(),
  }
  const trimmed = token.trim()
  if (trimmed.length > 0) headers.Authorization = `Bearer ${trimmed}`
  return headers
}

function randomWechatUin(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  const uint32 = ((bytes[0] ?? 0) << 24)
    | ((bytes[1] ?? 0) << 16)
    | ((bytes[2] ?? 0) << 8)
    | (bytes[3] ?? 0)
  return Buffer.from(String(uint32 >>> 0), 'utf-8').toString('base64')
}
