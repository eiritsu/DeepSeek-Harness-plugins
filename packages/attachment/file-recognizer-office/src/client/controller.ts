/** Staged configuration and credential state for the Office recognition page. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** Credential references used by file recognition operations. */
export const OCR_API_KEY_REF = 'DSH_FILE_OFFICE_OCR_API_KEY'
/** Audio transcription credential reference. */
export const AUDIO_API_KEY_REF = 'DSH_FILE_OFFICE_AUDIO_API_KEY'
/** Video understanding credential reference. */
export const VIDEO_API_KEY_REF = 'DSH_FILE_OFFICE_VIDEO_API_KEY'
/** Host Config entry id. */
export const OFFICE_RECOGNITION_NS = 'file-recognizer-office'
const CREDENTIAL_FIELDS = {
  ocr: { ref: OCR_API_KEY_REF, field: 'ocrApiKey' },
  audio: { ref: AUDIO_API_KEY_REF, field: 'audioApiKey' },
  video: { ref: VIDEO_API_KEY_REF, field: 'videoApiKey' },
} as const

/** Editable fields owned by the Host plugin row. */
export interface OfficeRecognitionSettings {
  maxInputBytes?: number
  maxExtractedChars?: number
  maxPdfPages?: number
  ocrEndpoint?: string
  ocrModel?: string
  audioEndpoint?: string
  audioModel?: string
  videoEndpoint?: string
  videoModel?: string
}

/** Projected card state. */
export interface OfficeRecognitionCardState extends SettingsFormShell {
  /** Maximum source bytes parsed in memory. */
  maxInputBytes: SettingsFieldState
  /** Maximum extracted text length. */
  maxExtractedChars: SettingsFieldState
  /** Maximum pages processed from one PDF. */
  maxPdfPages: SettingsFieldState
  /** OCR endpoint. */
  ocrEndpoint: SettingsFieldState
  /** OCR model. */
  ocrModel: SettingsFieldState
  /** Audio transcription endpoint. */
  audioEndpoint: SettingsFieldState
  /** Audio transcription model. */
  audioModel: SettingsFieldState
  /** Video understanding endpoint. */
  videoEndpoint: SettingsFieldState
  /** Video understanding model. */
  videoModel: SettingsFieldState
  /** Staged key field; its value is never returned by the Host. */
  ocrApiKey: SettingsFieldState
  /** Staged audio key field; its value is never returned by the Host. */
  audioApiKey: SettingsFieldState
  /** Staged video key field; its value is never returned by the Host. */
  videoApiKey: SettingsFieldState
  /** Whether the Host has a credential configured. */
  apiKeyConfigured: boolean
  /** Whether the credentials provider accepts writes for this reference. */
  apiKeyWritable: boolean
  /** Whether the audio credentials provider has a key configured. */
  audioApiKeyConfigured: boolean
  /** Whether the audio credentials provider accepts writes. */
  audioApiKeyWritable: boolean
  /** Whether the video credentials provider has a key configured. */
  videoApiKeyConfigured: boolean
  /** Whether the video credentials provider accepts writes. */
  videoApiKeyWritable: boolean
}

/** Slot face supplied to the Plugins settings page. */
export interface OfficeRecognitionCardFace extends SettingsFormActions {
  hooks: { officeRecognitionCard: SnapshotStore<OfficeRecognitionCardState> }
}

interface CredentialState { configured: boolean; writable: boolean }
type CredentialKind = keyof typeof CREDENTIAL_FIELDS

/** Bridges the Host Config form and the OCR credential reference. */
export class OfficeRecognitionCardController {
  private readonly form: SettingsFormModel<OfficeRecognitionSettings>
  private readonly store: SnapshotStore<OfficeRecognitionCardState>
  private readonly credentials: Record<CredentialKind, CredentialState> = {
    ocr: { configured: false, writable: true },
    audio: { configured: false, writable: true },
    video: { configured: false, writable: true },
  }

  /** @param scope - the Host form scope for the recognizer plugin row.
   * @param ctx - the browser context with Host credential operations.
   */
  constructor(scope: SettingsFormScope<OfficeRecognitionSettings>, private readonly ctx: ClientContext) {
    this.form = new SettingsFormModel(scope, [
      settingsNumberField('maxInputBytes'),
      settingsNumberField('maxExtractedChars'),
      settingsNumberField('maxPdfPages'),
      settingsTextField('ocrEndpoint'),
      settingsTextField('ocrModel'),
      settingsTextField('audioEndpoint'),
      settingsTextField('audioModel'),
      settingsTextField('videoEndpoint'),
      settingsTextField('videoModel'),
    ], (Object.keys(CREDENTIAL_FIELDS) as CredentialKind[]).map(kind => ({
      field: CREDENTIAL_FIELDS[kind].field,
      write: (value: string) => this.writeCredential(kind, value),
    })))
    this.store = this.form.bind(() => this.projection())
    void this.readCredential()
  }

  private projection(): OfficeRecognitionCardState {
    return {
      ...this.form.shell(),
      maxInputBytes: this.form.field('maxInputBytes'),
      maxExtractedChars: this.form.field('maxExtractedChars'),
      maxPdfPages: this.form.field('maxPdfPages'),
      ocrEndpoint: this.form.field('ocrEndpoint'),
      ocrModel: this.form.field('ocrModel'),
      audioEndpoint: this.form.field('audioEndpoint'),
      audioModel: this.form.field('audioModel'),
      videoEndpoint: this.form.field('videoEndpoint'),
      videoModel: this.form.field('videoModel'),
      ocrApiKey: this.form.field(CREDENTIAL_FIELDS.ocr.field),
      audioApiKey: this.form.field(CREDENTIAL_FIELDS.audio.field),
      videoApiKey: this.form.field(CREDENTIAL_FIELDS.video.field),
      apiKeyConfigured: this.credentials.ocr.configured,
      apiKeyWritable: this.credentials.ocr.writable,
      audioApiKeyConfigured: this.credentials.audio.configured,
      audioApiKeyWritable: this.credentials.audio.writable,
      videoApiKeyConfigured: this.credentials.video.configured,
      videoApiKeyWritable: this.credentials.video.writable,
    }
  }

  private async readCredential(): Promise<void> {
    const refs = Object.values(CREDENTIAL_FIELDS).map(({ ref }) => ref)
    const response = await this.ctx.remote.credentials.describe(refs)
    if (!response.ok) return
    for (const kind of Object.keys(CREDENTIAL_FIELDS) as CredentialKind[]) {
      const current = response.value[CREDENTIAL_FIELDS[kind].ref]
      this.credentials[kind] = { configured: current?.configured ?? false, writable: current?.writable ?? true }
    }
    this.store.set(this.projection())
  }

  /** Refresh the badge after another Settings page updates the same key.
   * @param ref - the credential reference reported by the Settings page.
   */
  refreshCredential(ref: string): void {
    if (Object.values(CREDENTIAL_FIELDS).some(credential => credential.ref === ref)) void this.readCredential()
  }

  private async writeCredential(kind: CredentialKind, value: string): Promise<boolean> {
    const ref = CREDENTIAL_FIELDS[kind].ref
    const response = await this.ctx.remote.credentials.set(ref, value)
    if (!response.ok) return false
    await this.readCredential()
    return this.credentials[kind].configured
  }

  /** Build the slot injection face.
   * @returns the slot hooks and form actions consumed by the Settings page.
   */
  inject(): OfficeRecognitionCardFace {
    return { hooks: { officeRecognitionCard: this.store }, ...this.form.actions() }
  }

  /** Release form subscriptions. */
  dispose(): void { this.form.dispose() }
}
