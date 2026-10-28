/** Staged IM configuration, credential writes, and live Host connection status. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ImIntegrationStatusValue, ImPlatform, WeixinAuthorizationPayload } from '@deepseek-ai/dsh-im-integration/types'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Host Config row id. */
export const IM_CONFIG_NS = 'im'

const SECRET_FIELDS = {
  larkAppSecret: 'larkAppSecretEnv',
  dingtalkClientSecret: 'dingtalkClientSecretEnv',
  wecomBotSecret: 'wecomBotSecretEnv',
  qqAppSecret: 'qqAppSecretEnv',
  telegramBotToken: 'telegramBotTokenEnv',
  discordBotToken: 'discordBotTokenEnv',
  whatsappAccessToken: 'whatsappAccessTokenEnv',
} as const

type SecretField = keyof typeof SECRET_FIELDS

/** Editable IM Host Config values. */
export interface ImSettings {
  activePlatform?: ImPlatform
  enabled?: boolean
  whitelistEnabled?: boolean
  authorizedUsers?: string
  moderationEnabled?: boolean
  approvalPolicy?: 'high_risk' | 'all'
  sensitiveKeywords?: string
  cliEnabled?: boolean
  larkAppId?: string
  larkAppSecretEnv?: string
  larkBrand?: 'feishu' | 'lark'
  dingtalkClientId?: string
  dingtalkClientSecretEnv?: string
  wecomBotId?: string
  wecomBotSecretEnv?: string
  weixinEnabled?: boolean
  weixinBotTokenEnv?: string
  qqAppId?: string
  qqAppSecretEnv?: string
  qqSandbox?: boolean
  telegramBotTokenEnv?: string
  discordBotTokenEnv?: string
  whatsappEnabled?: boolean
  whatsappAccessTokenEnv?: string
}

/** Settings page state. */
export interface ImSettingsState extends SettingsFormShell {
  activePlatform: SettingsFieldState
  enabled: SettingsFieldState
  whitelistEnabled: SettingsFieldState
  authorizedUsers: SettingsFieldState
  moderationEnabled: SettingsFieldState
  approvalPolicy: SettingsFieldState
  sensitiveKeywords: SettingsFieldState
  cliEnabled: SettingsFieldState
  larkAppId: SettingsFieldState
  larkAppSecretEnv: SettingsFieldState
  larkBrand: SettingsFieldState
  dingtalkClientId: SettingsFieldState
  dingtalkClientSecretEnv: SettingsFieldState
  wecomBotId: SettingsFieldState
  wecomBotSecretEnv: SettingsFieldState
  weixinEnabled: SettingsFieldState
  weixinBotTokenEnv: SettingsFieldState
  qqAppId: SettingsFieldState
  qqAppSecretEnv: SettingsFieldState
  qqSandbox: SettingsFieldState
  telegramBotTokenEnv: SettingsFieldState
  discordBotTokenEnv: SettingsFieldState
  whatsappEnabled: SettingsFieldState
  whatsappAccessTokenEnv: SettingsFieldState
  connectionStatus: ImIntegrationStatusValue
  statusDiagnostic?: string
  larkAppSecret: SettingsFieldState
  dingtalkClientSecret: SettingsFieldState
  wecomBotSecret: SettingsFieldState
  qqAppSecret: SettingsFieldState
  telegramBotToken: SettingsFieldState
  discordBotToken: SettingsFieldState
  whatsappAccessToken: SettingsFieldState
  secretsConfigured: Readonly<Record<SecretField, boolean>>
  setupBusy: boolean
  setupResult?: 'complete' | 'cancelled' | 'not-configured' | 'not-ready' | 'operation-failed'
}

/** Slot face passed to the Settings renderer. */
export interface ImSettingsFace extends SettingsFormActions {
  hooks: { imSettings: SnapshotStore<ImSettingsState> }
  selectPlatform(platform: ImPlatform): void
  commitWeixinAuthorization(authorization: WeixinAuthorizationPayload): Promise<boolean>
  clearWeixinAuthorization(): Promise<void>
}

interface CredentialState { configured: boolean; writable: boolean }

const DEFAULT_STATUS: ImIntegrationStatusValue = { platform: 'lark', state: 'disabled' }

/** Connects the profile Config form to write-only secrets and Host status. */
export class ImSettingsController {
  private readonly form: SettingsFormModel<ImSettings>
  private readonly store: SnapshotStore<ImSettingsState>
  private readonly credentials = new Map<string, CredentialState>()
  private readonly credentialGeneration = new Map<string, number>()
  private disposed = false
  private connectionByPlatform = new Map<ImPlatform, ImIntegrationStatusValue>()
  private selectedPlatform: ImPlatform = 'lark'
  private statusDiagnostic: string | undefined
  private setupBusy = false
  private setupResult: ImSettingsState['setupResult']
  private readonly unsubscribe: () => void

  /** @param scope - the Host Config form for the IM plugin.
   * @param ctx - browser context with Host credential and setup remotes.
   */
  constructor(private readonly scope: SettingsFormScope<ImSettings>, private readonly ctx: ClientContext) {
    this.form = new SettingsFormModel(scope, [
      settingsTextField('activePlatform'),
      booleanField('enabled'),
      booleanField('whitelistEnabled'),
      settingsTextField('authorizedUsers'),
      booleanField('moderationEnabled'),
      settingsTextField('approvalPolicy'),
      settingsTextField('sensitiveKeywords'),
      booleanField('cliEnabled'),
      settingsTextField('larkAppId'),
      settingsTextField('larkAppSecretEnv'),
      settingsTextField('larkBrand'),
      settingsTextField('dingtalkClientId'),
      settingsTextField('dingtalkClientSecretEnv'),
      settingsTextField('wecomBotId'),
      settingsTextField('wecomBotSecretEnv'),
      booleanField('weixinEnabled'),
      settingsTextField('weixinBotTokenEnv'),
      settingsTextField('qqAppId'),
      settingsTextField('qqAppSecretEnv'),
      booleanField('qqSandbox'),
      settingsTextField('telegramBotTokenEnv'),
      settingsTextField('discordBotTokenEnv'),
      booleanField('whatsappEnabled'),
      settingsTextField('whatsappAccessTokenEnv'),
    ], Object.entries(SECRET_FIELDS).map(([field, envField]) => ({
      field,
      write: (value: string) => this.writeCredential(envField, value),
    })))
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => {
      const platform = this.scope.getSnapshot().value?.activePlatform
      if (platform !== undefined) this.selectedPlatform = platform
      this.refreshCredentialRefs()
    })
    const initialPlatform = this.scope.getSnapshot().value?.activePlatform
    if (initialPlatform !== undefined) this.selectedPlatform = initialPlatform
    this.refreshCredentialRefs()
  }

  private isDisposed(): boolean {
    return this.disposed
  }

  private projection(): ImSettingsState {
    const status = this.connectionByPlatform.get(this.selectedPlatform) ?? {
      ...DEFAULT_STATUS,
      platform: this.selectedPlatform,
    }
    return {
      ...this.form.shell(),
      activePlatform: this.form.field('activePlatform'),
      enabled: this.form.field('enabled'),
      whitelistEnabled: this.form.field('whitelistEnabled'),
      authorizedUsers: this.form.field('authorizedUsers'),
      moderationEnabled: this.form.field('moderationEnabled'),
      approvalPolicy: this.form.field('approvalPolicy'),
      sensitiveKeywords: this.form.field('sensitiveKeywords'),
      cliEnabled: this.form.field('cliEnabled'),
      larkAppId: this.form.field('larkAppId'),
      larkAppSecretEnv: this.form.field('larkAppSecretEnv'),
      larkBrand: this.form.field('larkBrand'),
      dingtalkClientId: this.form.field('dingtalkClientId'),
      dingtalkClientSecretEnv: this.form.field('dingtalkClientSecretEnv'),
      wecomBotId: this.form.field('wecomBotId'),
      wecomBotSecretEnv: this.form.field('wecomBotSecretEnv'),
      weixinEnabled: this.form.field('weixinEnabled'),
      weixinBotTokenEnv: this.form.field('weixinBotTokenEnv'),
      qqAppId: this.form.field('qqAppId'),
      qqAppSecretEnv: this.form.field('qqAppSecretEnv'),
      qqSandbox: this.form.field('qqSandbox'),
      telegramBotTokenEnv: this.form.field('telegramBotTokenEnv'),
      discordBotTokenEnv: this.form.field('discordBotTokenEnv'),
      whatsappEnabled: this.form.field('whatsappEnabled'),
      whatsappAccessTokenEnv: this.form.field('whatsappAccessTokenEnv'),
      connectionStatus: status,
      ...(this.statusDiagnostic === undefined ? {} : { statusDiagnostic: this.statusDiagnostic }),
      larkAppSecret: this.form.field('larkAppSecret'),
      dingtalkClientSecret: this.form.field('dingtalkClientSecret'),
      wecomBotSecret: this.form.field('wecomBotSecret'),
      qqAppSecret: this.form.field('qqAppSecret'),
      telegramBotToken: this.form.field('telegramBotToken'),
      discordBotToken: this.form.field('discordBotToken'),
      whatsappAccessToken: this.form.field('whatsappAccessToken'),
      secretsConfigured: {
        larkAppSecret: this.credentials.get(this.credentialRefFor('larkAppSecretEnv'))?.configured ?? false,
        dingtalkClientSecret: this.credentials.get(this.credentialRefFor('dingtalkClientSecretEnv'))?.configured ?? false,
        wecomBotSecret: this.credentials.get(this.credentialRefFor('wecomBotSecretEnv'))?.configured ?? false,
        qqAppSecret: this.credentials.get(this.credentialRefFor('qqAppSecretEnv'))?.configured ?? false,
        telegramBotToken: this.credentials.get(this.credentialRefFor('telegramBotTokenEnv'))?.configured ?? false,
        discordBotToken: this.credentials.get(this.credentialRefFor('discordBotTokenEnv'))?.configured ?? false,
        whatsappAccessToken: this.credentials.get(this.credentialRefFor('whatsappAccessTokenEnv'))?.configured ?? false,
      },
      setupBusy: this.setupBusy,
      ...(this.setupResult === undefined ? {} : { setupResult: this.setupResult }),
    }
  }

  private credentialRefFor(envField: keyof ImSettings): string {
    const configured = this.scope.getSnapshot().value?.[envField]
    return typeof configured === 'string' && configured.trim().length > 0 ? configured.trim() : String(configured ?? '')
  }

  private refreshCredentialRefs(): void {
    for (const envField of Object.values(SECRET_FIELDS)) {
      const ref = this.credentialRefFor(envField)
      if (ref.length === 0) continue
      void this.readCredential(ref)
    }
    const weixinRef = this.credentialRefFor('weixinBotTokenEnv')
    if (weixinRef.length > 0) void this.readCredential(weixinRef)
  }

  private async readCredential(ref: string): Promise<void> {
    if (this.isDisposed() || ref.length === 0) return
    const generation = (this.credentialGeneration.get(ref) ?? 0) + 1
    this.credentialGeneration.set(ref, generation)
    try {
      const response = await this.ctx.remote.credentials.describe([ref])
      if (generation !== this.credentialGeneration.get(ref) || this.isDisposed() || !response.ok) return
      const current = response.value[ref]
      this.credentials.set(ref, { configured: current?.configured ?? false, writable: current?.writable ?? true })
      this.store.set(this.projection())
    } catch {
      if (generation !== this.credentialGeneration.get(ref) || this.isDisposed()) return
      this.credentials.set(ref, { configured: false, writable: false })
      this.store.set(this.projection())
    }
  }

  /** Refresh a credential badge after another Settings surface writes this reference.
   * @param ref - the credential reference reported by the Settings surface.
   */
  refreshCredential(ref: string): void {
    void this.readCredential(ref)
  }

  /** Publish the Host's non-sensitive live connection status for one platform.
   * @param status - the latest Host status frame.
   */
  setConnectionStatus(status: ImIntegrationStatusValue): void {
    if (this.isDisposed()) return
    this.connectionByPlatform.set(status.platform, status)
    this.store.set(this.projection())
  }

  /** Publish a sanitized Client transport diagnostic.
   * @param diagnostic - a gateway code, error name, or reconnect marker without the original message.
   */
  setStatusDiagnostic(diagnostic: string | undefined): void {
    if (this.isDisposed()) return
    this.statusDiagnostic = diagnostic
    this.store.set(this.projection())
  }

  private async writeCredential(envField: keyof ImSettings, value: string): Promise<boolean> {
    if (this.isDisposed()) return false
    const ref = this.credentialRefFor(envField)
    if (ref.length === 0) return false
    const response = await this.ctx.remote.credentials.set(ref, value)
    if (!response.ok) return false
    await this.readCredential(ref)
    return !this.isDisposed() && (this.credentials.get(ref)?.configured ?? false)
  }

  /** Build the Settings slot injection face.
   * @returns the slot hooks and form actions consumed by the Settings page.
   */
  inject(): ImSettingsFace {
    const actions = this.form.actions()
    return {
      hooks: { imSettings: this.store },
      ...actions,
      selectPlatform: (platform) => { this.selectPlatform(platform) },
      commitWeixinAuthorization: authorization => this.commitWeixinAuthorization(authorization),
      clearWeixinAuthorization: () => this.clearWeixinAuthorization(),
    }
  }

  private selectPlatform(platform: ImPlatform): void {
    this.selectedPlatform = platform
    this.form.actions().edit('activePlatform', platform)
    this.store.set(this.projection())
  }

  private async commitWeixinAuthorization(authorization: WeixinAuthorizationPayload): Promise<boolean> {
    if (this.isDisposed() || this.setupBusy) return false
    this.setupBusy = true
    this.setupResult = undefined
    this.store.set(this.projection())
    try {
      const response = await this.ctx.remote.imSetup.commitWeixinAuthorization(authorization)
      if (!response.ok) {
        this.setupResult = 'operation-failed'
        return false
      }
      if (!response.value.ok) {
        this.setupResult = response.value.code
        return false
      }
      this.setupResult = 'complete'
      this.selectedPlatform = 'weixin'
      await this.readCredential(this.credentialRefFor('weixinBotTokenEnv') || 'WEIXIN_BOT_TOKEN')
      return true
    } catch {
      this.setupResult = 'operation-failed'
      return false
    } finally {
      this.setupBusy = false
      this.store.set(this.projection())
    }
  }

  private async clearWeixinAuthorization(): Promise<void> {
    if (this.isDisposed() || this.setupBusy) return
    this.setupBusy = true
    this.store.set(this.projection())
    try {
      const response = await this.ctx.remote.imSetup.clearWeixinAuthorization()
      this.setupResult = response.ok && response.value.ok ? 'complete' : 'operation-failed'
    } catch {
      this.setupResult = 'operation-failed'
    } finally {
      this.setupBusy = false
      this.store.set(this.projection())
    }
  }

  /** Release the form subscription. */
  dispose(): void {
    this.disposed = true
    for (const ref of this.credentialGeneration.keys()) {
      this.credentialGeneration.set(ref, (this.credentialGeneration.get(ref) ?? 0) + 1)
    }
    this.unsubscribe()
    this.form.dispose()
  }
}

function booleanField(field: string) {
  return {
    field,
    format: (value: unknown) => typeof value === 'boolean' ? String(value) : '',
    parse: (text: string) => text === 'true' || text === 'false' ? { kind: 'set' as const, value: text === 'true' } : undefined,
  }
}
