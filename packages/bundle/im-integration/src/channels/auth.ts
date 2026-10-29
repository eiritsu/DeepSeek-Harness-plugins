/** Shared `im_cli_auth` session: start interactive login and return the QR, URL, or device code. */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.ts'
import type { ImCliChannel } from '../cli-paths.ts'
import { executeDingtalkAuth } from './dingtalk/cli.ts'
import { executeLarkAuth } from './lark/cli.ts'
import { executeWecomAuth } from './wecom/cli.ts'
import { type StartedCli } from './runner.ts'

/** Parsed login hints returned to the model. */
export interface AuthHints {
  /** Verification or authorization URL, or empty. */
  url: string
  /** Device code, or empty. */
  deviceCode: string
  /** Short user code, or empty. */
  userCode: string
}

/** Result of one `im_cli_auth` call. */
export interface AuthOutput {
  /** Channel that was started. */
  channel: string
  /** Exit code once the process has exited, otherwise null. */
  exitCode: number | null
  /** Reserved for a deadline. Auth sessions are not killed by the process deadline. */
  timedOut: boolean
  /** Stdout captured before the tool returned. */
  stdout: string
  /** Terminating signal once the process has exited, otherwise null. */
  signal: NodeJS.Signals | null
  /** Stderr captured before the tool returned. */
  stderr: string
  /** Authorization URL, or empty. */
  url: string
  /** Device code, or empty. */
  deviceCode: string
  /** Short user code, or empty. */
  userCode: string
  /** QR image path, or empty. */
  qrCodePath: string
  /** True when the login process is still running after the tool returns. */
  pending: boolean
}

interface AuthSession {
  readonly controller: AbortController
  terminate?: () => void
}

const sessions = new Map<string, AuthSession>()

/**
 * Abort the previous auth session for `channel` and return the new signal.
 * @param channel - CLI channel.
 * @returns the signal that cancels this session and its child process.
 */
export function replaceAuthSession(channel: string): AbortSignal {
  sessions.get(channel)?.controller.abort()
  const controller = new AbortController()
  const session: AuthSession = { controller }
  controller.signal.addEventListener('abort', () => { session.terminate?.() })
  sessions.set(channel, session)
  return controller.signal
}

/**
 * Attach the child stopper to the current session.
 * An already aborted session stops the child immediately.
 * @param channel - CLI channel.
 * @param terminate - stops the child.
 * @returns nothing.
 */
export function bindAuthProcess(channel: string, terminate: () => void): void {
  const session = sessions.get(channel)
  if (session === undefined) return
  session.terminate = terminate
  if (session.controller.signal.aborted) terminate()
}

/**
 * Read URLs and device codes from CLI output.
 * @param text - combined stdout and stderr.
 * @returns the captured hints. Missing fields are empty strings.
 */
export function parseAuthOutput(text: string): AuthHints {
  const url = text.match(/https?:\/\/[^\s"'<>]+/)?.[0] ?? ''
  const deviceCode = text.match(/(?:device[-_ ]?code|设备码)\s*[:=]\s*([0-9a-z_-]+)/i)?.[1] ?? ''
  const userCode = text.match(/(?:user[-_ ]?code|用户码|验证码)\s*[:=]\s*([0-9a-z_-]+)/i)?.[1] ?? ''
  return { url, deviceCode, userCode }
}

/** Output reader used while an auth process is still running. */
export interface AuthReader {
  /** @param fromByte - stream offset. @returns retained text. */
  readFrom(fromByte: number): { text: string }
}

/** Child observed by {@link readUntil}. */
export interface AuthHandle {
  /** Settles when the child exits. */
  done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  /** Collected streams. */
  collected: { stdout?: AuthReader; stderr?: AuthReader }
  /** Stop the child. */
  terminate(): void
}

/** Facts available before an auth process has to finish. */
export interface ReadUntilResult {
  /** Captured stdout. */
  stdout: string
  /** Captured stderr. */
  stderr: string
  /** Exit code when the process already exited. */
  exitCode: number | null
  /** Terminating signal when the process already exited. */
  signal: NodeJS.Signals | null
  /** True when the process was still running. */
  pending: boolean
  /** True when the caller aborted the read. */
  timedOut: boolean
}

function readerText(reader: AuthReader | undefined): string {
  if (reader === undefined) return ''
  return reader.readFrom(0).text
}

/**
 * Poll collected output until `ready`, the process exits, the signal aborts, or `waitMs` elapses.
 * Elapsing does not stop the process.
 * @param handle - live child.
 * @param ready - returns true when the captured text is enough to relay.
 * @param waitMs - how long to poll before returning anyway.
 * @param signal - cancellation. Aborts the child.
 * @returns the captured text and whether the child is still running.
 */
export async function readUntil(
  handle: AuthHandle,
  ready: (stdout: string, stderr: string) => boolean,
  waitMs: number,
  signal: AbortSignal,
): Promise<ReadUntilResult> {
  if (signal.aborted) {
    handle.terminate()
    return { stdout: '', stderr: '', exitCode: null, signal: null, pending: false, timedOut: true }
  }
  let settled: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined
  const track = handle.done.then(
    (outcome) => { settled = { exitCode: outcome.exitCode, signal: outcome.signal } },
    () => { settled = { exitCode: null, signal: null } },
  )
  const started = Date.now()
  let stdout = ''
  let stderr = ''
  while (settled === undefined && Date.now() - started <= waitMs) {
    stdout = readerText(handle.collected.stdout)
    stderr = readerText(handle.collected.stderr)
    if (ready(stdout, stderr)) break
    if (signal.aborted) {
      handle.terminate()
      break
    }
    await new Promise<void>((resolve) => { setTimeout(resolve, 15) })
  }
  await Promise.race([track, Promise.resolve()])
  stdout = readerText(handle.collected.stdout)
  stderr = readerText(handle.collected.stderr)
  return {
    stdout,
    stderr,
    exitCode: settled?.exitCode ?? null,
    signal: settled?.signal ?? null,
    pending: settled === undefined && !signal.aborted,
    timedOut: signal.aborted,
  }
}

function authReady(channel: ImCliChannel, qrCodePath: string): (stdout: string, stderr: string) => boolean {
  return (stdout, stderr) => {
    const text = `${stdout}\n${stderr}`
    if (channel === 'wecom') return text.includes(qrCodePath) || /qrcode|qr code|二维码/i.test(text)
    const hints = parseAuthOutput(text)
    return hints.url !== '' || hints.deviceCode !== '' || hints.userCode !== ''
  }
}

/**
 * Start interactive auth for one channel and return as soon as a relayable hint is available.
 * @param ctx - host services.
 * @param config - live IM configuration.
 * @param channel - CLI channel.
 * @param toolSignal - tool cancellation. This aborts the auth session.
 * @param active - whether that channel's tool is currently enabled.
 * @returns the auth output, including a still-running process when `pending` is true.
 */
export async function executeImCliAuth(
  ctx: Context,
  config: Config,
  channel: ImCliChannel,
  toolSignal: AbortSignal,
  active: boolean,
): Promise<AuthOutput> {
  if (!active) throw new Error(`Enable the ${channel} CLI in Settings before authenticating.`)
  const signal = replaceAuthSession(channel)
  const onToolAbort = (): void => { sessions.get(channel)?.controller.abort() }
  if (toolSignal.aborted) onToolAbort()
  else toolSignal.addEventListener('abort', onToolAbort, { once: true })
  try {
    if (signal.aborted) throw new Error('The IM CLI auth session was cancelled.')
    const started = await startAuth(ctx, config, channel, signal)
    bindAuthProcess(channel, () => { started.handle.terminate() })
    const qrCodePath = started.qrCodePath
    const read = await readUntil(started.handle, authReady(channel, qrCodePath), 3_000, signal)
    const hints = parseAuthOutput(`${read.stdout}\n${read.stderr}`)
    return {
      channel,
      exitCode: read.exitCode,
      signal: read.signal,
      timedOut: read.timedOut,
      stdout: read.stdout,
      stderr: read.stderr,
      url: hints.url,
      deviceCode: hints.deviceCode,
      userCode: hints.userCode,
      qrCodePath,
      pending: read.pending,
    }
  } finally {
    toolSignal.removeEventListener('abort', onToolAbort)
  }
}

async function startAuth(
  ctx: Context,
  config: Config,
  channel: ImCliChannel,
  signal: AbortSignal,
): Promise<{ handle: StartedCli['handle']; qrCodePath: string }> {
  if (channel === 'lark') {
    const started = await executeLarkAuth(ctx, config, signal)
    return { handle: started.handle, qrCodePath: '' }
  }
  if (channel === 'wecom') {
    const started = await executeWecomAuth(ctx, config, signal)
    return { handle: started.started.handle, qrCodePath: started.qrCodePath }
  }
  const started = await executeDingtalkAuth(ctx, config, signal)
  return { handle: started.handle, qrCodePath: '' }
}
