/** Bounded HTTP fetch for user-supplied iCalendar subscriptions. */
import type { CalendarSubscriptionErrorCode } from './types.ts'

/** Limits one subscription fetch applies. */
export interface IcsFetchBounds {
  /** Deadline covering connect, redirects, and the whole body. */
  readonly timeoutMs: number
  /** Largest accepted response body, in bytes. */
  readonly maxBytes: number
}

/** Result of one fetch, or the reason it did not produce text. */
export type IcsFetchResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: CalendarSubscriptionErrorCode; readonly message: string }

/** Why a subscription is rejected before any request is made. */
export interface UrlCheckFailure {
  readonly code: CalendarSubscriptionErrorCode
  readonly message: string
}

/**
 * Validate one user-supplied subscription URL.
 *
 * The accepted form is an absolute `https:` or `http:` URL with a host.
 * `http:` is admitted because a user may point the calendar at a server on
 * their own machine, and a loopback host is a normal target for that.
 * @param value - Raw URL text.
 * @returns the parsed URL and its protocol, or the rejection reason.
 */
export function parseSubscriptionUrl(value: string): { readonly ok: true; readonly url: URL; readonly protocol: 'https' | 'http' } | UrlCheckFailure {
  const trimmed = value.trim()
  if (trimmed === '') return { code: 'invalid-url', message: 'A subscription URL is required.' }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { code: 'invalid-url', message: 'A subscription URL must be an absolute URL.' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { code: 'unsupported-protocol', message: 'A subscription URL must use https: or http:.' }
  }
  if (parsed.hostname === '') return { code: 'invalid-url', message: 'A subscription URL must name a host.' }
  return { ok: true, url: parsed, protocol: parsed.protocol === 'https:' ? 'https' : 'http' }
}

/** Redirect hops one fetch follows before giving up. */
const MAX_REDIRECTS = 4

/**
 * Fetch one iCalendar document under explicit bounds.
 *
 * Redirects are followed manually and only to the protocol the user chose, so
 * a feed served over `https:` cannot redirect the Host onto `http:` and bypass
 * the choice. The body is read with a byte ceiling and a whole-fetch deadline.
 * @param target - Validated absolute URL.
 * @param bounds - Deadline and byte ceiling for this fetch.
 * @param signal - Cancellation owned by the caller; aborting stops the body read.
 * @returns the document text, or the reason the fetch did not produce one.
 */
export async function fetchIcs(target: URL, bounds: IcsFetchBounds, signal: AbortSignal): Promise<IcsFetchResult> {
  const deadline = AbortSignal.timeout(bounds.timeoutMs)
  const composed = AbortSignal.any([deadline, signal])
  let current = target
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const response = await fetch(current, { redirect: 'manual', signal: composed })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (location === null) {
          return { ok: false, code: 'redirect-rejected', message: 'The server redirected without a target.' }
        }
        const next = new URL(location, current)
        if (next.protocol !== current.protocol) {
          return {
            ok: false,
            code: 'redirect-rejected',
            message: `The server redirected from ${current.protocol} to ${next.protocol}; the configured protocol is kept.`,
          }
        }
        current = next
        continue
      }
      if (!response.ok) {
        await response.body?.cancel()
        return {
          ok: false,
          code: response.status === 404 ? 'not-found' : response.status >= 500 ? 'service-unavailable' : 'request-failed',
          message: `The server answered ${response.status} ${response.statusText}.`.trim(),
        }
      }
      const declared = Number(response.headers.get('content-length') ?? Number.NaN)
      if (Number.isFinite(declared) && declared > bounds.maxBytes) {
        await response.body?.cancel()
        return { ok: false, code: 'response-too-large', message: 'The feed declares a body larger than the configured limit.' }
      }
      return await readBody(response, bounds)
    }
    return { ok: false, code: 'redirect-rejected', message: 'The server redirected more times than the configured limit.' }
  } catch (error: unknown) {
    if (signal.aborted) throw error
    if (deadline.aborted) {
      return { ok: false, code: 'timeout', message: 'The feed did not answer within the configured timeout.' }
    }
    return { ok: false, code: 'request-failed', message: 'The feed could not be fetched.' }
  }
}

/**
 * Read a response body under a byte ceiling, stopping the transfer as soon as
 * the ceiling is passed so an unbounded response cannot exhaust memory. The
 * deadline and cancellation signals already govern this response, so a read
 * pending when either aborts rejects here.
 * @param response - Successful response whose body is not yet read.
 * @param bounds - Byte ceiling for this fetch.
 * @returns the decoded text, or the reason the body was rejected.
 */
async function readBody(response: Response, bounds: IcsFetchBounds): Promise<IcsFetchResult> {
  const body = response.body
  if (body === null) return { ok: true, text: '' }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > bounds.maxBytes) {
      await reader.cancel()
      return { ok: false, code: 'response-too-large', message: 'The feed body is larger than the configured limit.' }
    }
    chunks.push(chunk.value)
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder('utf-8').decode(merged) }
}
