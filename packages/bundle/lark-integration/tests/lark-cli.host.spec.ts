import { Context } from '@deepseek-ai/cordis'
import { createVolatile } from '@deepseek-ai/cosmokit'
import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { Config } from '../src/index.ts'
import { applyLarkCli, isLarkCliReadOnly } from '../src/lark-cli.ts'

describe('Lark CLI policy and configuration', () => {
  it('allows only known read-only IM chat-list options without approval', () => {
    expect(isLarkCliReadOnly(['im', '+chat-list'])).toBe(true)
    expect(isLarkCliReadOnly([
      'im', '+chat-list', '--types', 'p2p', '--sort', 'active_time', '--page-size', '5', '--format', 'json',
    ])).toBe(true)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--json'])).toBe(true)
    expect(isLarkCliReadOnly(['im', '+chat-delete'])).toBe(false)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--all'])).toBe(false)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--types', 'p2p', '--verify'])).toBe(false)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--sort', 'unknown'])).toBe(false)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--page-size', '101'])).toBe(false)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--types', 'p2p', '--types', 'group'])).toBe(false)
  })

  it('allows structured auth status output but keeps token verification approval-gated', () => {
    expect(isLarkCliReadOnly(['auth', 'status', '--json'])).toBe(true)
    expect(isLarkCliReadOnly(['auth', 'status', '--verify'])).toBe(false)
  })

  it('recognizes help only in command positions and never after the option separator', () => {
    expect(isLarkCliReadOnly(['--help'])).toBe(true)
    expect(isLarkCliReadOnly(['calendar', '--help'])).toBe(false)
    expect(isLarkCliReadOnly(['calendar', '+event', '--help'])).toBe(false)
    expect(isLarkCliReadOnly(['calendar', '--', '--help'])).toBe(false)
    expect(isLarkCliReadOnly(['calendar', '+event', '--', '-h'])).toBe(false)
    expect(isLarkCliReadOnly(['calendar', '+event'])).toBe(false)
  })

  interface RegisteredTool {
    timeoutMs: number
    execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
  }

  interface SpawnRow {
    argv: string[]
    stdin?: string
    env: Record<string, string | undefined>
    stdoutLimit: number
    stderrLimit: number
    graceMs: number
  }

  interface CliProfile {
    name: string
    appId: string
    brand: string
  }

  /** Mirror the profile name the bundle derives, so the tests state the binding rather than a digest. */
  function profileFor(brand: 'feishu' | 'lark', appId: string): string {
    return `dsh-${brand}-${createHash('sha256').update(appId).digest('hex').slice(0, 32)}`
  }

  /** Mount the tool against a recording subprocess service.
   *
   * `gate` holds the first config init open. `profiles` seeds the CLI configuration the stub
   * reports from `profile list`, `listOutput` replaces that listing verbatim to reproduce a
   * configuration the CLI could not read, and `renameReportsSuccessWithoutRenaming` reproduces the
   * official CLI reporting success for a source it cannot resolve.
   *
   * The stub answers only the profile commands this bundle drives; the official CLI's own
   * configuration semantics are proved against the real binary in `lark-cli-official.host.spec.ts`. */
  async function harness(options: {
    gate?: Promise<void>
    profiles?: CliProfile[]
    listOutput?: string
    renameReportsSuccessWithoutRenaming?: boolean
    renameFails?: boolean
    profileListFails?: boolean
  } = {}) {
    const { gate, listOutput, renameReportsSuccessWithoutRenaming, renameFails, profileListFails } = options
    const profiles = options.profiles ?? []
    let configInits = 0
    const ctx = new Context()
    const spawned: SpawnRow[] = []
    const cell = <T>(value: T) => createVolatile(value)
    const config = {
      cliEnabled: cell(true), appId: cell('app-one'), appSecretEnv: cell('SECRET_ONE'),
      brand: cell<'feishu' | 'lark'>('feishu'),
      cliTimeoutMs: cell(1_000), cliMaxOutputBytes: cell(4_096), cliGraceMs: cell(250),
    } as Config
    let registered: RegisteredTool | undefined
    let registrations = 0
    ctx.provide('tools', {
      register: vi.fn((definition: RegisteredTool) => {
        registered = definition
        registrations++
        return vi.fn()
      }),
    } as never)
    ctx.provide('credentials', { resolve: async (ref: string) => ({ value: `secret:${ref}` }) } as never)
    ctx.provide('subprocess', {
      spawn(spec: {
        argv: string[]
        graceMs: number
        stdio: { stdin: { data: string } | 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
        env: Record<string, string | undefined>
      }) {
        const args = spec.argv.slice(2)
        const cliArgs = args[0] === '--profile' ? args.slice(2) : args
        const row: SpawnRow = {
          argv: spec.argv, env: spec.env, graceMs: spec.graceMs,
          stdoutLimit: spec.stdio.stdout.maxBytes, stderrLimit: spec.stdio.stderr.maxBytes,
          ...(typeof spec.stdio.stdin === 'object' ? { stdin: spec.stdio.stdin.data } : {}),
        }
        spawned.push(row)
        let stdout = ''
        let exitCode = 0
        if (cliArgs[0] === 'profile' && cliArgs[1] === 'list') {
          stdout = listOutput ?? JSON.stringify(profiles)
          if (profileListFails === true) exitCode = 2
        }
        else if (cliArgs[0] === 'profile' && cliArgs[1] === 'rename') {
          const source = profiles.find(profile => profile.name === cliArgs[2])
          if (renameFails === true) exitCode = 2
          else if (source === undefined) exitCode = renameReportsSuccessWithoutRenaming === true ? 0 : 2
          else if (renameReportsSuccessWithoutRenaming !== true) source.name = String(cliArgs[3])
        }
        const isConfigInit = cliArgs[0] === 'config' && cliArgs[1] === 'init'
        const done = gate !== undefined && isConfigInit && configInits === 0
          ? gate.then(() => { configInits++; return { exitCode, signal: null } })
          : Promise.resolve({ exitCode, signal: null })
        if (isConfigInit && gate === undefined) configInits++
        return {
          done,
          collected: {
            stdout: { readFrom: () => ({ text: stdout }) },
            stderr: { readFrom: () => ({ text: '' }) },
          },
        }
      },
    } as never)
    const fiber = ctx.plugin((pluginCtx) => { applyLarkCli(pluginCtx, config) })
    await fiber.await()
    return {
      ctx, config, spawned, profiles, registered: (): RegisteredTool => registered!,
      registrations: (): number => registrations,
      /** Apply a volatile change the way the Loader does after a settings save. */
      update: (field: 'cliTimeoutMs' | 'cliGraceMs' | 'cliEnabled', value: number | boolean) => {
        if (field === 'cliTimeoutMs') config.cliTimeoutMs = createVolatile(value as number)
        else if (field === 'cliGraceMs') config.cliGraceMs = createVolatile(value as number)
        else config.cliEnabled = createVolatile(value as boolean)
        ctx.emit('loader/volatile-update', [[field]])
      },
      run: (args: string[]) => registered!.execute({ arguments: args }, { signal: new AbortController().signal }),
    }
  }

  it('serializes shared CLI config initialization and command calls with per-call config snapshots', async () => {
    let releaseFirstInit!: () => void
    const firstInit = new Promise<void>((resolve) => { releaseFirstInit = resolve })
    const h = await harness({ gate: firstInit })
    const { config, spawned } = h
    const one = profileFor('feishu', 'app-one')
    const two = profileFor('feishu', 'app-two')
    try {
      expect(h.registered().timeoutMs).toBe(5 * (1_000 + 250) + 5_000)
      const execute = (args: string[]) => h.run(args)
      const first = execute(['auth', 'status'])
      await vi.waitFor(() => { expect(spawned).toHaveLength(2) })
      config.appId = createVolatile('app-two')
      config.appSecretEnv = createVolatile('SECRET_TWO')
      const second = execute(['calendar', 'list'])
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(spawned).toHaveLength(2)
      releaseFirstInit()
      await Promise.all([first, second])
      // Each application identity binds its own profile, and initializing that profile in place
      // keeps the user authorization records a replacing `config init` deletes.
      expect(spawned.map(row => row.argv.slice(2))).toEqual([
        ['--profile', one, 'profile', 'list'],
        ['--profile', one, 'config', 'init', '--name', one,
          '--app-id', 'app-one', '--app-secret-stdin', '--brand', 'feishu'],
        ['--profile', one, 'auth', 'status'],
        ['--profile', two, 'profile', 'list'],
        ['--profile', two, 'config', 'init', '--name', two,
          '--app-id', 'app-two', '--app-secret-stdin', '--brand', 'feishu'],
        ['--profile', two, 'calendar', 'list'],
      ])
      expect(spawned.filter(row => row.stdin !== undefined).map(row => row.stdin))
        .toEqual(['secret:SECRET_ONE', 'secret:SECRET_TWO'])
      expect(spawned[1]?.env).toMatchObject({ LARKSUITE_CLI_CONFIG_DIR: expect.stringContaining('lark-cli') as string })
      // An ambient application identity in the parent environment must not reach the CLI.
      expect(spawned[1]?.env).toMatchObject({
        LARKSUITE_CLI_APP_ID: undefined, LARKSUITE_CLI_APP_SECRET: undefined,
        LARKSUITE_CLI_BRAND: undefined, LARKSUITE_CLI_PROFILE: undefined,
      })
      expect(spawned.every(row => row.stdoutLimit === 4_096 && row.stderrLimit === 4_096 && row.graceMs === 250)).toBe(true)
    } finally {
      releaseFirstInit()
      await h.ctx.fiber.dispose()
    }
  })

  it('adopts an older unnamed profile that already holds this identity before initializing', async () => {
    const profile = profileFor('feishu', 'app-one')
    const h = await harness({ profiles: [{ name: 'app-one', appId: 'app-one', brand: 'feishu' }] })
    try {
      await h.run(['auth', 'status'])
      expect(h.spawned.map(row => row.argv.slice(2))).toEqual([
        ['--profile', profile, 'profile', 'list'],
        ['--profile', profile, 'profile', 'rename', 'app-one', profile],
        ['--profile', profile, 'profile', 'list'],
        ['--profile', profile, 'config', 'init', '--name', profile,
          '--app-id', 'app-one', '--app-secret-stdin', '--brand', 'feishu'],
        ['--profile', profile, 'auth', 'status'],
      ])
      // A second call finds the adopted profile and renames nothing.
      await h.run(['auth', 'status'])
      expect(h.spawned.slice(5).map(row => row.argv.slice(4, 6))).toEqual([
        ['profile', 'list'], ['config', 'init'], ['auth', 'status'],
      ])
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('keeps two applications of one product domain in separate profiles', async () => {
    const h = await harness()
    try {
      await h.run(['auth', 'status'])
      h.config.appId = createVolatile('app-two')
      await h.run(['auth', 'status'])
      h.config.appId = createVolatile('app-one')
      await h.run(['auth', 'status'])
      // Returning to the first application reuses its profile and its authorization records.
      expect(new Set(h.spawned.map(row => row.argv[3]))).toEqual(
        new Set([profileFor('feishu', 'app-one'), profileFor('feishu', 'app-two')]),
      )
      expect(h.spawned.map(row => row.argv.slice(4, 6)).map(pair => pair.join(' '))).toEqual([
        'profile list', 'config init', 'auth status',
        'profile list', 'config init', 'auth status',
        'profile list', 'config init', 'auth status',
      ])
      expect(h.spawned.filter(row => row.argv[8] === '--app-id').map(row => row.argv[9]))
        .toEqual(['app-one', 'app-two', 'app-one'])
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('fails when the profile name already records another application identity', async () => {
    for (const entry of [
      { name: profileFor('feishu', 'app-one'), appId: 'app-two', brand: 'feishu' },
      { name: profileFor('feishu', 'app-one'), appId: 'app-one', brand: 'lark' },
    ]) {
      const h = await harness({ profiles: [entry] })
      try {
        await expect(h.run(['auth', 'status'])).rejects.toThrow('cli-profile-mismatch')
        expect(h.spawned.some(row => row.argv.includes('init'))).toBe(false)
      } finally {
        await h.ctx.fiber.dispose()
      }
    }
  })

  it('fails when the adopted profile records another identity after the rename', async () => {
    const profile = profileFor('feishu', 'app-one')
    const h = await harness({
      profiles: [{ name: 'app-one', appId: 'app-one', brand: 'feishu' }],
      renameReportsSuccessWithoutRenaming: true,
    })
    try {
      // The official rename can report success without moving the profile; adopting a profile that
      // still records the previous identity must fail instead of initializing it.
      h.profiles.push({ name: profile, appId: 'app-two', brand: 'feishu' })
      await expect(h.run(['auth', 'status'])).rejects.toThrow('cli-profile-mismatch')
      expect(h.spawned.some(row => row.argv.includes('init'))).toBe(false)
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('leaves another identity’s authorization unadopted', async () => {
    for (const entry of [
      { name: 'app-two', appId: 'app-two', brand: 'feishu' },
      { name: 'app-one', appId: 'app-one', brand: 'lark' },
    ]) {
      const h = await harness({ profiles: [entry] })
      try {
        await h.run(['auth', 'status'])
        expect(h.spawned.some(row => row.argv.includes('rename'))).toBe(false)
        expect(h.profiles.map(profile => profile.name)).toEqual([entry.name])
      } finally {
        await h.ctx.fiber.dispose()
      }
    }
  })

  it('fails when the CLI reports a configuration it cannot parse', async () => {
    for (const listOutput of ['not json', '{"apps":{}}', '[{"appId":"app-one"}]', 'null', '[null]', '[7]']) {
      const h = await harness({ listOutput })
      try {
        await expect(h.run(['auth', 'status'])).rejects.toThrow('cli-profile-unreadable')
        // No application identity is initialized while the existing configuration stays unreadable.
        expect(h.spawned.some(row => row.argv.includes('init'))).toBe(false)
      } finally {
        await h.ctx.fiber.dispose()
      }
    }
  })

  it('fails when the profile listing cannot be read', async () => {
    const h = await harness({ profileListFails: true })
    try {
      await expect(h.run(['auth', 'status'])).rejects.toThrow('cli-profile-unreadable')
      expect(h.spawned.some(row => row.argv.includes('init'))).toBe(false)
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('fails when adopting the older profile does not produce it', async () => {
    const h = await harness({
      profiles: [{ name: 'app-one', appId: 'app-one', brand: 'feishu' }],
      renameReportsSuccessWithoutRenaming: true,
    })
    try {
      await expect(h.run(['auth', 'status'])).rejects.toThrow('cli-profile-adoption-failed')
      expect(h.spawned.some(row => row.argv.includes('init'))).toBe(false)
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('fails when the older profile cannot be renamed', async () => {
    const h = await harness({
      profiles: [{ name: 'app-one', appId: 'app-one', brand: 'feishu' }],
      renameFails: true,
    })
    try {
      await expect(h.run(['auth', 'status'])).rejects.toThrow('cli-profile-rename-failed')
      expect(h.spawned.some(row => row.argv.includes('init'))).toBe(false)
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('re-registers the tool when the budget that must cover every CLI process changes', async () => {
    const h = await harness()
    try {
      // Five processes at most: listing, an optional rename and its confirming listing,
      // initialization, and the command.
      expect(h.registered().timeoutMs).toBe(5 * (1_000 + 250) + 5_000)
      expect(h.registrations()).toBe(1)

      h.update('cliTimeoutMs', 2_000)
      expect(h.registered().timeoutMs).toBe(5 * (2_000 + 250) + 5_000)
      expect(h.registrations()).toBe(2)

      h.update('cliGraceMs', 500)
      expect(h.registered().timeoutMs).toBe(5 * (2_000 + 500) + 5_000)
      expect(h.registrations()).toBe(3)

      // A volatile change that leaves the budget identical must not rebuild the tool.
      h.update('cliTimeoutMs', 2_000)
      expect(h.registrations()).toBe(3)

      // Disabling removes the tool; enabling registers it again with the current budget.
      h.update('cliEnabled', false)
      expect(h.registrations()).toBe(3)
      h.update('cliEnabled', true)
      expect(h.registrations()).toBe(4)
      expect(h.registered().timeoutMs).toBe(5 * (2_000 + 500) + 5_000)
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('gives each product domain its own profile so a brand change cannot reuse the other authorization', async () => {
    const h = await harness()
    try {
      await h.run(['auth', 'status'])
      h.config.brand = createVolatile<'feishu' | 'lark'>('lark')
      await h.run(['auth', 'status'])
      expect(h.spawned.map(row => row.argv.slice(4, 6))).toEqual([
        ['profile', 'list'], ['config', 'init'], ['auth', 'status'],
        ['profile', 'list'], ['config', 'init'], ['auth', 'status'],
      ])
      expect(new Set(h.spawned.map(row => row.argv[3]))).toEqual(
        new Set([profileFor('feishu', 'app-one'), profileFor('lark', 'app-one')]),
      )
      expect(h.spawned.filter(row => row.argv[6] === '--name').map(row => row.argv[7]))
        .toEqual([profileFor('feishu', 'app-one'), profileFor('lark', 'app-one')])
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('refuses a command that selects its own CLI profile before running anything', async () => {
    const h = await harness()
    try {
      for (const args of [
        ['auth', 'status', '--profile', 'other'],
        ['auth', 'status', '--profile=other'],
        // An option separator does not exempt the flag, because this integration rejects the
        // argument rather than reordering it.
        ['auth', 'status', '--', '--profile', 'other'],
        ['auth', 'status', '--', '--profile=other'],
      ]) {
        await expect(h.run(args)).rejects.toThrow(/Remove --profile/)
      }
      expect(h.spawned).toHaveLength(0)
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('never lets the model arguments move the profile this integration set', async () => {
    const h = await harness()
    try {
      await h.run(['auth', 'status', '--'])
      expect(h.spawned.every(row => row.argv[2] === '--profile' && row.argv[3] === profileFor('feishu', 'app-one')))
        .toBe(true)
    } finally {
      await h.ctx.fiber.dispose()
    }
  })
})
