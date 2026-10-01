/** Bundle-owned setup operations for the existing Lark connection service. */

import type { Context } from '@deepseek-ai/cordis'
import { registerApp } from '@larksuite/channel'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Config as LarkConfig } from './host/lark/plugin.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { runLarkCliCommands } from './lark-cli.ts'
import type { LarkAuthorizationRequest, LarkRegisteredApplication, LarkSetupResult } from './types.ts'

const APP_SECRET = credentialRef('LARK_APP_SECRET')
const PENDING_AUTH = credentialRef('LARK_PENDING_USER_AUTH_DEVICE_CODE')
const USER_ID_SCOPE = 'contact:user.base:readonly'
const OFFICIAL_AUTH_ORIGINS = new Set(['https://accounts.feishu.cn', 'https://accounts.larksuite.com'])

interface PendingRegistration {
  readonly brand: 'feishu' | 'lark'
  readonly identityAtStart: CliIdentity
  readonly generation: number
  readonly controller: AbortController
  readonly result: Promise<{ client_id: string; client_secret: string; user_info?: { tenant_brand?: 'feishu' | 'lark' } }>
  readonly verificationUrl: Promise<string>
}

interface PendingUserAuthorization {
  readonly appId: string
  readonly brand: 'feishu' | 'lark'
  readonly appSecretEnv: string
  readonly deviceCode: string
  readonly createdAt: number
}

interface CliIdentity {
  readonly appId: string
  readonly brand: 'feishu' | 'lark'
  readonly appSecretEnv: string
}

/** Expose Lark setup flows without duplicating the existing `larkStatus` Remote identity. */
export class LarkIntegrationSetup extends TypertRemoteService {
  private pendingRegistration: PendingRegistration | undefined
  private userAuthorizationController: AbortController | undefined
  private setupGeneration = 0
  private setupMutationTail: Promise<void> = Promise.resolve()
  private committedSetupGeneration = -1

  /** @param ctx - Host context that owns the Lark integration.
   * @param config - live Lark configuration used by setup operations.
   * @param register - official application-registration flow, replaceable by a test fixture.
   */
  constructor(
    ctx: Context,
    private readonly config: LarkConfig,
    private readonly register: typeof registerApp = registerApp,
  ) {
    super(ctx, 'larkSetup')
    ctx.effect(() => () => {
      this.pendingRegistration?.controller.abort()
      this.userAuthorizationController?.abort()
    }, 'lark integration setup flows')
  }

  /** Start official application registration and return only its verified browser URL.
   * @param brand - Feishu or Lark deployment selected by the user.
   * @returns a browser URL or a safe setup error code.
   */
  @Remote('beginQuickConnect')
  async beginQuickConnect(brand: 'feishu' | 'lark'): Promise<LarkSetupResult<LarkAuthorizationRequest>> {
    const generation = ++this.setupGeneration
    const identityAtStart = this.currentCliIdentity()
    this.cancelRegistration()
    this.userAuthorizationController?.abort()
    const controller = new AbortController()
    let resolveUrl!: (url: string) => void
    let rejectUrl!: (error: unknown) => void
    const verificationUrl = new Promise<string>((resolve, reject) => { resolveUrl = resolve; rejectUrl = reject })
    const result = this.register({
      domain: brand === 'lark' ? 'accounts.larksuite.com' : 'accounts.feishu.cn',
      larkDomain: 'accounts.larksuite.com',
      source: 'deepseek-harness', createOnly: true,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(this.config.registrationTimeoutMs.get())]),
      appPreset: { name: 'DeepSeek Harness - {user}', desc: 'DeepSeek Harness private chat agent' },
      addons: {
        preset: false,
        scopes: {
          tenant: ['im:message.p2p_msg:readonly', 'im:message:send_as_bot', 'im:resource'],
          user: [USER_ID_SCOPE],
        },
        events: { items: { tenant: ['im.message.receive_v1'] } },
      },
      onQRCodeReady: ({ url }) => {
        const safeUrl = officialAuthorizationUrl(url)
        if (safeUrl === undefined) {
          controller.abort()
          rejectUrl(new Error('unsupported-url'))
        }
        else resolveUrl(safeUrl)
      },
    })
    const pending = { brand, identityAtStart, generation, controller, result, verificationUrl } satisfies PendingRegistration
    this.pendingRegistration = pending
    void result.catch((error: unknown) => { rejectUrl(error) })
    try {
      const url = await verificationUrl
      if (generation !== this.setupGeneration || this.pendingRegistration !== pending || controller.signal.aborted) {
        return { ok: false, code: 'cancelled' }
      }
      return { ok: true, verificationUrl: url }
    } catch (error: unknown) {
      if (this.pendingRegistration === pending) this.pendingRegistration = undefined
      controller.abort()
      return { ok: false, code: errorCode(error) }
    }
  }

  /** Persist credentials from official registration without returning the secret to Client.
   * @returns the application id and confirmed platform, or a safe setup error code.
   */
  @Remote('completeQuickConnect')
  async completeQuickConnect(): Promise<LarkSetupResult<LarkRegisteredApplication>> {
    const pending = this.pendingRegistration
    if (pending === undefined) return { ok: false, code: 'not-ready' }
    try {
      const registered = await pending.result
      const appId = registered.client_id.trim()
      if (appId.length === 0 || registered.client_secret.length === 0) return { ok: false, code: 'operation-failed' }
      return await this.withSetupMutation(async () => {
        if (!this.isCurrentRegistration(pending)) return { ok: false, code: 'cancelled' }
        const secretRef = this.secretRef()
        const previousSecret = await this.ctx.credentials.resolve(secretRef)
        if (!this.isCurrentRegistration(pending)) return { ok: false, code: 'cancelled' }
        await this.ctx.credentials.set(secretRef, registered.client_secret)
        if (!this.isCurrentRegistration(pending)) {
          await restoreCredential(this.ctx, secretRef, previousSecret?.value)
          return { ok: false, code: 'cancelled' }
        }
        try {
          const row = this.larkConfigRow()
          await this.ctx.configEditor.edit(row.entry, current => ({
            ...current, appId, brand: registered.user_info?.tenant_brand ?? pending.brand,
            appSecretEnv: String(secretRef), authorizedUserOpenId: '',
          }))
        } catch {
          await restoreCredential(this.ctx, secretRef, previousSecret?.value)
          throw new Error('configuration-save-failed')
        }
        this.committedSetupGeneration = pending.generation
        if (this.pendingRegistration === pending) this.pendingRegistration = undefined
        return { ok: true, appId, brand: registered.user_info?.tenant_brand ?? pending.brand }
      })
    } catch (error: unknown) {
      if (this.pendingRegistration === pending) this.pendingRegistration = undefined
      return { ok: false, code: errorCode(error) }
    }
  }

  /** Cancel registration or a pending user device authorization without deleting application credentials. */
  @Remote('cancelSetupFlow')
  async cancelSetupFlow(): Promise<{ completed: boolean }> {
    const activeGeneration = this.setupGeneration
    const generation = ++this.setupGeneration
    this.cancelRegistration()
    this.userAuthorizationController?.abort()
    const savedPending = await this.readPendingAuthorization()
    await this.setupMutationTail
    if (this.setupGeneration === generation && savedPending !== undefined) {
      await this.removePendingCode(savedPending.deviceCode)
    }
    return { completed: this.committedSetupGeneration === activeGeneration }
  }

  /**
   * Report saved pending device authorization so a refreshed Client can resume the flow.
   * @returns The saved authorization for the current identity, `{ exists: false }` when absent,
   * or an `identity-mismatch` marker when the authorization belongs to another application identity.
   */
  @Remote('describePendingUserAuthorization')
  async describePendingUserAuthorization(): Promise<
    | { readonly exists: false }
    | {
      readonly exists: true
      readonly appId: string
      readonly brand: 'feishu' | 'lark'
      readonly appSecretEnv: string
      readonly createdAt: number
      readonly matchesIdentity: boolean
      readonly expired: boolean
    }
  > {
    const pending = await this.readPendingAuthorization()
    if (pending === undefined) return { exists: false }
    const identity = this.currentCliIdentity()
    return {
      exists: true,
      appId: pending.appId, brand: pending.brand, appSecretEnv: pending.appSecretEnv, createdAt: pending.createdAt,
      matchesIdentity: sameIdentity(pending, identity),
      expired: Date.now() - pending.createdAt > this.config.registrationTimeoutMs.get(),
    }
  }

  /** Start current-user OAuth through the official Lark CLI and persist its device code as a credential.
   * @returns the validated browser URL or a safe setup error code.
   */
  @Remote('beginUserAuthorization')
  async beginUserAuthorization(): Promise<LarkSetupResult<LarkAuthorizationRequest>> {
    const generation = ++this.setupGeneration
    this.cancelRegistration()
    const identity = this.currentCliIdentity()
    const { appId, brand, appSecretEnv } = identity
    const configuredSecret = await this.ctx.credentials.resolve(this.secretRef())
    if (generation !== this.setupGeneration) return { ok: false, code: 'cancelled' }
    if (appId.length === 0 || configuredSecret === undefined) {
      return { ok: false, code: 'not-configured' }
    }
    const controller = new AbortController()
    this.userAuthorizationController?.abort()
    this.userAuthorizationController = controller
    try {
      const [login] = await runLarkCliCommands(this.ctx, this.config, [[
        'auth', 'login', '--scope', USER_ID_SCOPE, '--no-wait', '--json',
      ]], controller.signal, identity)
      if (generation !== this.setupGeneration || this.userAuthorizationController !== controller || controller.signal.aborted
        || !sameIdentity(identity, this.currentCliIdentity())) return { ok: false, code: 'cancelled' }
      const data = parseJson(login?.stdout)
      const deviceCode = text(data?.device_code)
      const verificationUrl = text(data?.verification_url)
      if (login === undefined || login.exitCode !== 0 || login.timedOut || deviceCode === undefined || verificationUrl === undefined) {
        return { ok: false, code: login?.timedOut ? 'expired' : 'operation-failed' }
      }
      const safeUrl = officialAuthorizationUrl(verificationUrl)
      if (safeUrl === undefined) return { ok: false, code: 'unsupported-url' }
      const pending: PendingUserAuthorization = { appId, brand, appSecretEnv, deviceCode, createdAt: Date.now() }
      const saved = await this.withSetupMutation(async () => {
        if (generation !== this.setupGeneration || this.userAuthorizationController !== controller || isAborted(controller.signal)
          || !sameIdentity(identity, this.currentCliIdentity())) return false
        await this.ctx.credentials.set(PENDING_AUTH, JSON.stringify(pending))
        if (generation !== this.setupGeneration || this.userAuthorizationController !== controller || isAborted(controller.signal)
          || !sameIdentity(identity, this.currentCliIdentity())) {
          await this.removePendingCode(deviceCode)
          return false
        }
        return true
      })
      if (!saved) {
        return { ok: false, code: 'cancelled' }
      }
      return { ok: true, verificationUrl: safeUrl }
    } catch (error: unknown) {
      return { ok: false, code: errorCode(error) }
    } finally {
      if (this.userAuthorizationController === controller) this.userAuthorizationController = undefined
    }
  }

  /** Complete the pending user OAuth and return only the verified Open ID.
   * @returns the authorized Open ID or a safe setup error code.
   */
  @Remote('completeUserAuthorization')
  async completeUserAuthorization(): Promise<LarkSetupResult> {
    const generation = ++this.setupGeneration
    const pending = await this.readPendingAuthorization()
    if (generation !== this.setupGeneration) return { ok: false, code: 'cancelled' }
    if (pending === undefined) return { ok: false, code: 'not-ready' }
    if (!sameIdentity(pending, this.currentCliIdentity())) {
      await this.removePendingCode(pending.deviceCode)
      return { ok: false, code: 'not-ready' }
    }
    const controller = new AbortController()
    this.userAuthorizationController = controller
    try {
      const results = await runLarkCliCommands(this.ctx, this.config, [
        ['auth', 'login', '--device-code', pending.deviceCode, '--json'],
        ['auth', 'status', '--json'],
      ], controller.signal, pending)
      const [login, status] = results
      if (login === undefined || login.exitCode !== 0 || login.timedOut) {
        return { ok: false, code: login?.timedOut ? 'expired' : 'not-ready' }
      }
      const openId = authorizedOpenId(parseJson(status?.stdout))
      if (status?.exitCode !== 0 || openId === undefined) return { ok: false, code: 'not-ready' }
      return await this.withSetupMutation(async () => {
        const currentPending = await this.readPendingAuthorization()
        if (this.userAuthorizationController !== controller || controller.signal.aborted
          || generation !== this.setupGeneration || !sameIdentity(pending, this.currentCliIdentity())
          || currentPending?.deviceCode !== pending.deviceCode) return { ok: false, code: 'cancelled' }
        const row = this.larkConfigRow()
        await this.ctx.configEditor.edit(row.entry, (current) => {
          if (generation !== this.setupGeneration || this.userAuthorizationController !== controller
            || !sameIdentity(pending, this.currentCliIdentity())) throw new Error('application-changed')
          return { ...current, authorizedUserOpenId: openId }
        })
        this.committedSetupGeneration = generation
        await this.removePendingCode(pending.deviceCode)
        return { ok: true }
      })
    } catch (error: unknown) {
      return { ok: false, code: errorCode(error) }
    } finally {
      if (this.userAuthorizationController === controller) this.userAuthorizationController = undefined
    }
  }

  private secretRef() {
    const configured = this.config.appSecretEnv.get().trim()
    return credentialRef(configured || String(APP_SECRET))
  }

  private currentCliIdentity(): CliIdentity {
    return {
      appId: this.config.appId.get().trim(), brand: this.config.brand.get(),
      appSecretEnv: this.config.appSecretEnv.get().trim(),
    }
  }

  private cancelRegistration(): void {
    this.pendingRegistration?.controller.abort()
    this.pendingRegistration = undefined
  }

  private isCurrentRegistration(pending: PendingRegistration): boolean {
    return this.pendingRegistration === pending && pending.generation === this.setupGeneration
      && !pending.controller.signal.aborted && sameIdentity(pending.identityAtStart, this.currentCliIdentity())
  }

  private larkConfigRow() {
    const rows = this.ctx.configEditor.configuration().filter(({ entry }) =>
      entry.options.id === 'lark' || entry.options.name === 'lark')
    const row = rows.length === 1 ? rows[0] : undefined
    if (row === undefined) throw new Error('Lark configuration entry unavailable')
    return row
  }

  private async withSetupMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.setupMutationTail
    let release!: () => void
    this.setupMutationTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private async readPendingAuthorization(): Promise<PendingUserAuthorization | undefined> {
    const current = await this.ctx.credentials.resolve(PENDING_AUTH)
    if (current === undefined) return undefined
    try {
      const parsed: unknown = JSON.parse(current.value)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
      const row = parsed as Record<string, unknown>
      if (typeof row.appId !== 'string' || typeof row.appSecretEnv !== 'string' || typeof row.deviceCode !== 'string'
        || (row.brand !== 'feishu' && row.brand !== 'lark') || typeof row.createdAt !== 'number') return undefined
      if (Date.now() - row.createdAt > this.config.registrationTimeoutMs.get()) {
        await this.ctx.credentials.unset(PENDING_AUTH)
        return undefined
      }
      return { appId: row.appId, brand: row.brand, appSecretEnv: row.appSecretEnv, deviceCode: row.deviceCode, createdAt: row.createdAt }
    } catch {
      await this.ctx.credentials.unset(PENDING_AUTH)
      return undefined
    }
  }

  private async removePendingCode(deviceCode: string): Promise<void> {
    const current = await this.ctx.credentials.resolve(PENDING_AUTH)
    if (current !== undefined && parseJson(current.value)?.deviceCode === deviceCode) {
      await this.ctx.credentials.unset(PENDING_AUTH)
    }
  }
}

/** Read the live abort state; the call keeps an await from reusing the narrowed value of an earlier check. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

function officialAuthorizationUrl(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !OFFICIAL_AUTH_ORIGINS.has(url.origin)
      || url.username !== '' || url.password !== '' || url.port !== '') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function errorCode(error: unknown): 'cancelled' | 'expired' | 'not-ready' | 'operation-failed' | 'unsupported-url' {
  if (error instanceof Error && error.message === 'unsupported-url') return 'unsupported-url'
  if (error instanceof Error && error.message === 'application-changed') return 'not-ready'
  if (error instanceof Error && /abort|cancel/i.test(error.name + error.message)) return 'cancelled'
  if (error instanceof Error && /expired|timeout/i.test(error.name + error.message)) return 'expired'
  return 'operation-failed'
}

async function restoreCredential(ctx: Context, ref: ReturnType<typeof credentialRef>, value?: string): Promise<void> {
  if (value === undefined) await ctx.credentials.unset(ref)
  else await ctx.credentials.set(ref, value)
}

function sameIdentity(left: CliIdentity, right: CliIdentity): boolean {
  return left.appId === right.appId && left.brand === right.brand && left.appSecretEnv === right.appSecretEnv
}

function parseJson(value: string | undefined): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function authorizedOpenId(status: Record<string, unknown> | undefined): string | undefined {
  const identities = status?.identities
  if (typeof identities !== 'object' || identities === null || Array.isArray(identities)) return undefined
  const user = (identities as Record<string, unknown>).user
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return undefined
  const row = user as Record<string, unknown>
  return row.available === true && row.verified !== false ? text(row.openId) : undefined
}
