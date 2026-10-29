/** Official WeCom CLI tool backed by the pinned `@wecom/cli` binary. */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../../config.ts'
import { channelConfigDir } from '../../cli-paths.ts'
import { positionalArgs, secretFlagReason } from '../args.ts'
import {
  ensurePrivateDir,
  runSerial,
  spawnChannelCli,
  spawnEnv,
  startChannelCli,
  type CliProcessResult,
  type CliSpawnOptions,
  type StartedCli,
} from '../runner.ts'

/**
 * Reject login and QR arguments the model must not start itself.
 * `auth show` stays allowed.
 * @param args - model-supplied arguments.
 * @returns the error text, or `undefined` when the command may run.
 */
export function wecomBlockedReason(args: readonly string[]): string | undefined {
  const secret = secretFlagReason(args)
  if (secret !== undefined) return secret
  if (args.some(arg => arg === '--output-qrcode' || arg.startsWith('--output-qrcode=')
    || arg === '--manual' || arg.startsWith('--manual=')
    || arg === '--noninteractive' || arg.startsWith('--noninteractive='))) {
    return 'Use im_cli_auth for WeCom login.'
  }
  const words = positionalArgs(args)
  const first = words[0]
  const second = words[1]
  if (first === 'login' || words.includes('upgrade') || (first === 'auth' && second === 'init')) {
    return 'Use im_cli_auth for WeCom login.'
  }
  return undefined
}

function limits(config: Config): Pick<CliSpawnOptions, 'timeoutMs' | 'maxOutputBytes' | 'graceMs' | 'cwd' | 'env'> {
  const cwd = channelConfigDir('wecom')
  return {
    timeoutMs: config.cliTimeoutMs.get(),
    maxOutputBytes: config.cliMaxOutputBytes.get(),
    graceMs: config.cliGraceMs.get(),
    cwd,
    env: spawnEnv({ WECOM_CLI_CONFIG_DIR: cwd }),
  }
}

/**
 * Absolute PNG path passed to `auth init --output-qrcode`.
 * @returns the path under the WeCom CLI config directory.
 */
export function wecomQrPath(): string {
  return join(channelConfigDir('wecom'), 'auth-qr.png')
}

/**
 * Run one `wecom-cli` command.
 * @param ctx - host services.
 * @param config - live IM configuration.
 * @param args - arguments after `wecom-cli`.
 * @param signal - caller cancellation.
 * @returns the process result.
 */
export function executeWecomCli(
  ctx: Context,
  config: Config,
  args: readonly string[],
  signal: AbortSignal,
): Promise<CliProcessResult> {
  return runSerial('wecom', async () => {
    const blocked = wecomBlockedReason(args)
    if (blocked !== undefined) throw new Error(blocked)
    signal.throwIfAborted()
    const spawn = limits(config)
    await ensurePrivateDir(spawn.cwd)
    return spawnChannelCli(ctx, 'wecom', args, signal, { ...spawn, enforceTimeout: true })
  })
}

/**
 * Start QR login and leave the process running so the user can scan.
 * @param ctx - host services.
 * @param config - live IM configuration.
 * @param signal - auth-session cancellation.
 * @returns the live login process and the PNG path it was asked to write.
 */
export async function executeWecomAuth(
  ctx: Context,
  config: Config,
  signal: AbortSignal,
): Promise<{ started: StartedCli; qrCodePath: string }> {
  const qrCodePath = wecomQrPath()
  const started = await runSerial('wecom', async () => {
    signal.throwIfAborted()
    const spawn = limits(config)
    await ensurePrivateDir(spawn.cwd)
    return startChannelCli(ctx, 'wecom', [
      'auth', 'init', '--noninteractive', '--no-browser', '--output-qrcode', qrCodePath,
    ], signal, { ...spawn, enforceTimeout: false })
  })
  return { started, qrCodePath }
}
