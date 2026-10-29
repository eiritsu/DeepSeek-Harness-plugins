/** Official Lark/Feishu CLI tool backed by the pinned `lark-cli` binary. */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
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

const PROFILE_PREFIX = 'dsh-'
const PROFILE_HASH_LENGTH = 32

/**
 * Profile name for one application identity.
 * @param brand - Feishu or Lark.
 * @param appId - application id.
 * @returns the profile name stored by `lark-cli`.
 */
export function larkProfileName(brand: 'feishu' | 'lark', appId: string): string {
  const digest = createHash('sha256').update(appId).digest('hex').slice(0, PROFILE_HASH_LENGTH)
  return `${PROFILE_PREFIX}${brand}-${digest}`
}

/** Values one Lark CLI call reads from live settings. */
interface LarkSnapshot {
  readonly enabled: boolean
  readonly appId: string
  readonly appSecretEnv: string
  readonly brand: 'feishu' | 'lark'
  readonly profile: string
  readonly spawn: CliSpawnOptions
}

interface LarkProfile {
  readonly name: string
  readonly appId: string
  readonly brand: string
}

/**
 * Reject profile, login, and upgrade arguments the model must not select.
 * `auth status` stays allowed.
 * @param args - model-supplied arguments.
 * @returns the error text, or `undefined` when the command may run.
 */
export function larkBlockedReason(args: readonly string[]): string | undefined {
  const secret = secretFlagReason(args)
  if (secret !== undefined) return secret
  if (args.some(arg => arg === '--profile' || arg.startsWith('--profile='))) {
    return 'This integration selects the Lark CLI profile. Remove --profile from the command.'
  }
  const words = positionalArgs(args)
  const first = words[0]
  const second = words[1]
  if ((first === 'auth' && second === 'login') || first === 'login') return 'Use im_cli_auth for Lark login.'
  if (words.includes('upgrade')) return 'This integration blocks Lark CLI upgrade. Remove upgrade from the command.'
  return undefined
}

function snapshot(config: Config): LarkSnapshot {
  const brand = config.larkBrand.get()
  const appId = config.larkAppId.get().trim()
  const appSecretEnv = config.larkAppSecretEnv.get().trim() || 'LARK_APP_SECRET'
  const cwd = channelConfigDir('lark')
  return {
    enabled: config.cliEnabled.get() && config.larkCliEnabled.get(),
    appId,
    appSecretEnv,
    brand,
    profile: larkProfileName(brand, appId),
    spawn: {
      timeoutMs: config.cliTimeoutMs.get(),
      maxOutputBytes: config.cliMaxOutputBytes.get(),
      graceMs: config.cliGraceMs.get(),
      cwd: resolveDshHome(),
      enforceTimeout: true,
      env: spawnEnv({
        LARKSUITE_CLI_CONFIG_DIR: cwd,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      }),
    },
  }
}

function parseProfiles(stdout: string): LarkProfile[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    void error
    throw new Error('cli-profile-unreadable')
  }
  if (!Array.isArray(parsed)) throw new Error('cli-profile-unreadable')
  return parsed.map((row) => {
    if (typeof row !== 'object' || row === null) throw new Error('cli-profile-unreadable')
    if (!('name' in row) || !('appId' in row) || !('brand' in row)) throw new Error('cli-profile-unreadable')
    const { name, appId, brand } = row
    if (typeof name !== 'string' || typeof appId !== 'string' || typeof brand !== 'string') {
      throw new Error('cli-profile-unreadable')
    }
    return { name, appId, brand }
  })
}

async function spawnLark(
  ctx: Context,
  current: LarkSnapshot,
  args: readonly string[],
  signal: AbortSignal,
  stdin?: string,
): Promise<CliProcessResult> {
  return spawnChannelCli(ctx, 'lark', ['--profile', current.profile, ...args], signal, current.spawn, stdin)
}

async function readProfiles(ctx: Context, current: LarkSnapshot, signal: AbortSignal): Promise<LarkProfile[]> {
  const listed = await spawnLark(ctx, current, ['profile', 'list'], signal)
  if (listed.exitCode !== 0 || listed.timedOut) throw new Error('cli-profile-unreadable')
  return parseProfiles(listed.stdout)
}

function assertOwnedIdentity(profile: LarkProfile, current: LarkSnapshot): void {
  if (profile.appId !== current.appId || profile.brand !== current.brand) throw new Error('cli-profile-mismatch')
}

/** Move a legacy profile whose name is the app id onto this bundle's profile name. */
async function adoptLegacyProfile(ctx: Context, current: LarkSnapshot, signal: AbortSignal): Promise<void> {
  const profiles = await readProfiles(ctx, current, signal)
  const owned = profiles.find(profile => profile.name === current.profile)
  if (owned !== undefined) {
    assertOwnedIdentity(owned, current)
    return
  }
  const legacy = profiles.find(profile => profile.name === current.appId
    && profile.appId === current.appId && profile.brand === current.brand)
  if (legacy === undefined) return
  const renamed = await spawnLark(ctx, current, ['profile', 'rename', legacy.name, current.profile], signal)
  if (renamed.exitCode !== 0 || renamed.timedOut) throw new Error('cli-profile-rename-failed')
  const adopted = (await readProfiles(ctx, current, signal)).find(profile => profile.name === current.profile)
  if (adopted === undefined) throw new Error('cli-profile-adoption-failed')
  assertOwnedIdentity(adopted, current)
}

async function prepareIdentity(ctx: Context, current: LarkSnapshot, signal: AbortSignal): Promise<void> {
  if (!current.enabled) throw new Error('Enable the Lark CLI tool in Settings before using it.')
  if (current.appId === '') throw new Error('Set the Lark application ID in Settings before using the CLI.')
  signal.throwIfAborted()
  const secret = await ctx.credentials.resolve(credentialRef(current.appSecretEnv))
  if (secret === undefined) throw new Error('Configure the Lark application secret before using the CLI.')
  await ensurePrivateDir(channelConfigDir('lark'))
  await adoptLegacyProfile(ctx, current, signal)
  const initialized = await spawnLark(
    ctx,
    current,
    ['config', 'init', '--name', current.profile, '--app-id', current.appId, '--app-secret-stdin', '--brand', current.brand],
    signal,
    secret.value,
  )
  if (initialized.exitCode !== 0 || initialized.timedOut) throw new Error('Lark CLI configuration failed')
}

/**
 * Run one `lark-cli` command for the configured application.
 * @param ctx - host services.
 * @param config - live IM configuration.
 * @param args - arguments after `lark-cli`.
 * @param signal - caller cancellation.
 * @returns the process result.
 */
export function executeLarkCli(
  ctx: Context,
  config: Config,
  args: readonly string[],
  signal: AbortSignal,
): Promise<CliProcessResult> {
  const current = snapshot(config)
  return runSerial('lark', async () => {
    const blocked = larkBlockedReason(args)
    if (blocked !== undefined) throw new Error(blocked)
    await prepareIdentity(ctx, current, signal)
    return spawnLark(ctx, current, args, signal)
  })
}

/**
 * Start Lark device login after the same profile initialization as `lark_cli`.
 * The child is not given the process deadline, so the returned URL stays valid after this function returns.
 * @param ctx - host services.
 * @param config - live IM configuration.
 * @param signal - cancellation for this auth session, independent of the tool deadline.
 * @returns the live login process.
 */
export function executeLarkAuth(ctx: Context, config: Config, signal: AbortSignal): Promise<StartedCli> {
  const current = snapshot(config)
  const plan = larkAuthPlan(config)
  return runSerial('lark', async () => {
    await prepareIdentity(ctx, current, signal)
    return startChannelCli(ctx, 'lark', plan.command, signal, plan.spawn)
  })
}

/** Arguments and environment for `im_cli_auth` on Lark. */
export interface LarkAuthPlan {
  /** Arguments after the integration-owned `--profile` flag. */
  readonly args: readonly string[]
  /** Profile flag plus the auth command. */
  readonly command: readonly string[]
  /** Spawn options, without a process deadline so the login URL can be relayed. */
  readonly spawn: CliSpawnOptions
}

/**
 * Build the non-blocking Lark device login.
 * The caller must already have initialized the profile.
 * @param config - live IM configuration.
 * @returns the auth command and spawn options.
 */
export function larkAuthPlan(config: Config): LarkAuthPlan {
  const current = snapshot(config)
  const args = ['auth', 'login', '--recommend', '--no-wait'] as const
  return {
    args,
    command: ['--profile', current.profile, ...args],
    spawn: { ...current.spawn, enforceTimeout: false },
  }
}
