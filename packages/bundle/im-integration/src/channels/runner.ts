/** Spawn a verified IM CLI and keep each channel's processes serial. */

import { mkdir } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { channelRunner, type ImCliChannel } from '../cli-paths.ts'
import { ensureChannelBinary, type EnsureChannelBinaryOptions } from './install.ts'

/** Extra time the tool budget allows for the first verified download. */
export const INSTALL_BUDGET_MS = 120_000
/** Slack added on top of every per-process deadline. */
export const TOOL_SLACK_MS = 5_000

const TOMBSTONES = [
  'WECOM_CLI_ACCESS_TOKEN',
  'DWS_CLIENT_ID',
  'DWS_CLIENT_SECRET',
  'DWS_CONFIG_DIR',
  'DWS_PROFILE',
  'DWS_ACCESS_TOKEN',
  'DWS_TOKEN',
  'LARKSUITE_CLI_APP_ID',
  'LARKSUITE_CLI_APP_SECRET',
  'LARKSUITE_CLI_BRAND',
  'LARKSUITE_CLI_PROFILE',
] as const

const INHERITED_CLI_KEY = /^(?:WECOM_CLI_ACCESS_TOKEN|DWS_.+|LARKSUITE_CLI_(?:APP_ID|APP_SECRET|BRAND|PROFILE))$/

/**
 * Tool timeout that covers the install budget plus every CLI process the call may start.
 * @param timeoutMs - per-process deadline.
 * @param graceMs - per-process termination grace.
 * @param processes - maximum official CLI processes one call starts.
 * @returns the tool timeout in milliseconds.
 */
export function toolTimeoutMs(timeoutMs: number, graceMs: number, processes: number): number {
  return INSTALL_BUDGET_MS + processes * (timeoutMs + graceMs) + TOOL_SLACK_MS
}

/**
 * Whether an inherited environment name can select another CLI identity or token.
 * @param key - environment variable name.
 * @returns `true` when the child must not keep the parent's value.
 */
export function inheritedCliKey(key: string): boolean {
  return INHERITED_CLI_KEY.test(key)
}

/**
 * Copy `parent`, drop inherited CLI identity, then apply `extra`.
 * @param parent - ambient environment the caller inspected.
 * @param extra - names this integration sets on purpose, including secret values supplied via the environment.
 * @returns the merged map. Tombstoned names are `undefined`.
 */
export function scrubInherited(
  parent: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(parent)) {
    env[key] = inheritedCliKey(key) ? undefined : value
  }
  for (const [key, value] of Object.entries(extra)) env[key] = value
  return env
}

/**
 * Environment delta passed to `ctx.subprocess.spawn`.
 * Inherited CLI identity is tombstoned. `extra` may set a replacement.
 * @param extra - names this call sets.
 * @param versions - process versions, used to set `ELECTRON_RUN_AS_NODE` inside Electron.
 * @returns the spawn `env` map.
 */
export function spawnEnv(
  extra: Readonly<Record<string, string | undefined>>,
  versions: NodeJS.ProcessVersions = process.versions,
  parent: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of Object.keys(parent)) {
    if (inheritedCliKey(key)) env[key] = undefined
  }
  for (const key of TOMBSTONES) env[key] = undefined
  for (const [key, value] of Object.entries(extra)) env[key] = value
  if (versions.electron !== undefined) env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

/**
 * Whether the process deadline fired before the caller aborted.
 * @param deadline - process deadline, absent when the call keeps the child alive.
 * @param signal - caller cancellation signal.
 * @returns `true` when the deadline aborted the child.
 */
export function deadlineTimedOut(deadline: AbortSignal | undefined, signal: AbortSignal): boolean {
  return deadline !== undefined && deadline.aborted && !signal.aborted
}

/** Bounded result of one CLI process. */
export interface CliProcessResult {
  /** Exit code, or null when the process died from a signal or is still running. */
  exitCode: number | null
  /** Terminating signal, or null on a normal exit. */
  signal: NodeJS.Signals | null
  /** True when the configured process deadline aborted the child. */
  timedOut: boolean
  /** Captured stdout, possibly truncated to the configured cap. */
  stdout: string
  /** Captured stderr, possibly truncated to the configured cap. */
  stderr: string
}

/** Collected-output reader used by the spawn result. */
export interface CollectedReader {
  /** @param fromByte - stream offset. @returns the retained text. */
  readFrom(fromByte: number): { text: string }
}

/** Live child returned to auth, which reads output before the process exits. */
export interface StartedCli {
  /** Subprocess handle. */
  handle: {
    /** Settles with the child's exit facts. */
    done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
    /** Collected stdout and stderr. */
    collected: { stdout?: CollectedReader; stderr?: CollectedReader }
    /** Stop the child. */
    terminate(): void
  }
  /** Process deadline, absent for an auth session that must outlive the tool result. */
  deadline: AbortSignal | undefined
  /** Caller signal observed for timeout classification. */
  signal: AbortSignal
}

/** Limits and environment for one CLI process. */
export interface CliSpawnOptions {
  /** Per-process deadline in milliseconds. Ignored when `enforceTimeout` is false. */
  timeoutMs: number
  /** Maximum retained bytes of each output stream. */
  maxOutputBytes: number
  /** Termination grace in milliseconds. */
  graceMs: number
  /** Working directory. */
  cwd: string
  /** Environment delta. `DSH_IM_CLI_BIN` is added after the binary is verified. */
  env: NodeJS.ProcessEnv
  /** When false, only `signal` can abort the child. */
  enforceTimeout: boolean
  /** Installer overrides. Tests use this to avoid a network download. */
  install?: EnsureChannelBinaryOptions
}

const tails = new Map<string, Promise<void>>()

/**
 * Run `operation` after the previous operation for `channel` settles.
 * @param channel - queue name.
 * @param operation - work that must not overlap the previous operation.
 * @returns the operation's result.
 */
export function runSerial<T>(channel: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(channel) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  tails.set(channel, gate)
  return previous.then(operation).finally(release)
}

/**
 * Create a directory the CLI may fill with tokens. Mode `0700` applies to a directory this call creates.
 * @param dir - absolute directory.
 * @returns nothing.
 */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
}

function collectedText(reader: CollectedReader | undefined): string {
  if (reader === undefined) return ''
  return reader.readFrom(0).text
}

/**
 * Start one verified CLI process.
 * @param ctx - host context whose subprocess service spawns the runner.
 * @param channel - CLI channel.
 * @param args - arguments after the runner, already including any profile flag this integration owns.
 * @param signal - caller cancellation.
 * @param options - deadlines, environment, and installer overrides.
 * @param stdin - optional stdin payload. Secrets go here, never in `args`.
 * @returns the live child.
 */
export async function startChannelCli(
  ctx: Context,
  channel: ImCliChannel,
  args: readonly string[],
  signal: AbortSignal,
  options: CliSpawnOptions,
  stdin?: string,
): Promise<StartedCli> {
  const bin = await ensureChannelBinary(channel, options.install)
  const deadline = options.enforceTimeout ? AbortSignal.timeout(options.timeoutMs) : undefined
  const combined = deadline === undefined ? signal : AbortSignal.any([signal, deadline])
  const handle = ctx.subprocess.spawn({
    argv: [process.execPath, channelRunner(channel), ...args],
    cwd: options.cwd,
    stdio: {
      stdin: stdin === undefined ? 'ignore' : { data: stdin },
      stdout: { maxBytes: options.maxOutputBytes },
      stderr: { maxBytes: options.maxOutputBytes },
    },
    graceMs: options.graceMs,
    signal: combined,
    env: { ...options.env, DSH_IM_CLI_BIN: bin },
  })
  return { handle, deadline, signal }
}

/**
 * Wait for a started CLI process and return its capped output.
 * @param started - live child from {@link startChannelCli}.
 * @returns the exit facts and captured output.
 */
export async function finishCli(started: StartedCli): Promise<CliProcessResult> {
  const outcome = await started.handle.done
  return {
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: deadlineTimedOut(started.deadline, started.signal),
    stdout: collectedText(started.handle.collected.stdout),
    stderr: collectedText(started.handle.collected.stderr),
  }
}

/**
 * Start one CLI process and wait for it.
 * @param ctx - host context.
 * @param channel - CLI channel.
 * @param args - CLI arguments.
 * @param signal - caller cancellation.
 * @param options - deadlines and environment.
 * @param stdin - optional stdin payload.
 * @returns the process result.
 */
export async function spawnChannelCli(
  ctx: Context,
  channel: ImCliChannel,
  args: readonly string[],
  signal: AbortSignal,
  options: CliSpawnOptions,
  stdin?: string,
): Promise<CliProcessResult> {
  return finishCli(await startChannelCli(ctx, channel, args, signal, options, stdin))
}
