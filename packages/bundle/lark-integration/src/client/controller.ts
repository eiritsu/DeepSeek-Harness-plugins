/** Staged Lark configuration and write-only application credential state. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { LarkIntegrationStatusValue } from '@deepseek-ai/dsh-lark-integration/types'
import {
  SettingsFormModel, settingsNumberField, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Host Config row id. */
export const LARK_CONFIG_NS = 'lark'
/** Secret reference resolved by the Host channel plugin. */
export const LARK_APP_SECRET_REF = 'LARK_APP_SECRET'
const SECRET_FIELD = 'appSecret'

/** Editable Lark Host Config values. */
export interface LarkSettings {
  appId?: string
  appSecretEnv?: string
  brand?: 'feishu' | 'lark'
  authorizedUserOpenId?: string
  enabled?: boolean
  registrationTimeoutMs?: number
  cliEnabled?: boolean
  cliTimeoutMs?: number
  cliMaxOutputBytes?: number
  cliGraceMs?: number
  conversationCwd?: string
}

/** Settings page state. */
export interface LarkSettingsState extends SettingsFormShell {
  appId: SettingsFieldState
  appSecretEnv: SettingsFieldState
  brand: SettingsFieldState
  authorizedUserOpenId: SettingsFieldState
  enabled: SettingsFieldState
  registrationTimeoutMs: SettingsFieldState
  cliEnabled: SettingsFieldState
  cliTimeoutMs: SettingsFieldState
  cliMaxOutputBytes: SettingsFieldState
  cliGraceMs: SettingsFieldState
  conversationCwd: SettingsFieldState
  connectionStatus: LarkIntegrationStatusValue
  statusDiagnostic?: string
  appSecret: SettingsFieldState
  appSecretConfigured: boolean
  appSecretWritable: boolean
  connectionPath: 'quick' | 'existing'
  setupBusy: boolean
  verificationUrl?: string
  pendingFlow?: 'registration' | 'user-authorization'
  /** Summary of the saved Host device authorization, refreshed from credentials. */
  pendingAuthorization?: {
    readonly appId: string
    readonly brand: 'feishu' | 'lark'
    readonly appSecretEnv: string
    readonly createdAt: number
    readonly matchesIdentity: boolean
    readonly expired: boolean
  }
  setupResult?: 'complete' | 'cancelled' | 'expired' | 'not-configured' | 'not-ready' | 'operation-failed' | 'unsupported-url'
}

/** Slot face passed to the Settings renderer. */
export interface LarkSettingsFace extends SettingsFormActions {
  hooks: { larkSettings: SnapshotStore<LarkSettingsState> }
  chooseConnectionPath(path: 'quick' | 'existing'): void
  beginQuickConnect(brand: 'feishu' | 'lark'): Promise<void>
  completeQuickConnect(): Promise<void>
  beginUserAuthorization(): Promise<void>
  completeUserAuthorization(): Promise<void>
  cancelSetupFlow(): Promise<void>
}

interface CredentialState { configured: boolean; writable: boolean }

/** Connects the profile Config form to the write-only Secret reference. */
export class LarkSettingsController {
  private readonly form: SettingsFormModel<LarkSettings>
  private readonly store: SnapshotStore<LarkSettingsState>
  private credential: CredentialState = { configured: false, writable: true }
  private credentialRef = LARK_APP_SECRET_REF
  private credentialGeneration = 0
  private disposed = false
  private connectionStatus: LarkIntegrationStatusValue = { state: 'disabled' }
  private statusDiagnostic: string | undefined
  private connectionPath: 'quick' | 'existing' = 'quick'
  private connectionPathSelected = false
  private setupBusy = false
  private verificationUrl: string | undefined
  private pendingFlow: LarkSettingsState['pendingFlow']
  private pendingAuthorization: LarkSettingsState['pendingAuthorization']
  private setupResult: LarkSettingsState['setupResult']
  private readonly unsubscribe: () => void

  /** @param scope - the Host Config form for the Lark plugin.
   * @param ctx - browser context with Host credential operations.
   */
  constructor(private readonly scope: SettingsFormScope<LarkSettings>, private readonly ctx: ClientContext) {
    this.form = new SettingsFormModel(scope, [
      settingsTextField('appId'), settingsTextField('appSecretEnv'), settingsTextField('brand'),
      settingsTextField('authorizedUserOpenId'), booleanField('enabled'), booleanField('cliEnabled'),
      settingsNumberField('registrationTimeoutMs'),
      settingsNumberField('cliTimeoutMs'), settingsNumberField('cliMaxOutputBytes'), settingsNumberField('cliGraceMs'),
      settingsTextField('conversationCwd'),
    ], [
      { field: SECRET_FIELD, write: value => this.writeCredential(value) },
    ])
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => { this.refreshCredentialRef() })
    this.refreshCredentialRef()
    void this.readCredential()
    void this.readPendingAuthorization()
  }

  /** Read the live disposal latch; the call keeps an awaiting caller from reusing a narrowed value. */
  private isDisposed(): boolean {
    return this.disposed
  }

  private projection(): LarkSettingsState {
    return {
      ...this.form.shell(),
      appId: this.form.field('appId'),
      appSecretEnv: this.form.field('appSecretEnv'),
      brand: this.form.field('brand'),
      authorizedUserOpenId: this.form.field('authorizedUserOpenId'),
      enabled: this.form.field('enabled'),
      registrationTimeoutMs: this.form.field('registrationTimeoutMs'),
      cliEnabled: this.form.field('cliEnabled'),
      cliTimeoutMs: this.form.field('cliTimeoutMs'),
      cliMaxOutputBytes: this.form.field('cliMaxOutputBytes'),
      cliGraceMs: this.form.field('cliGraceMs'),
      conversationCwd: this.form.field('conversationCwd'),
      connectionStatus: this.connectionStatus,
      ...(this.statusDiagnostic === undefined ? {} : { statusDiagnostic: this.statusDiagnostic }),
      appSecret: this.form.field(SECRET_FIELD),
      appSecretConfigured: this.credential.configured,
      appSecretWritable: this.credential.writable,
      connectionPath: this.connectionPath,
      setupBusy: this.setupBusy,
      ...(this.verificationUrl === undefined ? {} : { verificationUrl: this.verificationUrl }),
      ...(this.pendingFlow === undefined ? {} : { pendingFlow: this.pendingFlow }),
      ...(this.pendingAuthorization === undefined ? {} : { pendingAuthorization: this.pendingAuthorization }),
      ...(this.setupResult === undefined ? {} : { setupResult: this.setupResult }),
    }
  }

  private refreshCredentialRef(): void {
    const configured = this.scope.getSnapshot().value?.appSecretEnv?.trim()
    const next = configured || LARK_APP_SECRET_REF
    if (next === this.credentialRef) return
    this.credentialRef = next
    this.credential = { configured: false, writable: true }
    this.store.set(this.projection())
    void this.readCredential()
  }

  private async readCredential(): Promise<void> {
    if (this.isDisposed()) return
    const ref = this.credentialRef
    const generation = ++this.credentialGeneration
    try {
      const response = await this.ctx.remote.credentials.describe([ref])
      if (generation !== this.credentialGeneration || ref !== this.credentialRef || this.isDisposed() || !response.ok) return
      const current = response.value[ref]
      this.credential = { configured: current?.configured ?? false, writable: current?.writable ?? true }
      if (!this.connectionPathSelected && this.credential.configured
        && (this.scope.getSnapshot().value?.appId ?? '').trim()) this.connectionPath = 'existing'
      this.store.set(this.projection())
    } catch {
      if (generation !== this.credentialGeneration || ref !== this.credentialRef || this.isDisposed()) return
      this.credential = { configured: false, writable: false }
      this.store.set(this.projection())
    }
  }

  /** Refresh the credential badge after another Settings surface writes this reference.
   * @param ref - the credential reference reported by the Settings surface.
   */
  refreshCredential(ref: string): void {
    if (ref === this.credentialRef) void this.readCredential()
  }

  /** Publish the Host's non-sensitive live connection status.
   * @param status - the latest Host status frame.
   */
  setConnectionStatus(status: LarkIntegrationStatusValue): void {
    if (this.isDisposed()) return
    this.connectionStatus = status
    this.store.set(this.projection())
  }

  /** Publish a sanitized Client transport diagnostic for the Advanced section.
   * @param diagnostic - a gateway code, error name, or reconnect marker without the original message.
   */
  setStatusDiagnostic(diagnostic: string | undefined): void {
    if (this.isDisposed()) return
    this.statusDiagnostic = diagnostic
    this.store.set(this.projection())
  }

  private async writeCredential(value: string): Promise<boolean> {
    if (this.isDisposed()) return false
    const ref = this.credentialRef
    const response = await this.ctx.remote.credentials.set(ref, value)
    if (!response.ok) return false
    await this.readCredential()
    return !this.isDisposed() && ref === this.credentialRef && this.credential.configured
  }

  /** Build the Settings slot injection face.
   * @returns the slot hooks and form actions consumed by the Settings page.
   */
  inject(): LarkSettingsFace {
    const actions = this.form.actions()
    return {
      hooks: { larkSettings: this.store }, ...actions,
      edit: (field, text) => {
        if (this.pendingFlow !== undefined && ['appId', 'brand', 'appSecretEnv', 'appSecret'].includes(field)) {
          void this.cancelRemoteFlow()
        }
        actions.edit(field, text)
      },
      chooseConnectionPath: (path) =>{  this.chooseConnectionPath(path) },
      beginQuickConnect: brand => this.beginQuickConnect(brand),
      completeQuickConnect: () => this.completeQuickConnect(),
      beginUserAuthorization: () => this.beginUserAuthorization(),
      completeUserAuthorization: () => this.completeUserAuthorization(),
      cancelSetupFlow: () => this.cancelSetupFlow(),
    }
  }

  private chooseConnectionPath(path: 'quick' | 'existing'): void {
    if (this.pendingFlow !== undefined) void this.cancelRemoteFlow()
    this.connectionPathSelected = true
    this.connectionPath = path
    this.verificationUrl = undefined
    this.pendingFlow = undefined
    this.setupResult = undefined
    this.store.set(this.projection())
  }

  private async beginQuickConnect(brand: 'feishu' | 'lark'): Promise<void> {
    this.connectionPathSelected = true
    await this.performSetup(async () => {
      const response = await this.ctx.remote.larkSetup.beginQuickConnect(brand)
      const result = remoteValue(response)
      if (result === undefined) { this.setupResult = 'operation-failed'; return }
      if (!result.ok) { this.setupResult = result.code; return }
      this.verificationUrl = result.verificationUrl
      this.pendingFlow = 'registration'
    })
  }

  private async completeQuickConnect(): Promise<void> {
    await this.performSetup(async () => {
      const response = await this.ctx.remote.larkSetup.completeQuickConnect()
      const result = remoteValue(response)
      if (result === undefined) { this.setupResult = 'operation-failed'; return }
      if (!result.ok) { this.setupResult = result.code; return }
      this.verificationUrl = undefined
      this.pendingFlow = undefined
      this.setupResult = 'complete'
      await this.readCredential()
    })
  }

  private async beginUserAuthorization(): Promise<void> {
    this.connectionPathSelected = true
    await this.performSetup(async () => {
      await this.form.save()
      await this.readCredential()
      const shell = this.form.shell()
      const saved = this.scope.getSnapshot()
      if (!saved.writable || shell.failed || shell.dirty || shell.invalid || !this.credential.configured
        || !(saved.value?.appId ?? '').trim()) {
        this.setupResult = 'not-configured'
        return
      }
      const response = await this.ctx.remote.larkSetup.beginUserAuthorization()
      const result = remoteValue(response)
      if (result === undefined) { this.setupResult = 'operation-failed'; return }
      if (!result.ok) { this.setupResult = result.code; return }
      this.verificationUrl = result.verificationUrl
      this.pendingFlow = 'user-authorization'
      this.setupResult = undefined
      await this.readPendingAuthorization()
    })
  }

  private async completeUserAuthorization(): Promise<void> {
    await this.performSetup(async () => {
      const response = await this.ctx.remote.larkSetup.completeUserAuthorization()
      const result = remoteValue(response)
      if (result === undefined) { this.setupResult = 'operation-failed'; return }
      if (!result.ok) { this.setupResult = result.code; return }
      this.verificationUrl = undefined
      this.pendingFlow = undefined
      this.pendingAuthorization = undefined
      this.setupResult = 'complete'
      this.store.set(this.projection())
    })
  }

  private async cancelSetupFlow(): Promise<void> {
    if (this.isDisposed()) return
    this.setupResult = await this.cancelRemoteFlow()
    await this.readPendingAuthorization()
    this.store.set(this.projection())
  }

  private async cancelRemoteFlow(): Promise<NonNullable<LarkSettingsState['setupResult']>> {
    this.verificationUrl = undefined
    this.pendingFlow = undefined
    this.store.set(this.projection())
    try {
      const result = await this.ctx.remote.larkSetup.cancelSetupFlow()
      if (!result.ok) return 'operation-failed'
      return result.value.completed ? 'complete' : 'cancelled'
    } catch {
      return 'operation-failed'
    }
  }

  private async readPendingAuthorization(): Promise<void> {
    if (this.isDisposed()) return
    const response = await this.ctx.remote.larkSetup.describePendingUserAuthorization()
    if (this.isDisposed() || !response.ok) return
    if (!response.value.exists) {
      this.pendingAuthorization = undefined
    } else {
      const value = response.value
      this.pendingAuthorization = {
        appId: value.appId, brand: value.brand, appSecretEnv: value.appSecretEnv,
        createdAt: value.createdAt, matchesIdentity: value.matchesIdentity, expired: value.expired,
      }
    }
    this.store.set(this.projection())
  }

  private async performSetup(operation: () => Promise<void>): Promise<void> {
    if (this.isDisposed() || this.setupBusy) return
    this.setupBusy = true
    this.setupResult = undefined
    this.store.set(this.projection())
    try {
      await operation()
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
    this.credentialGeneration++
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

function remoteValue<T>(
  response: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown },
): T | undefined {
  return response.ok ? response.value : undefined
}
