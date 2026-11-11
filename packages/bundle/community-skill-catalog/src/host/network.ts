/** Bounded HTTPS transport with public-IP DNS pinning and proxy routing. */

import * as dnsPromises from 'node:dns/promises'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { isIP } from 'node:net'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import ipaddr from 'ipaddr.js'
import { Agent, fetch, type Dispatcher } from 'undici'

/** Public skills.sh API origin. */
export const SKILLS_SH_ORIGIN = 'https://skills.sh'
/** Public GitHub raw content CDN origin. */
export const GITHUB_RAW_ORIGIN = 'https://raw.githubusercontent.com'
/** Public GitHub REST API origin. */
export const GITHUB_API_ORIGIN = 'https://api.github.com'

const ALLOWED_ORIGINS = new Set([SKILLS_SH_ORIGIN, GITHUB_RAW_ORIGIN, GITHUB_API_ORIGIN])
const TUN_BENCHMARK_RANGE = ipaddr.parseCIDR('198.18.0.0/15')

type UndiciResponse = Awaited<ReturnType<typeof fetch>>
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** Closable HTTP response handle with buffered stream cleanup. */
export interface ResponseHandle {
  /** HTTP status code returned by the origin or proxy. */
  readonly status: number
  /** Response headers collection. */
  readonly headers: UndiciResponse['headers']
  /** Streaming body when present. */
  readonly body: UndiciResponse['body']
  /** Cancel unread body bytes, detach abort timers, and release owned agents. */
  close(): Promise<void>
}

/** Shared transport dispatcher bundle closed after a batch of raw downloads. */
export interface SharedRawDispatcher {
  /** Active proxy or pinned-lookup dispatcher for `raw.githubusercontent.com`. */
  readonly dispatcher: Dispatcher
  /** Close owned direct-connection agents if constructed. */
  close(): Promise<void>
}

function isPublicAddress(address: string, family: number): boolean {
  if (isIP(address) !== family) return false
  try { return ipaddr.parse(address).range() === 'unicast' } catch { return false }
}

function isTunBenchmarkAddress(address: string, family: number): boolean {
  if (family !== 4 || isIP(address) !== 4) return false
  try { return ipaddr.parse(address).match(TUN_BENCHMARK_RANGE) } catch { return false }
}

function withSignal<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolvePromise, reject) => {
    const onAbort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Skill catalog request was aborted.'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void work.then(resolvePromise, reject).finally(() => { signal.removeEventListener('abort', onAbort) })
  })
}

function isDnsNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false
  return error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN'
}

async function resolveDnsFallback(hostname: string, signal: AbortSignal): Promise<LookupAddress[] | undefined> {
  const resolve4Fn = 'resolve4' in dnsPromises && typeof dnsPromises.resolve4 === 'function' ? dnsPromises.resolve4 : undefined
  const resolve6Fn = 'resolve6' in dnsPromises && typeof dnsPromises.resolve6 === 'function' ? dnsPromises.resolve6 : undefined
  if (resolve4Fn === undefined && resolve6Fn === undefined) return undefined
  const [v4, v6] = await Promise.all([
    resolve4Fn === undefined
      ? Promise.resolve<string[]>([])
      : withSignal(signal, resolve4Fn(hostname)).catch(() => [] as string[]),
    resolve6Fn === undefined
      ? Promise.resolve<string[]>([])
      : withSignal(signal, resolve6Fn(hostname)).catch(() => [] as string[]),
  ])
  const records: LookupAddress[] = [
    ...v4.map(address => ({ address, family: 4 as const })),
    ...v6.map(address => ({ address, family: 6 as const })),
  ]
  return records.length > 0 ? records : undefined
}

/** Resolve and validate that a trusted origin resolves only to public unicast (or TUN) addresses.
 * @param url Trusted HTTPS URL to inspect.
 * @param signal Cancellation signal.
 * @returns Resolved DNS address records safe for socket pinning.
 */
export async function resolvePublic(url: URL, signal: AbortSignal): Promise<LookupAddress[]> {
  if (!ALLOWED_ORIGINS.has(url.origin)) throw new Error('Skill catalog request origin is not allowed.')
  const family = isIP(url.hostname)
  let records: LookupAddress[]
  if (family !== 0) {
    records = [{ address: url.hostname, family }]
  } else {
    signal.throwIfAborted()
    try {
      records = await withSignal(signal, dnsPromises.lookup(url.hostname, { all: true, order: 'verbatim' }))
    } catch (error: unknown) {
      if (!isDnsNotFound(error)) throw error
      // On macOS, mDNSResponder negative-caches or drops lookups that direct DNS queries resolve cleanly.
      const fallback = await resolveDnsFallback(url.hostname, signal)
      if (fallback === undefined) throw error
      records = fallback
    }
  }
  const allowed = ALLOWED_ORIGINS.has(url.origin)
  if (records.length === 0 || records.some(record => !isPublicAddress(record.address, record.family)
    && !(allowed && isTunBenchmarkAddress(record.address, record.family)))) {
    throw new Error(`Skill catalog host ${url.hostname} did not resolve exclusively to public addresses.`)
  }
  return records
}

function pinnedLookup(addresses: readonly LookupAddress[]): (hostname: string, options: LookupOptions, callback: LookupCallback) => void {
  return (hostname, options, callback): void => {
    const rows = options.family === 4 || options.family === 6 ? addresses.filter(row => row.family === options.family) : addresses
    if (rows.length === 0) {
      callback(new Error(`No pinned address for ${hostname}`), '', 0)
      return
    }
    if (options.all) {
      callback(null, [...rows])
      return
    }
    const row = rows[0]
    if (row === undefined) {
      callback(new Error(`No pinned address for ${hostname}`), '', 0)
      return
    }
    callback(null, row.address, row.family)
  }
}

/** Build a pooled dispatcher for parallel file reads from `raw.githubusercontent.com`.
 * @param signal Cancellation signal.
 * @returns Proxy or pinned-IP dispatcher wrapper and disposer.
 */
export async function openRawBatchDispatcher(signal: AbortSignal): Promise<SharedRawDispatcher> {
  const sampleUrl = new URL(GITHUB_RAW_ORIGIN)
  const route = proxyRouteFor(sampleUrl)
  const proxied = route.proxied && isIP(sampleUrl.hostname) === 0
  if (proxied) {
    return {
      // proxy-exempt: Returns proxyRouteFor dispatcher for the configured HTTPS proxy.
      dispatcher: route.dispatcher,
      close: async () => {},
    }
  }
  const addresses = await resolvePublic(sampleUrl, signal)
  // proxy-exempt: Direct DNS-pinned connection when proxyRouteFor does not select an explicit proxy.
  const agent = new Agent({
    connect: { lookup: pinnedLookup(addresses) },
    connections: 8,
  })
  return {
    // proxy-exempt: Returns DNS-pinned direct Agent when no proxy is configured for the URL.
    dispatcher: agent,
    close: async () => { await agent.close() },
  }
}

/** Issue a redirect-free HTTPS request to one allowlisted origin.
 * @param url Allowlisted credential-free HTTPS target URL.
 * @param timeoutMs Per-request timeout in milliseconds.
 * @param parentSignal Upstream cancellation signal.
 * @param headers Optional additional HTTP request headers.
 * @param dispatcher Optional pre-resolved batch dispatcher.
 * @returns Open response handle with explicit `close()` cleanup.
 */
export async function requestPublic(
  url: URL,
  timeoutMs: number,
  parentSignal: AbortSignal,
  headers?: Record<string, string>,
  dispatcher?: Dispatcher,
): Promise<ResponseHandle> {
  if (!ALLOWED_ORIGINS.has(url.origin)) throw new Error('Skill catalog request origin is not allowed.')
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error('Skill catalog requests require credential-free HTTPS URLs.')
  }
  parentSignal.throwIfAborted()
  const controller = new AbortController()
  const abort = (): void => { controller.abort(parentSignal.reason) }
  parentSignal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    controller.abort(new Error('Skill catalog request timed out.'))
  }, timeoutMs)

  let activeAgent: Agent | undefined
  try {
    let activeDispatcher = dispatcher
    if (activeDispatcher === undefined) {
      const route = proxyRouteFor(url)
      const proxied = route.proxied && isIP(url.hostname) === 0
      if (!proxied) {
        const addresses = await resolvePublic(url, controller.signal)
        // proxy-exempt: Direct DNS-pinned connection when proxyRouteFor reports no proxy.
        activeAgent = new Agent({ connect: { lookup: pinnedLookup(addresses) } })
      }
      activeDispatcher = proxied ? route.dispatcher : activeAgent
    }
    if (activeDispatcher === undefined) throw new Error('Skill catalog request has no network dispatcher.')
    let response: UndiciResponse
    try {
      response = await fetch(url, {
        // proxy-exempt: Routes through proxyRouteFor dispatcher when proxied or DNS-pinned Agent otherwise.
        dispatcher: activeDispatcher,
        redirect: 'manual',
        signal: controller.signal,
        method: 'GET',
        headers: { accept: 'application/json, application/octet-stream', 'user-agent': 'DeepSeek-Harness', ...(headers ?? {}) },
      })
    } catch (error: unknown) {
      throw new Error('Skill catalog network request failed.', { cause: error })
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Skill catalog redirects are not allowed.')
    }
    const ownedAgent = activeAgent
    activeAgent = undefined
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
      close: async () => {
        clearTimeout(timer)
        parentSignal.removeEventListener('abort', abort)
        await response.body?.cancel().catch(() => undefined)
        await ownedAgent?.close()
      },
    }
  } catch (error: unknown) {
    clearTimeout(timer)
    parentSignal.removeEventListener('abort', abort)
    await activeAgent?.close()
    throw error
  }
}

/** Stream a bounded byte buffer from a response handle.
 * @param response Open response handle.
 * @param limit Maximum byte size permitted.
 * @param label Error context label.
 * @returns Exact response bytes read within `limit`.
 */
export async function readBounded(response: ResponseHandle, limit: number, label = 'Skill catalog'): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'))
  if (Number.isSafeInteger(length) && length > limit) throw new Error(`${label} response exceeds ${limit} bytes.`)
  const reader = response.body?.getReader()
  if (reader === undefined) throw new Error(`${label} returned no response body.`)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      const value: unknown = result.value
      if (!(value instanceof Uint8Array)) throw new Error(`${label} returned a non-byte response chunk.`)
      size += value.byteLength
      if (size > limit) {
        await reader.cancel().catch(() => undefined)
        throw new Error(`${label} response exceeds ${limit} bytes.`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** Decode UTF-8 bytes and parse JSON strictly.
 * @param bytes Bounded UTF-8 bytes.
 * @param label Error context label.
 * @returns Parsed JSON value.
 */
export function parseJsonBytes(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error: unknown) {
    throw new Error(`${label} returned invalid JSON.`, { cause: error })
  }
}

/** Throw a typed rate-limit or unavailability error when GitHub or skills.sh rejects an API call.
 * @param source Origin classification.
 * @param status HTTP status code.
 */
export function throwUpstreamStatus(source: 'github' | 'skills-sh', status: number): never {
  if (status === 429 || (source === 'github' && status === 403)) {
    throw new RemoteError('skill-catalog/rate-limited', `${source} rate limited requests (HTTP ${status}).`, { source, status })
  }
  throw new RemoteError('skill-catalog/source-unavailable', `${source} returned HTTP ${status}.`, { source, status })
}
