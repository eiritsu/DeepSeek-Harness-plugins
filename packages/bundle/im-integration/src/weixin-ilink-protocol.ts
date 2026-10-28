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
