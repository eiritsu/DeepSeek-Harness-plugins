/** Optional model-facing tool for the official Lark CLI. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { defineTool, type PreToolDecision } from '@deepseek-ai/dsh-tools'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './host/lark/plugin.ts'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { fileURLToPath } from 'node:url'

const CLI_RUNNER = fileURLToPath(new URL('../vendor/larksuite-cli/scripts/run.cjs', import.meta.url))
const CLI_VERSION = '1.0.90'

interface CliRunOptions {
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
  if (args.length === 2 && (args[0] === 'auth' && ['list', 'scopes', 'status'].includes(args[1] ?? '')
    || args[0] === 'skills' && args[1] === 'list')) return true
  return args.length === 3 && args[0] === 'skills' && args[1] === 'read'
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
    argv: [process.execPath, CLI_RUNNER, ...args],
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
      ...(process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
    },
  })
  return result(handle, () => deadline.aborted && !signal.aborted)
}

function settings(config: Config): CliSettings {
  return {
    enabled: config.cliEnabled.get(), appId: config.appId.get().trim(),
    appSecretEnv: config.appSecretEnv.get().trim(), brand: config.brand.get(),
    timeoutMs: config.cliTimeoutMs.get(), maxOutputBytes: config.cliMaxOutputBytes.get(),
    graceMs: config.cliGraceMs.get(),
  }
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
  signal.throwIfAborted()
  const secret = await ctx.credentials.resolve(credentialRef(snapshot.appSecretEnv))
  if (secret === undefined) throw new Error('Configure the Lark application secret before using the CLI.')

  const initialized = await spawnCli(ctx, [
    'config', 'init', '--app-id', snapshot.appId, '--app-secret-stdin', '--brand', snapshot.brand,
  ], signal, snapshot, secret.value)
  if (initialized.exitCode !== 0) {
    throw new Error('Lark CLI configuration failed')
  }

  return spawnCli(ctx, args, signal, snapshot)
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
    const initialized = await spawnCli(ctx, [
      'config', 'init', '--app-id', snapshot.appId, '--app-secret-stdin', '--brand', snapshot.brand,
    ], signal, snapshot, secret.value)
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
        const timeoutMs = 2 * (config.cliTimeoutMs.get() + config.cliGraceMs.get()) + 5_000
        if (disposeTool !== undefined && registeredTimeout === timeoutMs) return
        disposeTool?.()
        disposeTool = ctx.tools.register(defineTool({
          name: 'lark_cli',
          description: 'Run the official Lark/Feishu CLI using the configured application. Read-only status and query commands run directly; all other commands require user approval.',
          parameters: {
            arguments: {
              type: 'array',
              required: true,
              description: 'Arguments after lark-cli, for example ["calendar", "+agenda", "--json"].',
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
