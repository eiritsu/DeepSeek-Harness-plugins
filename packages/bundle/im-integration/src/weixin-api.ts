/** Authenticated Tencent iLink Bot API helpers used by the WeChat conversation bridge. */

import {
  ILINK_API_TIMEOUT_MS,
  ILINK_BASE_URL,
  ILINK_LONG_POLL_TIMEOUT_MS,
  ILINK_MESSAGE_ITEM_TYPE,
  ILINK_MESSAGE_STATE,
  ILINK_MESSAGE_TYPE,
  ilinkBaseInfo,
  ilinkBotTokenHeaders,
} from './weixin-ilink-protocol.ts'

/** Stored credential fields after QR authorization. */
export interface WeixinBotCredential {
  readonly token: string
  readonly baseUrl: string
  readonly botId?: string
  readonly userId?: string
}

/** One inbound or outbound iLink message item. */
export interface WeixinMessageItem {
  readonly type?: number
  readonly text_item?: { readonly text?: string }
  readonly voice_item?: { readonly text?: string }
}

/** Unified Weixin message from getUpdates / sendmessage. */
export interface WeixinMessage {
  readonly seq?: number
  readonly message_id?: string
  readonly from_user_id?: string
  readonly to_user_id?: string
  readonly client_id?: string
  readonly create_time_ms?: number
  readonly message_type?: number
  readonly message_state?: number
  readonly item_list?: readonly WeixinMessageItem[]
  readonly context_token?: string
  readonly session_id?: string
}

/** Response from long-poll getUpdates. */
export interface GetUpdatesResponse {
  readonly ret?: number
  readonly errcode?: number
  readonly errmsg?: string
  readonly msgs?: readonly WeixinMessage[]
  readonly get_updates_buf?: string
  readonly longpolling_timeout_ms?: number
}

/** Response from sendmessage. */
export interface SendMessageResponse {
  readonly ret?: number
  readonly errmsg?: string
  readonly message_id?: string
}

const LOSSLESS_ID_FIELDS = new Set(['message_id', 'msg_id', 'svr_id'])

/**
 * Parse Weixin JSON while quoting uint64 id fields so they survive as strings.
 * @param rawText - response body from an iLink endpoint.
 * @returns typed object; callers validate required fields.
 */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- generic deserializer for callers with typed payloads
export function parseWeixinApiJson<T = Record<string, unknown>>(rawText: string): T {
  let output = ''
  let index = 0
  while (index < rawText.length) {
    const nonQuote = rawText[index]
    if (nonQuote !== undefined && nonQuote !== '"') {
      output += nonQuote
      index++
      continue
    }
    const stringStart = index
    index++
    let escaped = false
    while (index < rawText.length) {
      const char = rawText[index++]
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') break
    }
    const stringToken = rawText.slice(stringStart, index)
    output += stringToken

    let cursor = index
    while (/\s/.test(rawText[cursor] ?? '')) cursor++
    if (rawText[cursor] !== ':') continue

    let key: unknown
    try {
      key = JSON.parse(stringToken)
    } catch {
      // Malformed key token — leave the colon scan and continue.
      continue
    }
    if (typeof key !== 'string' || !LOSSLESS_ID_FIELDS.has(key)) continue

    output += rawText.slice(index, cursor + 1)
    cursor++
    while (/\s/.test(rawText[cursor] ?? '')) {
      const whitespace = rawText[cursor]
      if (whitespace !== undefined) output += whitespace
      cursor++
    }
    const numberStart = cursor
    if (rawText[cursor] === '-') cursor++
    while (/\d/.test(rawText[cursor] ?? '')) cursor++
    if (cursor > numberStart && !(cursor === numberStart + 1 && rawText[numberStart] === '-')) {
      output += `"${rawText.slice(numberStart, cursor)}"`
      index = cursor
    } else {
      index = numberStart
    }
  }
  return JSON.parse(output) as T
}

/**
 * Parse the Host credential value into token + optional account metadata.
 * Accepts the JSON payload written by setup, or a legacy plain token string.
 * @param raw - credential secret value.
 * @returns normalized credential, or undefined when empty.
 */
export function parseWeixinBotCredential(raw: string): WeixinBotCredential | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>
      const token = typeof record.token === 'string' ? record.token.trim() : ''
      if (token.length === 0) return undefined
      const baseUrl = typeof record.baseUrl === 'string' && record.baseUrl.trim().length > 0
        ? record.baseUrl.trim()
        : ILINK_BASE_URL
      const botId = typeof record.botId === 'string' && record.botId.trim().length > 0
        ? record.botId.trim()
        : undefined
      const userId = typeof record.userId === 'string' && record.userId.trim().length > 0
        ? record.userId.trim()
        : undefined
      return {
        token,
        baseUrl: baseUrl.replace(/\/+$/, ''),
        ...(botId === undefined ? {} : { botId }),
        ...(userId === undefined ? {} : { userId }),
      }
    }
  } catch {
    // Legacy plain-token values are still accepted.
  }
  return { token: trimmed, baseUrl: ILINK_BASE_URL }
}

/**
 * Extract plain text from an inbound Weixin message.
 * Prefers TEXT items; falls back to voice transcription when present.
 * @param message - inbound message from getUpdates.
 * @returns concatenated text, or empty when nothing usable is present.
 */
export function extractWeixinText(message: WeixinMessage): string {
  const parts: string[] = []
  for (const item of message.item_list ?? []) {
    if (item.type === ILINK_MESSAGE_ITEM_TYPE.TEXT && item.text_item?.text != null) {
      parts.push(item.text_item.text)
    } else if (item.type === ILINK_MESSAGE_ITEM_TYPE.VOICE && item.voice_item?.text != null) {
      parts.push(item.voice_item.text)
    }
  }
  return parts.join('\n').trim()
}

/**
 * Stable message id for dedupe; falls back to seq when message_id is absent.
 * @param message - inbound message.
 * @returns non-empty id string, or undefined when both fields are missing.
 */
export function weixinMessageId(message: WeixinMessage): string | undefined {
  const id = message.message_id?.trim()
  if (id !== undefined && id.length > 0) return id
  if (message.seq !== undefined) return `seq-${message.seq}`
  return undefined
}

async function apiPost(params: {
  readonly baseUrl: string
  readonly endpoint: string
  readonly body: string
  readonly token: string
  readonly timeoutMs: number
  readonly label: string
  readonly abortSignal?: AbortSignal
}): Promise<string> {
  const base = params.baseUrl.endsWith('/') ? params.baseUrl : `${params.baseUrl}/`
  const url = new URL(params.endpoint, base)
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, params.timeoutMs)
  const signal = params.abortSignal === undefined
    ? controller.signal
    : AbortSignal.any([controller.signal, params.abortSignal])
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: ilinkBotTokenHeaders(params.token),
      body: params.body,
      signal,
    })
    const rawText = await res.text()
    if (!res.ok) throw new Error(`${params.label} ${res.status}: ${rawText}`)
    return rawText
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Long-poll getUpdates. Client-side abort/timeout returns an empty success so the loop can retry.
 * @param params - credential, cursor, and abort/timeout controls.
 * @returns parsed response; empty msgs on abort/timeout.
 */
export async function weixinGetUpdates(params: {
  readonly baseUrl: string
  readonly token: string
  readonly getUpdatesBuf: string
  readonly timeoutMs?: number
  readonly abortSignal?: AbortSignal
}): Promise<GetUpdatesResponse> {
  const timeoutMs = params.timeoutMs ?? ILINK_LONG_POLL_TIMEOUT_MS
  try {
    const rawText = await apiPost({
      baseUrl: params.baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: JSON.stringify({
        get_updates_buf: params.getUpdatesBuf,
        base_info: ilinkBaseInfo(),
      }),
      token: params.token,
      timeoutMs,
      label: 'getUpdates',
      ...(params.abortSignal === undefined ? {} : { abortSignal: params.abortSignal }),
    })
    return parseWeixinApiJson<GetUpdatesResponse>(rawText)
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ret: 0, msgs: [], get_updates_buf: params.getUpdatesBuf }
    }
    throw error
  }
}

/**
 * Send a finished text bot reply to one WeChat user.
 * @param params - credential, recipient, text, and optional context_token from the inbound message.
 */
export async function weixinSendText(params: {
  readonly baseUrl: string
  readonly token: string
  readonly toUserId: string
  readonly text: string
  readonly contextToken?: string
  readonly abortSignal?: AbortSignal
}): Promise<SendMessageResponse> {
  const clientId = `dsh-im-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const rawText = await apiPost({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body: JSON.stringify({
      msg: {
        from_user_id: '',
        to_user_id: params.toUserId,
        client_id: clientId,
        message_type: ILINK_MESSAGE_TYPE.BOT,
        message_state: ILINK_MESSAGE_STATE.FINISH,
        item_list: params.text.length > 0
          ? [{ type: ILINK_MESSAGE_ITEM_TYPE.TEXT, text_item: { text: params.text } }]
          : undefined,
        ...(params.contextToken === undefined || params.contextToken.length === 0
          ? {}
          : { context_token: params.contextToken }),
      },
      base_info: ilinkBaseInfo(),
    }),
    token: params.token,
    timeoutMs: ILINK_API_TIMEOUT_MS,
    label: 'sendMessage',
    ...(params.abortSignal === undefined ? {} : { abortSignal: params.abortSignal }),
  })
  const resp = parseWeixinApiJson<SendMessageResponse>(rawText)
  if (resp.ret !== undefined && resp.ret !== 0) {
    throw new Error(`sendMessage ret=${resp.ret} errmsg=${resp.errmsg ?? '(none)'}`)
  }
  return resp
}

/**
 * Notify iLink that this channel client is starting.
 * @param params - credential and optional abort.
 */
export async function weixinNotifyStart(params: {
  readonly baseUrl: string
  readonly token: string
  readonly abortSignal?: AbortSignal
}): Promise<void> {
  await apiPost({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/msg/notifystart',
    body: JSON.stringify({ base_info: ilinkBaseInfo() }),
    token: params.token,
    timeoutMs: ILINK_API_TIMEOUT_MS,
    label: 'notifyStart',
    ...(params.abortSignal === undefined ? {} : { abortSignal: params.abortSignal }),
  })
}

/**
 * Notify iLink that this channel client is stopping.
 * Uses its own timeout so dispose can finish after the long-poll is aborted.
 * @param params - credential.
 */
export async function weixinNotifyStop(params: {
  readonly baseUrl: string
  readonly token: string
}): Promise<void> {
  await apiPost({
    baseUrl: params.baseUrl,
    endpoint: 'ilink/bot/msg/notifystop',
    body: JSON.stringify({ base_info: ilinkBaseInfo() }),
    token: params.token,
    timeoutMs: ILINK_API_TIMEOUT_MS,
    label: 'notifyStop',
  })
}
