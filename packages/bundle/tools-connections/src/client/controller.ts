import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Settings stored in the Host plugin's config namespace. */
export interface Settings {
  braveEnabled?: boolean
  braveApiKeyRef?: string
  braveBaseURL?: string
  tavilyEnabled?: boolean
  tavilyApiKeyRef?: string
  tavilyBaseURL?: string
  maxResults?: number
  firecrawlEnabled?: boolean
  firecrawlApiKeyRef?: string
  firecrawlBaseURL?: string
  firecrawlRequestTimeoutMs?: number
  firecrawlMaxResponseBytes?: number
  firecrawlMaxMarkdownChars?: number
}

interface CredentialState { ref: string; configured: boolean; writable: boolean }

/** Settings snapshot shown by the card. */
export interface CardState extends SettingsFormShell {
  braveEnabled: SettingsFieldState
  braveApiKeyRef: SettingsFieldState
  braveBaseURL: SettingsFieldState
  tavilyEnabled: SettingsFieldState
  tavilyApiKeyRef: SettingsFieldState
  tavilyBaseURL: SettingsFieldState
  maxResults: SettingsFieldState
  firecrawlEnabled: SettingsFieldState
  firecrawlApiKeyRef: SettingsFieldState
  firecrawlBaseURL: SettingsFieldState
  firecrawlRequestTimeoutMs: SettingsFieldState
  firecrawlMaxResponseBytes: SettingsFieldState
  firecrawlMaxMarkdownChars: SettingsFieldState
  braveKeyConfigured: boolean
  braveKeyWritable: boolean
  tavilyKeyConfigured: boolean
  tavilyKeyWritable: boolean
  firecrawlKeyConfigured: boolean
  firecrawlKeyWritable: boolean
  braveKey: SettingsFieldState
  tavilyKey: SettingsFieldState
  firecrawlKey: SettingsFieldState
}

/** Slot face passed to the Plugins page renderer. */
export interface CardFace extends SettingsFormActions {
  hooks: { toolsConnections: SnapshotStore<CardState> }
}

const DEFAULT_REFS = { brave: 'BRAVE_SEARCH_API_KEY', tavily: 'TAVILY_API_KEY', firecrawl: 'FIRECRAWL_API_KEY' } as const
const SECRET_FIELDS = { brave: 'braveKey', tavily: 'tavilyKey', firecrawl: 'firecrawlKey' } as const
type ProviderName = keyof typeof DEFAULT_REFS

/** Stages provider settings and writes API keys through the credentials service. */
export class ToolsConnectionsController {
  private readonly form: SettingsFormModel<Settings>
  private readonly store: SnapshotStore<CardState>
  private credentialGeneration = 0
  private disposed = false
  private credentials: Record<ProviderName, CredentialState> = {
    brave: { ref: DEFAULT_REFS.brave, configured: false, writable: true },
    tavily: { ref: DEFAULT_REFS.tavily, configured: false, writable: true },
    firecrawl: { ref: DEFAULT_REFS.firecrawl, configured: false, writable: true },
  }
  private readonly unsubscribe: () => void

  constructor(private readonly scope: SettingsFormScope<Settings>, private readonly ctx: ClientContext) {
    this.form = new SettingsFormModel(scope, [
      booleanField('braveEnabled'), settingsTextField('braveApiKeyRef'), settingsTextField('braveBaseURL'),
      booleanField('tavilyEnabled'), settingsTextField('tavilyApiKeyRef'), settingsTextField('tavilyBaseURL'),
      settingsNumberField('maxResults'),
      booleanField('firecrawlEnabled'), settingsTextField('firecrawlApiKeyRef'), settingsTextField('firecrawlBaseURL'),
      settingsNumberField('firecrawlRequestTimeoutMs'), settingsNumberField('firecrawlMaxResponseBytes'), settingsNumberField('firecrawlMaxMarkdownChars'),
    ], [
      { field: SECRET_FIELDS.brave, write: value => this.writeCredential('brave', value) },
      { field: SECRET_FIELDS.tavily, write: value => this.writeCredential('tavily', value) },
      { field: SECRET_FIELDS.firecrawl, write: value => this.writeCredential('firecrawl', value) },
    ])
    this.store = this.form.bind(() => this.projection())
    this.unsubscribe = scope.subscribe(() => { void this.readCredentials() })
    void this.readCredentials()
  }

  private projection(): CardState {
    return {
      ...this.form.shell(),
      braveEnabled: this.form.field('braveEnabled'), braveApiKeyRef: this.form.field('braveApiKeyRef'),
      braveBaseURL: this.form.field('braveBaseURL'), tavilyEnabled: this.form.field('tavilyEnabled'),
      tavilyApiKeyRef: this.form.field('tavilyApiKeyRef'), tavilyBaseURL: this.form.field('tavilyBaseURL'),
      maxResults: this.form.field('maxResults'),
      firecrawlEnabled: this.form.field('firecrawlEnabled'), firecrawlApiKeyRef: this.form.field('firecrawlApiKeyRef'),
      firecrawlBaseURL: this.form.field('firecrawlBaseURL'), firecrawlRequestTimeoutMs: this.form.field('firecrawlRequestTimeoutMs'),
      firecrawlMaxResponseBytes: this.form.field('firecrawlMaxResponseBytes'), firecrawlMaxMarkdownChars: this.form.field('firecrawlMaxMarkdownChars'),
      braveKey: this.form.field(SECRET_FIELDS.brave), tavilyKey: this.form.field(SECRET_FIELDS.tavily),
      firecrawlKey: this.form.field(SECRET_FIELDS.firecrawl),
      braveKeyConfigured: this.credentials.brave.configured, braveKeyWritable: this.credentials.brave.writable,
      tavilyKeyConfigured: this.credentials.tavily.configured, tavilyKeyWritable: this.credentials.tavily.writable,
      firecrawlKeyConfigured: this.credentials.firecrawl.configured, firecrawlKeyWritable: this.credentials.firecrawl.writable,
    }
  }

  private async readCredentials(): Promise<void> {
    if (this.disposed) return
    const generation = ++this.credentialGeneration
    const refs = this.currentRefs()
    for (const name of ['brave', 'tavily', 'firecrawl'] as const) {
      const ref = refs[name]
      if (this.credentials[name].ref !== ref) this.credentials[name] = { ref, configured: false, writable: true }
    }
    this.store.set(this.projection())
    try {
      const response = await this.ctx.remote.credentials.describe([refs.brave, refs.tavily, refs.firecrawl])
      if (generation !== this.credentialGeneration || !response.ok || !sameRefs(refs, this.currentRefs())) return
      for (const name of ['brave', 'tavily', 'firecrawl'] as const) {
        const view = response.value[refs[name]]
        this.credentials[name] = { ref: refs[name], configured: view?.configured ?? false, writable: view?.writable ?? true }
      }
      this.store.set(this.projection())
    } catch {
      if (generation !== this.credentialGeneration || !sameRefs(refs, this.currentRefs())) return
      for (const name of ['brave', 'tavily', 'firecrawl'] as const) {
        this.credentials[name] = { ref: refs[name], configured: false, writable: false }
      }
      this.store.set(this.projection())
    }
  }

  refreshCredential(ref: string): void {
    if (Object.values(this.credentials).some(item => item.ref === ref)) void this.readCredentials()
  }

  private async writeCredential(name: ProviderName, value: string): Promise<boolean> {
    const key = `${name}ApiKeyRef`
    const fallback = DEFAULT_REFS[name]
    const ref = refOf(this.form.field(key).text, fallback)
    const written = await this.ctx.remote.credentials.set(ref, value)
    if (!written.ok) return false
    const response = await this.ctx.remote.credentials.describe([ref])
    if (this.disposed || !response.ok || ref !== this.currentRefs()[name]) return false
    const view = response.value[ref]
    this.credentials[name] = { ref, configured: view?.configured ?? false, writable: view?.writable ?? true }
    this.store.set(this.projection())
    return this.credentials[name].configured
  }

  inject(): CardFace {
    return {
      hooks: { toolsConnections: this.store }, ...this.form.actions(),
    }
  }
  dispose(): void { this.disposed = true; this.credentialGeneration++; this.unsubscribe(); this.form.dispose() }

  private currentRefs(): Record<ProviderName, string> {
    const value = this.scope.getSnapshot().value
    return {
      brave: refOf(value?.braveApiKeyRef, DEFAULT_REFS.brave), tavily: refOf(value?.tavilyApiKeyRef, DEFAULT_REFS.tavily),
      firecrawl: refOf(value?.firecrawlApiKeyRef, DEFAULT_REFS.firecrawl),
    }
  }
}

function booleanField(field: string) {
  return { field, format: (value: unknown) => typeof value === 'boolean' ? String(value) : '',
    parse: (text: string) => text === 'true' || text === 'false' ? { kind: 'set' as const, value: text === 'true' } : undefined }
}

function refOf(value: string | undefined, fallback: string): string { return value?.trim() || fallback }
function sameRefs(left: Record<ProviderName, string>, right: Record<ProviderName, string>): boolean {
  return left.brave === right.brave && left.tavily === right.tavily && left.firecrawl === right.firecrawl
}
