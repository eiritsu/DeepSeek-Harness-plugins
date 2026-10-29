/** Official DingTalk workspace CLI (`dws`) tool. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
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
 * Reject login, upgrade, and identity flags the model must not supply.
 * `auth status` stays allowed.
 * @param args - model-supplied arguments.
 * @returns the error text, or `undefined` when the command may run.
 */
export function dingtalkBlockedReason(args: readonly string[]): string | undefined {
  const secret = secretFlagReason(args)
  if (secret !== undefined) return secret
  if (args.some(arg => arg === '--device' || arg.startsWith('--device=')
    || arg === '--profile' || arg.startsWith('--profile=' )
    || arg === '--client-id' || arg.startsWith('--client-id='))) {
    return 'This integration supplies DingTalk CLI identity. Remove client and profile flags from the command.'
  }
  const words = positionalArgs(args)
  const first = words[0]
  const second = words[1]
  if ((first === 'auth' && second === 'login') || words.includes('upgrade')) return 'Use im_cli_auth for DingTalk login.'
  return undefined
}

async function identityEnv(ctx: Context, config: Config): Promise<{ cwd: string; env: NodeJS.ProcessEnv; limits: Pick<CliSpawnOptions, 'timeoutMs' | 'maxOutputBytes' | 'graceMs'> }> {
  const clientId = config.dingtalkClientId.get().trim()
  if (clientId === '') throw new Error('Set the DingTalk client ID in Settings before using the CLI.')
  const ref = config.dingtalkClientSecretEnv.get().trim()
  const secret = ref === '' ? undefined : await ctx.credentials.resolve(credentialRef(ref))
  if (secret === undefined) throw new Error('Configure the DingTalk client secret before using the CLI.')
  const cwd = channelConfigDir('dingtalk')
  return {
    cwd,
    limits: {
      timeoutMs: config.cliTimeoutMs.get(),
      maxOutputBytes: config.cliMaxOutputBytes.get(),
      graceMs: config.cliGraceMs.get(),
    },
    env: spawnEnv({
      DWS_CONFIG_DIR: cwd,
      DWS_CLIENT_ID: clientId,
      DWS_CLIENT_SECRET: secret.value,
      DWS_NO_UPDATE_CHECK: '1',
      DWS_NO_SKILLS: '1',
      DWS_DISABLE_KEYCHAIN: '1',
    }),
  }
}

/**
 * Run one `dws` command. The client secret is placed in the environment, never in argv.
 * @param ctx - host services.
 * @param config - live IM configuration.
 * @param args - arguments after `dws`.
 * @param signal - caller cancellation.
 * @returns the process result.
 */
export function executeDingtalkCli(
  ctx: Context,
  config: Config,
  args: readonly string[],
  signal: AbortSignal,
): Promise<CliProcessResult> {
  return runSerial('dingtalk', async () => {
    const blocked = dingtalkBlockedReason(args)
    if (blocked !== undefined) throw new Error(blocked)
    signal.throwIfAborted()
    const identity = await identityEnv(ctx, config)
    await ensurePrivateDir(identity.cwd)
    return spawnChannelCli(ctx, 'dingtalk', args, signal, {
      ...identity.limits,
      cwd: identity.cwd,
      env: identity.env,
      enforceTimeout: true,
    })
  })
}

/**
 * Start `dws auth login --device` and leave it running until the session is cancelled.
 * @param ctx - host services.
 * @param config - live IM configuration.
 * @param signal - auth-session cancellation.
 * @returns the live login process.
 */
export function executeDingtalkAuth(ctx: Context, config: Config, signal: AbortSignal): Promise<StartedCli> {
  return runSerial('dingtalk', async () => {
    signal.throwIfAborted()
    const identity = await identityEnv(ctx, config)
    await ensurePrivateDir(identity.cwd)
    return startChannelCli(ctx, 'dingtalk', ['auth', 'login', '--device'], signal, {
      ...identity.limits,
      cwd: identity.cwd,
      env: identity.env,
      enforceTimeout: false,
    })
  })
}
