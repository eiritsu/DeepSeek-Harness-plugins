import { Context } from '@deepseek-ai/cordis'
import { createVolatile } from '@deepseek-ai/cosmokit'
import { createHash } from 'node:crypto'
import { execFile, spawn as spawnProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config } from '../src/index.ts'
import { applyLarkCli } from '../src/lark-cli.ts'

const CLI_VERSION = '1.0.90'
const realBinaryDirectory = join(homedir(), '.dsh', 'lark-cli-bin', `v${CLI_VERSION}`)
const realBinary = join(realBinaryDirectory, process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli')
/** The launcher downloads this binary on first use, so a host without it skips the suite. */
const officialCliPresent = existsSync(realBinary)

function profileFor(brand: 'feishu' | 'lark', appId: string): string {
  return `dsh-${brand}-${createHash('sha256').update(appId).digest('hex').slice(0, 32)}`
}

interface StoredApp {
  name?: string
  appId: string
  brand: string
  users: { userOpenId: string; userName: string }[]
}

/** Run one official CLI process against a given configuration directory.
 *
 * The dead proxy keeps the CLI's own profile and configuration behavior and stops it from
 * contacting Lark, so the case needs no network and no real application credentials. */
function runOfficialCli(args: readonly string[], configDirectory: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(realBinary, [...args], {
      // HOME resolves the shared master key and the per-application secret files; a child without
      // it silently writes nothing and removes nothing.
      env: {
        ...process.env,
        LARKSUITE_CLI_CONFIG_DIR: configDirectory,
        LARKSUITE_CLI_BIN_DIR: realBinaryDirectory,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
        LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
        HTTPS_PROXY: 'http://127.0.0.1:9',
        HTTP_PROXY: 'http://127.0.0.1:9',
      },
      timeout: 30_000,
    }, (error) => {
      if (error === null) resolve()
      else reject(new Error(`official CLI ${args.join(' ')} failed: ${error.message}`, { cause: error }))
    })
  })
}

describe.skipIf(!officialCliPresent)('official Lark CLI configuration identity', () => {
  let dshHome = ''
  let configDirectory = ''
  const originalHome = process.env.DSH_HOME
  /** Every child this suite starts, so teardown can wait for exit before deleting its files. */
  const running = new Map<import('node:child_process').ChildProcess, Promise<unknown>>()

  beforeEach(() => {
    dshHome = mkdtempSync(join(tmpdir(), 'dsh-lark-official-'))
    configDirectory = join(dshHome, 'lark-cli')
    mkdirSync(configDirectory, { recursive: true })
    process.env.DSH_HOME = dshHome
  })

  afterEach(async () => {
    try {
      // 1. No child may still hold the configuration directory.
      const children = [...running.entries()]
      for (const [child] of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }
      await Promise.all(children.map(([, done]) => done.catch(() => undefined)))
      running.clear()
      // 2. Release this case's own application secrets. The official CLI keeps each secret beside
      //    the shared master key, outside the configuration directory, so deleting that directory
      //    alone would leave them behind. The listing names only applications this suite wrote.
      //    A failed removal must surface: it means this case leaked a file into the user's home.
      const owned = existsSync(join(configDirectory, 'config.json'))
        ? storedApps().map(app => app.name ?? app.appId)
        : []
      if (owned.length > 0) await runOfficialCli(['config', 'remove', owned[0]!], configDirectory)
    } finally {
      // 3. Restore the process-global home before removing the files it pointed at.
      if (originalHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = originalHome
      rmSync(dshHome, { recursive: true, force: true })
    }
  })

  function storedApps(): StoredApp[] {
    return (JSON.parse(readFileSync(join(configDirectory, 'config.json'), 'utf8')) as { apps: StoredApp[] }).apps
  }

  /** Seed the configuration an older release wrote: one unnamed profile named after its app ID. */
  function seedLegacyProfile(appId: string, brand: 'feishu' | 'lark', users: StoredApp['users']): void {
    writeFileSync(join(configDirectory, 'config.json'), JSON.stringify({
      apps: [{ appId, brand, appSecret: 'synthetic-test-secret', users }],
    }, null, 2))
  }

  /** Mount the tool the way a Host does and run one local command.
   *
   * Only the network is replaced: the bundle's real arguments reach the real official binary. */
  async function runTool(appId: string, brand: 'feishu' | 'lark'): Promise<{ stdout: string }> {
    const ctx = new Context()
    const config = {
      cliEnabled: createVolatile(true), appId: createVolatile(appId),
      appSecretEnv: createVolatile('LARK_APP_SECRET'), brand: createVolatile<'feishu' | 'lark'>(brand),
      cliTimeoutMs: createVolatile(20_000), cliMaxOutputBytes: createVolatile(256 * 1024),
      cliGraceMs: createVolatile(2_000),
    } as Config
    let execute: ((args: unknown, exec: { signal: AbortSignal }) => Promise<unknown>) | undefined
    ctx.provide('tools', {
      register: (definition: { execute: (args: unknown, exec: { signal: AbortSignal }) => Promise<unknown> }) => {
        execute = definition.execute
        return () => {}
      },
    } as never)
    ctx.provide('credentials', { resolve: async () => ({ value: 'synthetic-test-secret' }) } as never)
    ctx.provide('subprocess', {
      spawn(spec: {
        argv: string[]
        cwd: string
        graceMs: number
        signal?: AbortSignal
        env: Record<string, string | undefined>
        stdio: { stdin: { data: string } | 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
      }) {
        const env = Object.fromEntries(Object.entries({
          ...process.env,
          ...spec.env,
          LARKSUITE_CLI_BIN_DIR: realBinaryDirectory,
          HTTPS_PROXY: 'http://127.0.0.1:9',
          HTTP_PROXY: 'http://127.0.0.1:9',
        }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        let stdout = ''
        let stderr = ''
        const child = spawnProcess(spec.argv[0]!, spec.argv.slice(1), { cwd: spec.cwd, env })
        child.stdout.on('data', (chunk) => { stdout += String(chunk) })
        child.stderr.on('data', (chunk) => { stderr += String(chunk) })
        if (typeof spec.stdio.stdin === 'object') child.stdin?.end(spec.stdio.stdin.data)
        else child.stdin?.end()
        const done = new Promise<{ exitCode: number; signal: string | null }>((resolve, reject) => {
          child.on('error', reject)
          child.on('close', (exitCode, signal) => { resolve({ exitCode: exitCode ?? -1, signal }) })
        })
        running.set(child, done)
        void done.catch(() => undefined).finally(() => { running.delete(child) })
        // Cancellation must reach the child, so a disposed call cannot leave one behind.
        const abort = (): void => {
          child.kill('SIGTERM')
          const forced = setTimeout(() => { child.kill('SIGKILL') }, spec.graceMs)
          forced.unref()
          child.on('close', () => { clearTimeout(forced) })
        }
        if (spec.signal?.aborted === true) abort()
        else spec.signal?.addEventListener('abort', abort, { once: true })
        return {
          done,
          collected: {
            stdout: { readFrom: () => ({ text: stdout.slice(0, spec.stdio.stdout.maxBytes) }) },
            stderr: { readFrom: () => ({ text: stderr.slice(0, spec.stdio.stderr.maxBytes) }) },
          },
        }
      },
    } as never)
    try {
      const fiber = ctx.plugin((pluginCtx) => { applyLarkCli(pluginCtx, config) })
      await fiber.await()
      // `config show` reports the effective profile without contacting Lark.
      return await execute!({ arguments: ['config', 'show'] }, { signal: new AbortController().signal }) as { stdout: string }
    } finally {
      await ctx.fiber.dispose()
    }
  }

  it('adopts an older unnamed profile and keeps its authorization record across a restart', async () => {
    const appId = `cli_dsh_official_adopt_${String(process.pid)}`
    seedLegacyProfile(appId, 'feishu', [{ userOpenId: 'ou_synthetic_one', userName: 'One' }])
    const profile = profileFor('feishu', appId)

    const first = await runTool(appId, 'feishu')
    expect(JSON.parse(first.stdout)).toMatchObject({ appId, brand: 'feishu' })
    expect(storedApps()).toHaveLength(1)
    expect(storedApps()[0]).toMatchObject({
      name: profile, appId, brand: 'feishu', users: [{ userOpenId: 'ou_synthetic_one', userName: 'One' }],
    })

    // A new Host process reads the same profile from disk, so the record survives a restart.
    await runTool(appId, 'feishu')
    expect(storedApps()).toHaveLength(1)
    expect(storedApps()[0]?.users).toEqual([{ userOpenId: 'ou_synthetic_one', userName: 'One' }])
  }, 60_000)

  it('keeps two applications of one product domain in separate profiles', async () => {
    const first = `cli_dsh_official_pair_a_${String(process.pid)}`
    const second = `cli_dsh_official_pair_b_${String(process.pid)}`
    seedLegacyProfile(first, 'feishu', [{ userOpenId: 'ou_synthetic_one', userName: 'One' }])
    await runTool(first, 'feishu')
    // A second Host configured with another application shares the profile directory.
    await runTool(second, 'feishu')

    const apps = storedApps()
    expect(apps.map(app => app.name).sort()).toEqual(
      [profileFor('feishu', first), profileFor('feishu', second)].sort(),
    )
    expect(apps.find(app => app.name === profileFor('feishu', first))?.users)
      .toEqual([{ userOpenId: 'ou_synthetic_one', userName: 'One' }])
    // The second application never inherits the first one's authorization record.
    expect(apps.find(app => app.name === profileFor('feishu', second))?.users).toEqual([])
  }, 60_000)

  it('does not reuse an authorization record after the application identity changes', async () => {
    const first = `cli_dsh_official_switch_a_${String(process.pid)}`
    const second = `cli_dsh_official_switch_b_${String(process.pid)}`
    seedLegacyProfile(first, 'feishu', [{ userOpenId: 'ou_synthetic_one', userName: 'One' }])
    await runTool(first, 'feishu')
    await runTool(second, 'feishu')

    const apps = storedApps()
    expect(apps.find(app => app.name === profileFor('feishu', second))?.users).toEqual([])
    expect(apps.find(app => app.name === profileFor('feishu', first))?.users)
      .toEqual([{ userOpenId: 'ou_synthetic_one', userName: 'One' }])
  }, 60_000)

  it('keeps one application separate across both product domains', async () => {
    const appId = `cli_dsh_official_brand_${String(process.pid)}`
    seedLegacyProfile(appId, 'feishu', [{ userOpenId: 'ou_synthetic_one', userName: 'One' }])

    await runTool(appId, 'feishu')
    const lark = await runTool(appId, 'lark')

    // The Lark profile answers with its own product domain, so the two never share an identity.
    expect(JSON.parse(lark.stdout)).toMatchObject({ appId, brand: 'lark' })
    const apps = storedApps()
    expect(apps.map(app => app.name).sort()).toEqual(
      [profileFor('feishu', appId), profileFor('lark', appId)].sort(),
    )
    expect(apps.find(app => app.name === profileFor('feishu', appId))?.users)
      .toEqual([{ userOpenId: 'ou_synthetic_one', userName: 'One' }])
    // A grant issued for one product domain is not carried into the other.
    expect(apps.find(app => app.name === profileFor('lark', appId))?.users).toEqual([])
  }, 60_000)
})
