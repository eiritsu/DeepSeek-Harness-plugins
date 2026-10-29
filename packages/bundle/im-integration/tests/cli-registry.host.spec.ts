import { Context } from '@deepseek-ai/cordis'
import { createVolatile } from '@deepseek-ai/cosmokit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/config.ts'
import { applyImCli } from '../src/channels/apply.ts'
import {
  bindAuthProcess,
  executeImCliAuth,
  parseAuthOutput,
  readUntil,
  replaceAuthSession,
} from '../src/channels/auth.ts'
import { executeDingtalkCli } from '../src/channels/dingtalk/cli.ts'
import * as cliInstall from '../src/channels/install.ts'
import { executeWecomCli, wecomQrPath } from '../src/channels/wecom/cli.ts'
import { activeCliChannels, cliToolName, larkPluginLoaded } from '../src/channels/registry.ts'

afterEach(() => { vi.restoreAllMocks() })

interface ToolDef {
  name: string
  timeoutMs?: number
  execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
  presentCall?(args: unknown): { title?: string } | undefined
  output: { render(args: unknown, value: unknown): { text: string }[] }
}

function configCells(overrides: {
  cliEnabled?: boolean
  larkCliEnabled?: boolean
  wecomCliEnabled?: boolean
  dingtalkCliEnabled?: boolean
  larkAppId?: string
  larkAppSecretEnv?: string
  larkBrand?: 'feishu' | 'lark'
  dingtalkClientId?: string
  dingtalkClientSecretEnv?: string
  cliTimeoutMs?: number
  cliMaxOutputBytes?: number
  cliGraceMs?: number
} = {}) {
  return {
    cliEnabled: createVolatile(overrides.cliEnabled ?? true),
    larkCliEnabled: createVolatile(overrides.larkCliEnabled ?? true),
    wecomCliEnabled: createVolatile(overrides.wecomCliEnabled ?? false),
    dingtalkCliEnabled: createVolatile(overrides.dingtalkCliEnabled ?? false),
    larkAppId: createVolatile(overrides.larkAppId ?? 'app-one'),
    larkAppSecretEnv: createVolatile(overrides.larkAppSecretEnv ?? 'LARK_APP_SECRET'),
    larkBrand: createVolatile(overrides.larkBrand ?? 'feishu'),
    dingtalkClientId: createVolatile(overrides.dingtalkClientId ?? ''),
    dingtalkClientSecretEnv: createVolatile(overrides.dingtalkClientSecretEnv ?? 'DINGTALK_CLIENT_SECRET'),
    cliTimeoutMs: createVolatile(overrides.cliTimeoutMs ?? 1_000),
    cliMaxOutputBytes: createVolatile(overrides.cliMaxOutputBytes ?? 4_096),
    cliGraceMs: createVolatile(overrides.cliGraceMs ?? 200),
  } as Config
}

function host(config: Config, options: { missingSecret?: boolean; loader?: unknown } = {}) {
  const ctx = new Context()
  const tools = new Map<string, ToolDef>()
  const spawned: { argv: string[]; env: Record<string, string | undefined>; stdin?: string }[] = []
  vi.spyOn(cliInstall, 'ensureChannelBinary').mockResolvedValue('/tmp/dsh-im-cli-bin')
  ctx.provide('tools', {
    register: (definition: ToolDef) => {
      tools.set(definition.name, definition)
      return () => { tools.delete(definition.name) }
    },
  } as never)
  ctx.provide('credentials', {
    resolve: async () => options.missingSecret === true ? undefined : { value: 'secret-value' },
  } as never)
  ctx.provide('subprocess', {
    spawn(spec: { argv: string[]; env: Record<string, string | undefined>; stdio: { stdin: { data: string } | 'ignore' } }) {
      const stdin = typeof spec.stdio.stdin === 'object' ? spec.stdio.stdin.data : undefined
      spawned.push({ argv: spec.argv, env: spec.env, ...(stdin === undefined ? {} : { stdin }) })
      const args = spec.argv.slice(2)
      const command = args[0] === '--profile' ? args.slice(2) : args
      let stdout = ''
      if (command[0] === 'profile' && command[1] === 'list') stdout = '[]'
      if (command[0] === 'auth' && command[1] === 'login') stdout = 'open https://example.test/device device code: ABC123 user code: XYZ'
      if (command[0] === 'auth' && command[1] === 'init') stdout = `qrcode written ${args[args.length - 1] ?? ''}`
      const pending = command[0] === 'auth' && (command[1] === 'login' || command[1] === 'init')
      let finish!: (value: { exitCode: number | null; signal: null }) => void
      const done = pending
        ? new Promise<{ exitCode: number | null; signal: null }>((resolve) => { finish = resolve })
        : Promise.resolve({ exitCode: 0, signal: null })
      return {
        done,
        terminate: () => { finish?.({ exitCode: null, signal: null }) },
        collected: {
          stdout: { readFrom: () => ({ text: stdout }) },
          stderr: { readFrom: () => ({ text: '' }) },
        },
      }
    },
  } as never)
  if (options.loader !== undefined) ctx.provide('loader', options.loader as never)
  return {
    ctx,
    tools,
    spawned,
    start: async () => {
      const fiber = ctx.plugin((pluginCtx) => { applyImCli(pluginCtx, config) })
      await fiber.await()
    },
  }
}

describe('IM CLI registry', () => {
  it('registers and drops each channel tool from the volatile switches', async () => {
    const config = configCells({ wecomCliEnabled: true, dingtalkCliEnabled: true, dingtalkClientId: 'ding-id' })
    const h = host(config)
    await h.start()
    try {
      expect([...h.tools.keys()].sort()).toEqual(['dingtalk_cli', 'im_cli_auth', 'lark_cli', 'wecom_cli'])
      expect(cliToolName('lark')).toBe('lark_cli')
      expect(cliToolName('wecom')).toBe('wecom_cli')
      expect(cliToolName('dingtalk')).toBe('dingtalk_cli')
      const lark = h.tools.get('lark_cli')!
      expect(lark.presentCall?.({ arguments: ['auth', 'status'] })?.title).toContain('lark-cli')
      const auth = h.tools.get('im_cli_auth')!
      expect(auth.presentCall?.({ channel: 'wecom' })?.title).toContain('im_cli_auth')
      expect(auth.output.render({}, {
        stdout: 'ok', stderr: '', timedOut: false, channel: 'wecom', url: '', deviceCode: '',
        userCode: '', qrCodePath: '', pending: true, exitCode: null, signal: null,
      }).map(block => block.text).join()).toContain('ok')

      config.wecomCliEnabled = createVolatile(false)
      h.ctx.emit('loader/volatile-update', [['wecomCliEnabled']])
      expect(h.tools.has('wecom_cli')).toBe(false)
      expect(h.tools.has('dingtalk_cli')).toBe(true)

      config.dingtalkClientId = createVolatile('  ')
      h.ctx.emit('loader/config-update')
      expect(h.tools.has('dingtalk_cli')).toBe(false)

      config.larkAppId = createVolatile('')
      h.ctx.emit('loader/volatile-update', [['larkAppId']])
      expect(h.tools.has('lark_cli')).toBe(false)
      expect(h.tools.has('im_cli_auth')).toBe(false)

      config.cliEnabled = createVolatile(false)
      config.larkAppId = createVolatile('app-one')
      h.ctx.emit('loader/volatile-update', [['cliEnabled']])
      expect(h.tools.size).toBe(0)
      h.ctx.emit('loader/volatile-update', [['cliEnabled']])
      expect(h.tools.size).toBe(0)
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('skips lark_cli when dsh-lark-integration is loaded and warns once', async () => {
    const config = configCells()
    const h = host(config, {
      loader: { entries: () => [{ disabled: false, options: { name: '@deepseek-ai/dsh-lark-integration' } }] },
    })
    const warn = vi.spyOn(h.ctx.logger, 'warn')
    await h.start()
    try {
      expect(h.tools.has('lark_cli')).toBe(false)
      expect(warn).toHaveBeenCalledTimes(1)
      h.ctx.emit('loader/volatile-update', [['larkCliEnabled']])
      expect(warn).toHaveBeenCalledTimes(1)
      config.cliEnabled = createVolatile(false)
      h.ctx.emit('loader/volatile-update', [['cliEnabled']])
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('reads loader entries only when they name an enabled lark integration', () => {
    const asContext = (value: unknown) => {
      const ctx = new Context()
      ctx.provide('loader', value as never)
      return ctx
    }
    expect(larkPluginLoaded(new Context())).toBe(false)
    expect(larkPluginLoaded(asContext(null))).toBe(false)
    expect(larkPluginLoaded(asContext(1))).toBe(false)
    expect(larkPluginLoaded(asContext({}))).toBe(false)
    expect(larkPluginLoaded(asContext({ entries: 1 }))).toBe(false)
    expect(larkPluginLoaded(asContext({
      entries: () => [null, 1, { disabled: true, options: { name: '@deepseek-ai/dsh-lark-integration' } }],
    }))).toBe(false)
    expect(larkPluginLoaded(asContext({
      entries: () => [{ options: null }, { options: { name: 7 } }, { options: {} }, { disabled: false, options: { name: 'other' } }],
    }))).toBe(false)
    expect(larkPluginLoaded(asContext({
      entries: () => [{ options: { name: 'packages/bundle/lark-integration' } }],
    }))).toBe(true)
    expect(activeCliChannels(configCells({ cliEnabled: false }), false)).toEqual([])
    expect(activeCliChannels(configCells({ larkCliEnabled: false, larkAppId: '' }), false)).toEqual([])
  })

  it('keeps DingTalk and WeCom secrets out of argv and blocks auth arguments', async () => {
    const config = configCells({ wecomCliEnabled: true, dingtalkCliEnabled: true, dingtalkClientId: 'ding-id' })
    const h = host(config)
    await h.start()
    try {
      const signal = new AbortController().signal
      await h.tools.get('wecom_cli')!.execute({ arguments: ['auth', 'show'] }, { signal })
      await h.tools.get('dingtalk_cli')!.execute({ arguments: ['auth', 'status'] }, { signal })
      const ding = h.spawned.find(row => row.argv.some(arg => arg.includes('dingtalk')))
      expect(ding?.env.DWS_CLIENT_SECRET).toBe('secret-value')
      expect(ding?.env.DWS_CLIENT_ID).toBe('ding-id')
      expect(ding?.env.DWS_DISABLE_KEYCHAIN).toBe('1')
      expect(ding?.argv.join(' ')).not.toContain('secret-value')
      expect(h.spawned.find(row => row.argv.some(arg => arg.includes('wecom')))?.env.WECOM_CLI_ACCESS_TOKEN).toBeUndefined()

      await expect(h.tools.get('wecom_cli')!.execute({ arguments: ['auth', 'init'] }, { signal })).rejects.toThrow(/im_cli_auth/)
      await expect(h.tools.get('wecom_cli')!.execute({ arguments: ['--output-qrcode', 'x'] }, { signal })).rejects.toThrow(/im_cli_auth/)
      await expect(h.tools.get('wecom_cli')!.execute({ arguments: ['--manual'] }, { signal })).rejects.toThrow(/im_cli_auth/)
      await expect(h.tools.get('wecom_cli')!.execute({ arguments: ['login'] }, { signal })).rejects.toThrow(/im_cli_auth/)
      await expect(h.tools.get('wecom_cli')!.execute({ arguments: ['upgrade'] }, { signal })).rejects.toThrow(/im_cli_auth/)
      await expect(h.tools.get('dingtalk_cli')!.execute({ arguments: ['auth', 'login'] }, { signal })).rejects.toThrow(/im_cli_auth/)
      await expect(h.tools.get('dingtalk_cli')!.execute({ arguments: ['--client-id', 'x'] }, { signal })).rejects.toThrow(/client and profile/)
      await expect(h.tools.get('dingtalk_cli')!.execute({ arguments: ['--device'] }, { signal })).rejects.toThrow(/client and profile/)
      await expect(h.tools.get('dingtalk_cli')!.execute({ arguments: ['--client-secret', 'x'] }, { signal })).rejects.toThrow(/secret flags/)
      await expect(executeWecomCli(h.ctx, config, ['auth', 'show'], AbortSignal.abort())).rejects.toThrow()
      config.dingtalkClientId = createVolatile('')
      await expect(executeDingtalkCli(h.ctx, config, ['auth', 'status'], signal)).rejects.toThrow(/client ID/)
      config.dingtalkClientId = createVolatile('ding-id')
      config.dingtalkClientSecretEnv = createVolatile('   ')
      await expect(executeDingtalkCli(h.ctx, config, ['auth', 'status'], signal)).rejects.toThrow(/client secret/)
      config.dingtalkClientSecretEnv = createVolatile('DINGTALK_CLIENT_SECRET')
    } finally {
      await h.ctx.fiber.dispose()
    }
    const missingConfig = configCells({ dingtalkCliEnabled: true, dingtalkClientId: 'ding-id' })
    const missing = host(missingConfig, { missingSecret: true })
    await missing.start()
    try {
      await expect(executeDingtalkCli(missing.ctx, missingConfig, ['auth', 'status'], new AbortController().signal)).rejects.toThrow(/client secret/)
    } finally {
      await missing.ctx.fiber.dispose()
    }
  })

  it('parses auth output and returns a pending QR or device login', async () => {
    expect(parseAuthOutput('nothing')).toEqual({ url: '', deviceCode: '', userCode: '' })
    expect(parseAuthOutput('打开 https://example.test/a 设备码: dev-1 用户码: user-1')).toEqual({
      url: 'https://example.test/a', deviceCode: 'dev-1', userCode: 'user-1',
    })

    const config = configCells({ wecomCliEnabled: true, dingtalkCliEnabled: true, dingtalkClientId: 'ding-id' })
    const h = host(config)
    await h.start()
    try {
      const signal = new AbortController().signal
      const wecom = await h.tools.get('im_cli_auth')!.execute({ channel: 'wecom' }, { signal }) as { qrCodePath: string; pending: boolean; stdout: string }
      expect(wecom.pending).toBe(true)
      expect(wecom.qrCodePath).toContain('auth-qr.png')
      expect(wecom.stdout).toContain('qrcode')
      const ding = await h.tools.get('im_cli_auth')!.execute({ channel: 'dingtalk' }, { signal }) as { deviceCode: string; url: string; pending: boolean }
      expect(ding.deviceCode).toBe('ABC123')
      expect(ding.url).toContain('https://example.test/device')
      expect(ding.pending).toBe(true)
      const lark = await h.tools.get('im_cli_auth')!.execute({ channel: 'lark' }, { signal }) as { url: string; userCode: string }
      expect(lark.url).toContain('https://example.test/device')
      expect(lark.userCode).toBe('XYZ')

      config.wecomCliEnabled = createVolatile(false)
      await expect(executeImCliAuth(h.ctx, config, 'wecom', signal, false)).rejects.toThrow(/Enable the wecom CLI/)
      const cancelled = new AbortController()
      cancelled.abort()
      await expect(h.tools.get('im_cli_auth')!.execute({ channel: 'dingtalk' }, { signal: cancelled.signal })).rejects.toThrow(/cancelled/)
    } finally {
      await h.ctx.fiber.dispose()
    }
  })

  it('relays a path, a translated hint, or an exited login with no hint', async () => {
    const config = configCells({ wecomCliEnabled: true, dingtalkCliEnabled: true, dingtalkClientId: 'ding-id' })
    const qr = wecomQrPath()
    const scripts = {
      wecom: { stdout: '二维码已生成', pending: true },
      url: { stdout: 'https://example.test/only-url', pending: true },
      user: { stdout: 'user code: ONLYUSER', pending: true },
      device: { stdout: 'device code: ONLYDEVICE', pending: true },
      empty: { stdout: 'still waiting', pending: false },
    }
    let mode: keyof typeof scripts = 'wecom'
    const ctx = new Context()
    vi.spyOn(cliInstall, 'ensureChannelBinary').mockResolvedValue('/tmp/dsh-im-cli-bin')
    ctx.provide('credentials', { resolve: async () => ({ value: 'secret-value' }) } as never)
    ctx.provide('subprocess', {
      spawn(spec: { argv: string[] }) {
        const args = spec.argv.slice(2)
        const command = args[0] === '--profile' ? args.slice(2) : args
        const script = command[0] === 'profile' || command[0] === 'config'
          ? { stdout: command[0] === 'profile' ? '[]' : '', pending: false }
          : scripts[mode]
        return {
          done: script.pending ? new Promise(() => {}) : Promise.resolve({ exitCode: 0, signal: null }),
          terminate: () => {},
          collected: {
            stdout: { readFrom: () => ({ text: script.stdout }) },
            stderr: { readFrom: () => ({ text: '' }) },
          },
        }
      },
    } as never)
    const signal = new AbortController().signal
    const wecom = await executeImCliAuth(ctx, config, 'wecom', signal, true)
    expect(wecom.stdout).toContain('二维码')
    expect(wecom.qrCodePath).toBe(qr)
    expect(wecom.pending).toBe(true)
    expect(wecom.stdout.includes(qr)).toBe(false)

    mode = 'url'
    const byUrl = await executeImCliAuth(ctx, config, 'dingtalk', signal, true)
    expect(byUrl.url).toContain('https://example.test/only-url')
    expect(byUrl.deviceCode).toBe('')
    expect(byUrl.userCode).toBe('')

    mode = 'user'
    const byUser = await executeImCliAuth(ctx, config, 'lark', signal, true)
    expect(byUser.userCode).toBe('ONLYUSER')
    expect(byUser.url).toBe('')
    expect(byUser.deviceCode).toBe('')

    mode = 'device'
    const byDevice = await executeImCliAuth(ctx, config, 'dingtalk', signal, true)
    expect(byDevice.deviceCode).toBe('ONLYDEVICE')
    expect(byDevice.url).toBe('')

    mode = 'empty'
    const quiet = await executeImCliAuth(ctx, config, 'dingtalk', signal, true)
    expect(quiet.pending).toBe(false)
    expect(quiet.url).toBe('')
    expect(quiet.deviceCode).toBe('')
    expect(quiet.userCode).toBe('')
  })

  it('stops an auth child when the tool aborts during startup and when a new session replaces it', async () => {
    const terminate = vi.fn()
    expect(bindAuthProcess('missing-channel', terminate)).toBeUndefined()
    expect(terminate).not.toHaveBeenCalled()
    const first = replaceAuthSession('replace-channel')
    bindAuthProcess('replace-channel', terminate)
    const second = replaceAuthSession('replace-channel')
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)
    expect(terminate).toHaveBeenCalled()

    const config = configCells({ dingtalkCliEnabled: true, dingtalkClientId: 'ding-id' })
    const ctx = new Context()
    vi.spyOn(cliInstall, 'ensureChannelBinary').mockResolvedValue('/tmp/dsh-im-cli-bin')
    ctx.provide('credentials', { resolve: async () => ({ value: 'secret-value' }) } as never)
    const stop = vi.fn()
    const toolSignal = new AbortController()
    ctx.provide('subprocess', {
      spawn() {
        toolSignal.abort()
        return {
          done: new Promise(() => {}),
          terminate: stop,
          collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } },
        }
      },
    } as never)
    const result = await executeImCliAuth(ctx, config, 'dingtalk', toolSignal.signal, true)
    expect(result.timedOut).toBe(true)
    expect(result.pending).toBe(false)
    expect(stop).toHaveBeenCalled()
  })
})

describe('auth output polling', () => {
  it('returns early, waits out, aborts, and records an exited or failed process', async () => {
    const ready = await readUntil({
      done: new Promise(() => {}),
      collected: { stdout: { readFrom: () => ({ text: 'https://ready.example' }) } },
      terminate: () => {},
    }, stdout => stdout.includes('https://'), 50, new AbortController().signal)
    expect(ready.pending).toBe(true)
    expect(ready.stdout).toContain('https://')

    const aborted = new AbortController()
    aborted.abort()
    const stopped = vi.fn()
    const immediate = await readUntil({
      done: new Promise(() => {}),
      collected: {},
      terminate: stopped,
    }, () => false, 50, aborted.signal)
    expect(immediate.timedOut).toBe(true)
    expect(stopped).toHaveBeenCalled()

    const later = new AbortController()
    const laterStop = vi.fn()
    const waiting = readUntil({
      done: new Promise(() => {}),
      collected: { stderr: { readFrom: () => ({ text: '' }) } },
      terminate: laterStop,
    }, () => false, 200, later.signal)
    setTimeout(() => { later.abort() }, 5)
    const waited = await waiting
    expect(waited.pending).toBe(false)
    expect(laterStop).toHaveBeenCalled()

    const exited = await readUntil({
      done: new Promise((resolve) => { setTimeout(() => { resolve({ exitCode: 4, signal: 'SIGINT' }) }, 20) }),
      collected: {},
      terminate: () => {},
    }, () => false, 200, new AbortController().signal)
    expect(exited).toMatchObject({ exitCode: 4, signal: 'SIGINT', pending: false })

    const failed = await readUntil({
      done: Promise.reject(new Error('spawn failed')),
      collected: {},
      terminate: () => {},
    }, () => false, 0, new AbortController().signal)
    expect(failed.exitCode).toBeNull()
    expect(failed.pending).toBe(false)
  })
})
