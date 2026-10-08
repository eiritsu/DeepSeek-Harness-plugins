import { Context } from '@deepseek-ai/cordis'
import { createVolatile } from '@deepseek-ai/cosmokit'
import { registerApp, type RegisterAppOptions } from '@larksuite/channel'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/index.ts'
import { LarkIntegrationSetup } from '../src/status.ts'

const APP_SECRET_REF = 'LARK_APP_SECRET'

function harness(options: {
  register?: typeof registerApp
  configEdit?: (next: Record<string, unknown>) => Promise<void>
} = {}) {
  const ctx = new Context()
  const secrets = new Map<string, string>([[APP_SECRET_REF, 'existing-secret']])
  const settings: Record<string, unknown> = {
    appId: 'cli_existing', brand: 'feishu', appSecretEnv: APP_SECRET_REF, authorizedUserOpenId: 'ou_old',
  }
  const config = {
    appId: createVolatile('cli_existing'), appSecretEnv: createVolatile(APP_SECRET_REF), brand: createVolatile('feishu'),
    authorizedUserOpenId: createVolatile('ou_old'), enabled: createVolatile(false), cliEnabled: createVolatile(false),
    conversationCwd: createVolatile(''), responseTimeoutMs: createVolatile(60_000), handshakeTimeoutMs: createVolatile(10_000),
    httpTimeoutMs: createVolatile(10_000), cliTimeoutMs: createVolatile(30_000), cliMaxOutputBytes: createVolatile(4096),
    cliGraceMs: createVolatile(250), registrationTimeoutMs: createVolatile(600_000),
  } as Config
  const commands: string[][] = []
  ctx.provide('credentials', {
    resolve: async (ref: string) => secrets.has(ref) ? { value: secrets.get(ref)!, source: 'test' } : undefined,
    set: async (ref: string, value: string) => { secrets.set(ref, value) },
    unset: async (ref: string) => { secrets.delete(ref) },
  } as never)
  ctx.provide('subprocess', {
    spawn(spec: { argv: string[] }) {
      // The integration leads every command with its own profile selection.
      const args = spec.argv.slice(2)
      commands.push(args)
      const cliArgs = args[0] === '--profile' ? args.slice(2) : args
      let stdout = ''
      if (cliArgs[0] === 'profile' && cliArgs[1] === 'list') stdout = '[]'
      else if (cliArgs[0] === 'auth' && cliArgs[1] === 'login' && cliArgs.includes('--no-wait')) {
        stdout = JSON.stringify({ device_code: 'device-secret', verification_url: 'https://accounts.feishu.cn/oauth/device?code=public' })
      } else if (cliArgs[0] === 'auth' && cliArgs[1] === 'status') {
        stdout = JSON.stringify({ identities: { user: { available: true, verified: true, openId: 'ou_authorized' } } })
      }
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: stdout }) },
          stderr: { readFrom: () => ({ text: '' }) },
        },
      }
    },
  } as never)
  const entry = { options: { id: 'lark', name: 'lark' } }
  ctx.provide('configEditor', {
    configuration: () => [{ entry, inherited: {}, override: settings }],
    edit: async (
      _entry: unknown,
      change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const next = change(settings, {})
      if (options.configEdit) await options.configEdit(next)
      Object.assign(settings, next)
    },
  } as never)
  let service!: LarkIntegrationSetup
  const fiber = ctx.plugin((pluginCtx) => {
    service = new LarkIntegrationSetup(pluginCtx, config, options.register)
  })
  return { ctx, config, commands, fiber, secrets, get service() { return service }, settings }
}

describe('Lark application and user authorization setup', () => {
  const contexts: Context[] = []
  afterEach(async () => {
    await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  })

  it('uses official registration, commits app identity with the secret, and never returns the secret', async () => {
    const register = vi.fn(async (options: RegisterAppOptions) => {
      options.onQRCodeReady({ url: 'https://accounts.feishu.cn/oauth/v1/app/registration?flow=public', expireIn: 600 })
      return { client_id: 'cli_new', client_secret: 'registration-secret', user_info: { tenant_brand: 'feishu' as const } }
    })
    const h = harness({ register })
    contexts.push(h.ctx)
    await h.fiber.await()
    const started = await h.service.beginQuickConnect('feishu')
    expect(started).toEqual({ ok: true, verificationUrl: 'https://accounts.feishu.cn/oauth/v1/app/registration?flow=public' })
    const completed = await h.service.completeQuickConnect()
    expect(completed).toEqual({ ok: true, appId: 'cli_new', brand: 'feishu' })
    expect(JSON.stringify(completed)).not.toContain('registration-secret')
    expect(h.secrets.get(APP_SECRET_REF)).toBe('registration-secret')
    expect(h.settings).toMatchObject({ appId: 'cli_new', brand: 'feishu', authorizedUserOpenId: '', appSecretEnv: APP_SECRET_REF })
    expect(register.mock.calls[0]?.[0]).toMatchObject({ createOnly: true, domain: 'accounts.feishu.cn', larkDomain: 'accounts.larksuite.com' })
  })

  it('rejects untrusted registration URLs and restores the prior secret after ConfigEditor refuses', async () => {
    const unsafeRegister = vi.fn(async (options: RegisterAppOptions) => {
      options.onQRCodeReady({ url: 'https://attacker.example/authorize', expireIn: 600 })
      return { client_id: 'cli_new', client_secret: 'new-secret' }
    })
    const unsafe = harness({ register: unsafeRegister })
    contexts.push(unsafe.ctx)
    await unsafe.fiber.await()
    expect(await unsafe.service.beginQuickConnect('feishu')).toEqual({ ok: false, code: 'unsupported-url' })
    expect(unsafe.secrets.get(APP_SECRET_REF)).toBe('existing-secret')

    const failing = harness({
      register: vi.fn(async (options: Parameters<typeof registerApp>[0]) => {
        options.onQRCodeReady({ url: 'https://accounts.larksuite.com/oauth/v1/app/registration', expireIn: 600 })
        return { client_id: 'cli_new', client_secret: 'new-secret', user_info: { tenant_brand: 'lark' as const } }
      }),
      configEdit: async () => { throw new Error('private ConfigEditor error') },
    })
    contexts.push(failing.ctx)
    await failing.fiber.await()
    expect((await failing.service.beginQuickConnect('lark')).ok).toBe(true)
    expect(await failing.service.completeQuickConnect()).toEqual({ ok: false, code: 'operation-failed' })
    expect(failing.secrets.get(APP_SECRET_REF)).toBe('existing-secret')
    expect(failing.settings).toMatchObject({ appId: 'cli_existing', brand: 'feishu', authorizedUserOpenId: 'ou_old' })
  })

  it('does not commit a registration that completes after cancellation', async () => {
    let finishRegistration!: (result: { client_id: string; client_secret: string }) => void
    const register = vi.fn((options: RegisterAppOptions) => {
      options.onQRCodeReady({ url: 'https://accounts.feishu.cn/oauth/v1/app/registration', expireIn: 600 })
      return new Promise<{ client_id: string; client_secret: string }>((resolve) => { finishRegistration = resolve })
    })
    const h = harness({ register })
    contexts.push(h.ctx)
    await h.fiber.await()
    expect((await h.service.beginQuickConnect('feishu')).ok).toBe(true)
    const completion = h.service.completeQuickConnect()
    await h.service.cancelSetupFlow()
    finishRegistration({ client_id: 'cli_late', client_secret: 'late-secret' })
    expect(await completion).toEqual({ ok: false, code: 'cancelled' })
    expect(h.secrets.get(APP_SECRET_REF)).toBe('existing-secret')
    expect(h.settings).toMatchObject({ appId: 'cli_existing', brand: 'feishu', authorizedUserOpenId: 'ou_old' })
  })

  it('reports a completed registration when cancellation arrives after its config commit starts', async () => {
    let finishEdit!: () => void
    let enteredEdit!: () => void
    const editing = new Promise<void>((resolve) => { finishEdit = resolve })
    const entered = new Promise<void>((resolve) => { enteredEdit = resolve })
    const h = harness({
      register: vi.fn(async (options: Parameters<typeof registerApp>[0]) => {
        options.onQRCodeReady({ url: 'https://accounts.feishu.cn/oauth/v1/app/registration', expireIn: 600 })
        return { client_id: 'cli_committed', client_secret: 'committed-secret' }
      }),
      configEdit: async () => { enteredEdit(); await editing },
    })
    contexts.push(h.ctx)
    await h.fiber.await()
    await h.service.beginQuickConnect('feishu')
    const completing = h.service.completeQuickConnect()
    await entered
    const cancelling = h.service.cancelSetupFlow()
    finishEdit()
    expect(await completing).toEqual({ ok: true, appId: 'cli_committed', brand: 'feishu' })
    expect(await cancelling).toEqual({ completed: true })
    expect(h.settings.appId).toBe('cli_committed')
    expect(h.secrets.get(APP_SECRET_REF)).toBe('committed-secret')
  })

  it('gets Open ID from official CLI status and rejects a pending code after app identity changes', async () => {
    const h = harness()
    contexts.push(h.ctx)
    await h.fiber.await()
    const begin = await h.service.beginUserAuthorization()
    expect(begin).toEqual({ ok: true, verificationUrl: 'https://accounts.feishu.cn/oauth/device?code=public' })
    expect(h.secrets.get('LARK_PENDING_USER_AUTH_DEVICE_CODE')).toContain('device-secret')
    expect(JSON.stringify(begin)).not.toContain('device-secret')
    const completed = await h.service.completeUserAuthorization()
    expect(completed).toEqual({ ok: true })
    expect(h.settings.authorizedUserOpenId).toBe('ou_authorized')
    expect(h.commands.map(args => args.slice(2, 4))).toEqual([
      ['profile', 'list'], ['config', 'init'], ['auth', 'login'],
      ['profile', 'list'], ['config', 'init'], ['auth', 'login'], ['auth', 'status'],
    ])
    // Every command runs under the profile bound to this application identity; the device flow
    // stores the authorized user there, so a replacing init would delete the record it just wrote.
    const profile = `dsh-feishu-${createHash('sha256').update('cli_existing').digest('hex').slice(0, 32)}`
    expect(h.commands.every(args => args[0] === '--profile' && args[1] === profile)).toBe(true)
    expect(h.commands.filter(args => args[2] === 'config')
      .every(args => args[args.indexOf('--name') + 1] === profile)).toBe(true)

    expect((await h.service.beginUserAuthorization()).ok).toBe(true)
    h.config.appId = createVolatile('cli_other')
    expect(await h.service.completeUserAuthorization()).toEqual({ ok: false, code: 'not-ready' })
    expect(h.secrets.has('LARK_PENDING_USER_AUTH_DEVICE_CODE')).toBe(false)
  })

  it('reports the saved pending authorization without mutating it so a refreshed Client can resume the flow', async () => {
    const h = harness()
    contexts.push(h.ctx)
    await h.fiber.await()
    expect(await h.service.describePendingUserAuthorization()).toEqual({ exists: false })
    await h.service.beginUserAuthorization()
    const described = await h.service.describePendingUserAuthorization()
    expect(described).toMatchObject({
      exists: true, appId: 'cli_existing', brand: 'feishu', appSecretEnv: APP_SECRET_REF,
      matchesIdentity: true, expired: false,
    })
    // The describe call must not consume or invalidate the saved device code.
    expect(h.secrets.has('LARK_PENDING_USER_AUTH_DEVICE_CODE')).toBe(true)
    expect(await h.service.describePendingUserAuthorization()).toMatchObject({ exists: true })
  })

  it('marks the saved pending authorization as expired and identity-mismatched on read', async () => {
    const h = harness()
    contexts.push(h.ctx)
    await h.fiber.await()
    await h.service.beginUserAuthorization()
    h.config.appId = createVolatile('cli_other')
    expect(await h.service.describePendingUserAuthorization()).toMatchObject({
      exists: true, matchesIdentity: false, expired: false,
    })
    expect(h.secrets.has('LARK_PENDING_USER_AUTH_DEVICE_CODE')).toBe(true)
  })
})
