/** Optional model-facing tool for the official Lark CLI. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { defineTool, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './host/lark/plugin.ts'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const CLI_RUNNER = fileURLToPath(new URL('../vendor/larksuite-cli/scripts/run.cjs', import.meta.url))
const CLI_VERSION = '1.0.90'
const CLI_PROFILE_PREFIX = 'dsh-'
const CLI_PROFILE_HASH_LENGTH = 32
/** Longest chain of official CLI processes one `lark_cli` call starts: the profile listing, an
 * optional legacy-profile rename with its confirming listing, the configuration initialization, and
 * the command itself. The tool budget must cover every one of them, because each carries the
 * configured process deadline and grace period. */
const CLI_PROCESSES_PER_CALL = 5

/** Name of the official CLI profile holding this bundle's user authorization records.
 *
 * `config init --name` updates that profile in place and keeps the records a replacing
 * `config init` deletes, so repeated calls share one authorization. The name carries a digest of
 * the application ID because one profile directory holds every configured application: a name per
 * product domain alone would let a second runtime configured with another application overwrite
 * the first one's identity. The digest keeps two applications of one product domain separate and
 * leaves the result well inside the official 64-character profile name limit. */
function cliProfile(brand: 'feishu' | 'lark', appId: string): string {
  return `${CLI_PROFILE_PREFIX}${brand}-${createHash('sha256').update(appId).digest('hex').slice(0, CLI_PROFILE_HASH_LENGTH)}`
}

interface CliRunOptions {
  readonly profile: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly graceMs: number
}

interface CliSettings extends CliRunOptions {
  readonly enabled: boolean
  readonly appId: string
  readonly appSecretEnv: string
  readonly brand: 'feishu' | 'lark'
}

/** Commands whose official CLI contract is read-only without external metadata. */
export function isLarkCliReadOnly(args: readonly string[]): boolean {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h' || args[0] === 'doctor' || args[0] === 'schema')) return true
  if (args[0] === 'im' && args[1] === '+chat-list') return isReadOnlyChatList(args.slice(2))
  if (args.length === 2 && (args[0] === 'auth' && ['list', 'scopes', 'status'].includes(args[1] ?? '')
    || args[0] === 'skills' && args[1] === 'list')) return true
  if (args.length === 3 && args[0] === 'auth' && args[1] === 'status' && args[2] === '--json') return true
  return args.length === 3 && args[0] === 'skills' && args[1] === 'read'
}

function isReadOnlyChatList(args: readonly string[]): boolean {
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--json') {
      if (seen.has(flag)) return false
      seen.add(flag)
      continue
    }
    if (flag !== '--types' && flag !== '--sort' && flag !== '--page-size' && flag !== '--format') return false
    const value = args[++index]
    if (value === undefined || value.startsWith('--') || seen.has(flag)) return false
    if (flag === '--types' && !['p2p', 'group', 'p2p,group', 'group,p2p'].includes(value)) return false
    if (flag === '--sort' && value !== 'active_time' && value !== 'create_time') return false
    if (flag === '--page-size' && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100)) return false
    if (flag === '--format' && value !== 'json') return false
    seen.add(flag)
  }
  return true
}

function result(handle: SubprocessHandle, timedOut: () => boolean) {
  return handle.done.then(outcome => ({
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: timedOut(),
    stdout: handle.collected.stdout?.readFrom(0).text ?? '',
    stderr: handle.collected.stderr?.readFrom(0).text ?? '',
  }))
}

function spawnCli(
  ctx: Context,
  args: readonly string[],
  signal: AbortSignal,
  options: CliRunOptions,
  stdin?: string,
): Promise<Awaited<ReturnType<typeof result>>> {
  const deadline = AbortSignal.timeout(options.timeoutMs)
  const combinedSignal = AbortSignal.any([signal, deadline])
  const handle = ctx.subprocess.spawn({
    // The profile flag is set by the integration, never by the model, so every call runs against
    // the application whose authorization this profile holds.
    argv: [process.execPath, CLI_RUNNER, '--profile', options.profile, ...args],
    cwd: resolveDshHome(),
    stdio: {
      stdin: stdin === undefined ? 'ignore' : { data: stdin },
      stdout: { maxBytes: options.maxOutputBytes },
      stderr: { maxBytes: options.maxOutputBytes },
    },
    graceMs: options.graceMs,
    signal: combinedSignal,
    env: {
      LARKSUITE_CLI_BIN_DIR: `${resolveDshHome()}/lark-cli-bin/v${CLI_VERSION}`,
      LARKSUITE_CLI_CONFIG_DIR: `${resolveDshHome()}/lark-cli`,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
      // The CLI reads an application identity from these names as well as from the profile, and it
      // refuses to run when one is set without a matching secret. Clearing them keeps the
      // configured application the only identity this process can select.
      LARKSUITE_CLI_APP_ID: undefined,
      LARKSUITE_CLI_APP_SECRET: undefined,
      LARKSUITE_CLI_BRAND: undefined,
      LARKSUITE_CLI_PROFILE: undefined,
      ...(process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
    },
  })
  return result(handle, () => deadline.aborted && !signal.aborted)
}

function settings(config: Config): CliSettings {
  const brand = config.brand.get()
  const appId = config.appId.get().trim()
  return {
    enabled: config.cliEnabled.get(), appId,
    appSecretEnv: config.appSecretEnv.get().trim(), brand, profile: cliProfile(brand, appId),
    timeoutMs: config.cliTimeoutMs.get(), maxOutputBytes: config.cliMaxOutputBytes.get(),
    graceMs: config.cliGraceMs.get(),
  }
}

/** Arguments that register or refresh this bundle's named CLI profile. */
function configInitArgs(snapshot: CliSettings): readonly string[] {
  return ['config', 'init', '--name', snapshot.profile, '--app-id', snapshot.appId,
    '--app-secret-stdin', '--brand', snapshot.brand]
}

interface CliProfile {
  readonly name: string
  readonly appId: string
  readonly brand: string
}

/** Read the official CLI profile listing.
 * @throws `cli-profile-unreadable` when the CLI reports a configuration it cannot parse, or when
 * its listing is not the documented array of named profiles. */
function parseProfiles(stdout: string): CliProfile[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error('cli-profile-unreadable')
  }
  if (!Array.isArray(parsed)) throw new Error('cli-profile-unreadable')
  return parsed.map((row) => {
    if (typeof row !== 'object' || row === null) throw new Error('cli-profile-unreadable')
    const { name, appId, brand } = row as Record<string, unknown>
    if (typeof name !== 'string' || typeof appId !== 'string' || typeof brand !== 'string') {
      throw new Error('cli-profile-unreadable')
    }
    return { name, appId, brand }
  })
}

async function readProfiles(
  ctx: Context, snapshot: CliSettings, signal: AbortSignal,
): Promise<CliProfile[]> {
  const listed = await spawnCli(ctx, ['profile', 'list'], signal, snapshot)
  if (listed.exitCode !== 0 || listed.timedOut) throw new Error('cli-profile-unreadable')
  return parseProfiles(listed.stdout)
}

/** Read the profile this bundle owns, or report which recorded identity holds its name.
 * @throws `cli-profile-mismatch` when another application identity already owns the name, because
 * running that profile would answer with another application's configuration. */
function assertOwnedIdentity(profile: CliProfile, snapshot: CliSettings): void {
  if (profile.appId !== snapshot.appId || profile.brand !== snapshot.brand) throw new Error('cli-profile-mismatch')
}

/** Bind the application identity to this bundle's profile before the first `config init`.
 *
 * A configuration written before this bundle used named profiles holds one unnamed profile whose
 * name is its application ID. Creating the named profile leaves that profile in place, so the user
 * authorization record it holds would stop being the one commands read. Renaming that profile onto
 * this name moves the record onto the profile this bundle selects. Only an identical application ID
 * and brand qualifies, so an authorization belonging to another identity is never reused. */
async function adoptLegacyProfile(
  ctx: Context, snapshot: CliSettings, signal: AbortSignal,
): Promise<void> {
  const profiles = await readProfiles(ctx, snapshot, signal)
  const owned = profiles.find(profile => profile.name === snapshot.profile)
  if (owned !== undefined) {
    assertOwnedIdentity(owned, snapshot)
    return
  }
  const legacy = profiles.find(profile => profile.name === snapshot.appId
    && profile.appId === snapshot.appId && profile.brand === snapshot.brand)
  if (legacy === undefined) return
  const renamed = await spawnCli(ctx, ['profile', 'rename', legacy.name, snapshot.profile], signal, snapshot)
  if (renamed.exitCode !== 0 || renamed.timedOut) throw new Error('cli-profile-rename-failed')
  // The official rename reports success for a source it cannot resolve, so confirm the profile now
  // records this identity before a command reads it as the configured application.
  const adopted = (await readProfiles(ctx, snapshot, signal)).find(profile => profile.name === snapshot.profile)
  if (adopted === undefined) throw new Error('cli-profile-adoption-failed')
  assertOwnedIdentity(adopted, snapshot)
}

let cliTail = Promise.resolve()

function runSerial<T>(operation: () => Promise<T>): Promise<T> {
  const previous = cliTail
  let release!: () => void
  cliTail = new Promise<void>((resolve) => { release = resolve })
  return previous.then(operation).finally(release)
}

async function execute(
  ctx: Context, snapshot: CliSettings, args: readonly string[], signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof result>>> {
  if (!snapshot.enabled) throw new Error('Enable the Lark CLI tool in Settings before using it.')
  if (snapshot.appId === '') throw new Error('Set the Lark application ID in Settings before using the CLI.')
  // This integration sets the profile before the model's arguments, where a `--` separator cannot
  // move it behind the model's own values, and rejects any `--profile` the model supplies because a
  // later flag selects the last one. Rewriting arguments instead would corrupt an argument that
  // merely carries this text as its value.
  if (args.some(arg => arg === '--profile' || arg.startsWith('--profile='))) {
    throw new Error('This integration selects the Lark CLI profile. Remove --profile from the command.')
  }
  signal.throwIfAborted()
  const secret = await ctx.credentials.resolve(credentialRef(snapshot.appSecretEnv))
  if (secret === undefined) throw new Error('Configure the Lark application secret before using the CLI.')

  const initialized = await adoptAndInit(ctx, snapshot, signal, secret.value)
  if (initialized.exitCode !== 0) {
    throw new Error('Lark CLI configuration failed')
  }

  return spawnCli(ctx, args, signal, snapshot)
}

/** Adopt the user authorization record an older configuration still holds for this identity, then
 * refresh the application identity and secret in this bundle's profile.
 * @returns the initialization process outcome so the caller reports its own failure wording.
 */
async function adoptAndInit(
  ctx: Context, snapshot: CliSettings, signal: AbortSignal, secret: string,
): Promise<Awaited<ReturnType<typeof result>>> {
  await adoptLegacyProfile(ctx, snapshot, signal)
  return spawnCli(ctx, configInitArgs(snapshot), signal, snapshot, secret)
}

/** Run several official CLI commands without interleaving their shared config initialization.
 * @param ctx - Host services used for credential resolution and subprocess execution.
 * @param config - live Lark configuration, snapshotted before entering the queue.
 * @param commands - ordered argument arrays executed under one initialized app identity.
 * @returns each command's bounded output in order.
 */
export function runLarkCliCommands(
  ctx: Context,
  config: Config,
  commands: readonly (readonly string[])[],
  signal: AbortSignal = new AbortController().signal,
  expected?: { readonly appId: string; readonly brand: 'feishu' | 'lark'; readonly appSecretEnv: string },
): Promise<Awaited<ReturnType<typeof result>>[]> {
  const snapshot = settings(config)
  return runSerial(async () => {
    signal.throwIfAborted()
    const current = settings(config)
    if (expected !== undefined && (current.appId !== expected.appId || current.brand !== expected.brand
      || current.appSecretEnv !== expected.appSecretEnv)) throw new Error('application-changed')
    if (snapshot.appId === '') throw new Error('application-unconfigured')
    const secret = await ctx.credentials.resolve(credentialRef(snapshot.appSecretEnv))
    if (secret === undefined) throw new Error('credential-unconfigured')
    const initialized = await adoptAndInit(ctx, snapshot, signal, secret.value)
    if (initialized.exitCode !== 0 || initialized.timedOut) throw new Error('cli-config-failed')
    const results: Awaited<ReturnType<typeof result>>[] = []
    for (const args of commands) {
      signal.throwIfAborted()
      const command = await spawnCli(ctx, args, signal, snapshot)
      results.push(command)
      if (command.exitCode !== 0 || command.timedOut) break
    }
    return results
  })
}

/** Register the tool only while its volatile Settings switch is enabled. */
export function applyLarkCli(ctx: Context, config: Config): void {
  ctx.effect(() => {
    let disposeTool: (() => void) | undefined
    let registeredTimeout: number | undefined
    const sync = (): void => {
      if (config.cliEnabled.get()) {
        const timeoutMs = CLI_PROCESSES_PER_CALL * (config.cliTimeoutMs.get() + config.cliGraceMs.get()) + 5_000
        if (disposeTool !== undefined && registeredTimeout === timeoutMs) return
        disposeTool?.()
        disposeTool = ctx.tools.register(defineTool({
          name: 'lark_cli',
          description: 'Run the official Lark/Feishu CLI using the configured application. Use ["auth", "status"] to check this bundle’s CLI configuration. A rejected approval means the requested operation did not run; it does not indicate whether Lark is configured. Read-only status and query commands run directly; all other commands require user approval.',
          parameters: {
            arguments: {
              type: 'array',
              required: true,
              description: 'Arguments after lark-cli, for example ["calendar", "+agenda", "--json"]. Use ["auth", "status"] to inspect configuration; do not infer configuration state from a rejected approval.',
              items: { type: 'string' },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                exitCode: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
                signal: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                timedOut: { type: 'boolean', required: true },
                stdout: { type: 'string', required: true },
                stderr: { type: 'string', required: true },
              },
            },
            render: (_args, value) => [{
              type: 'text',
              text: [value.stdout, value.stderr, value.timedOut ? '[timed out]' : ''].filter(Boolean).join('\n'),
            }],
          },
          timeoutMs,
          execute: (toolArgs, exec) => {
            const snapshot = settings(config)
            return runSerial(() => execute(ctx, snapshot, toolArgs.arguments, exec.signal))
          },
          presentCall: toolArgs => ({
            card: 'terminal',
            title: `lark-cli ${toolArgs.arguments.join(' ')}`,
            description: 'Official Lark/Feishu CLI',
          }),
        }))
        registeredTimeout = timeoutMs
      } else if (!config.cliEnabled.get() && disposeTool !== undefined) {
        disposeTool()
        disposeTool = undefined
        registeredTimeout = undefined
      }
    }
    const stopVolatile = ctx.on('loader/volatile-update', sync)
    const stopApproval = ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
      if (exec.name !== 'lark_cli') return next()
      const args = (exec.arguments as { arguments?: unknown } | undefined)?.arguments
      if (Array.isArray(args) && args.every(value => typeof value === 'string') && isLarkCliReadOnly(args)) return next()
      return { kind: 'ask', reason: 'This Lark CLI operation may change Lark or Feishu data.' }
    })
    sync()
    return () => {
      stopVolatile()
      stopApproval()
      disposeTool?.()
    }
  }, 'dsh-lark-integration: CLI tool')
}
