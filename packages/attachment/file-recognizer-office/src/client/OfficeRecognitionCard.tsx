/** Settings editor for local extraction limits and remote media recognition. */

import { useId } from 'react'
import { SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { OfficeRecognitionCardFace } from './controller.ts'
import css from './OfficeRecognitionCard.module.css'

/** Renderer-bound props for the bundle detail page. */
export type OfficeRecognitionCardProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'settings.fileRecognition'> & InjectFace<OfficeRecognitionCardFace>

/** Render the staged file-recognition settings on the Office bundle detail page. */
export function OfficeRecognitionCard(props: OfficeRecognitionCardProps) {
  const { t } = props
  const state = props.useOfficeRecognitionCard(snapshot => snapshot)
  const disabled = !state.writable
  const headingId = useId()
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <div className={css.page}>
        <section className={css.section} aria-labelledby={`${headingId}-ocr`}>
          <h3 className={css.heading} id={`${headingId}-ocr`}>{t('ocrGroup')}</h3>
          <SettingsSecretField
            id="plugin-config-office-ocr-key" label={t('apiKey')} hint={t('apiKeyHint')}
            disabled={!state.apiKeyWritable} text={state.ocrApiKey.text} configured={state.apiKeyConfigured}
            stateLabel={state.apiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')}
            onEdit={(text) => { props.edit('ocrApiKey', text) }}
          />
          <SettingsValueField id="plugin-config-office-ocr-endpoint" label={t('endpoint')} hint={t('endpointHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')} disabled={disabled}
            {...state.ocrEndpoint} onEdit={(text) => { props.edit('ocrEndpoint', text) }} onReset={() => { props.resetField('ocrEndpoint') }} />
          <SettingsValueField id="plugin-config-office-ocr-model" label={t('model')} hint={t('modelHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')} disabled={disabled}
            {...state.ocrModel} onEdit={(text) => { props.edit('ocrModel', text) }} onReset={() => { props.resetField('ocrModel') }} />
        </section>
        <section className={css.section} aria-labelledby={`${headingId}-audio`}>
          <h3 className={css.heading} id={`${headingId}-audio`}>{t('audioGroup')}</h3>
          <SettingsSecretField
            id="plugin-config-office-audio-key" label={t('audioApiKey')} hint={t('audioApiKeyHint')}
            disabled={!state.audioApiKeyWritable} text={state.audioApiKey.text} configured={state.audioApiKeyConfigured}
            stateLabel={state.audioApiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')}
            onEdit={(text) => { props.edit('audioApiKey', text) }}
          />
          <SettingsValueField id="plugin-config-office-audio-endpoint" label={t('audioEndpoint')} hint={t('audioEndpointHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')} disabled={disabled}
            {...state.audioEndpoint} onEdit={(text) => { props.edit('audioEndpoint', text) }} onReset={() => { props.resetField('audioEndpoint') }} />
          <SettingsValueField id="plugin-config-office-audio-model" label={t('audioModel')} hint={t('audioModelHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')} disabled={disabled}
            {...state.audioModel} onEdit={(text) => { props.edit('audioModel', text) }} onReset={() => { props.resetField('audioModel') }} />
        </section>
        <section className={css.section} aria-labelledby={`${headingId}-video`}>
          <h3 className={css.heading} id={`${headingId}-video`}>{t('videoGroup')}</h3>
          <SettingsSecretField
            id="plugin-config-office-video-key" label={t('videoApiKey')} hint={t('videoApiKeyHint')}
            disabled={!state.videoApiKeyWritable} text={state.videoApiKey.text} configured={state.videoApiKeyConfigured}
            stateLabel={state.videoApiKeyConfigured ? t('apiKeySet') : t('apiKeyUnset')}
            onEdit={(text) => { props.edit('videoApiKey', text) }}
          />
          <SettingsValueField id="plugin-config-office-video-endpoint" label={t('videoEndpoint')} hint={t('videoEndpointHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')} disabled={disabled}
            {...state.videoEndpoint} onEdit={(text) => { props.edit('videoEndpoint', text) }} onReset={() => { props.resetField('videoEndpoint') }} />
          <SettingsValueField id="plugin-config-office-video-model" label={t('videoModel')} hint={t('videoModelHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')} disabled={disabled}
            {...state.videoModel} onEdit={(text) => { props.edit('videoModel', text) }} onReset={() => { props.resetField('videoModel') }} />
        </section>
        <section className={css.section} aria-labelledby={`${headingId}-limits`}>
          <h3 className={css.heading} id={`${headingId}-limits`}>{t('limitsGroup')}</h3>
          <SettingsValueField id="plugin-config-office-max-input" label={t('maxInputBytes')} hint={t('maxInputBytesHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')} numeric disabled={disabled}
            {...state.maxInputBytes} onEdit={(text) => { props.edit('maxInputBytes', text) }} onReset={() => { props.resetField('maxInputBytes') }} />
          <SettingsValueField id="plugin-config-office-max-text" label={t('maxExtractedChars')} hint={t('maxExtractedCharsHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')} numeric disabled={disabled}
            {...state.maxExtractedChars} onEdit={(text) => { props.edit('maxExtractedChars', text) }} onReset={() => { props.resetField('maxExtractedChars') }} />
          <SettingsValueField id="plugin-config-office-max-pdf-pages" label={t('maxPdfPages')} hint={t('maxPdfPagesHint')}
            overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')} numeric disabled={disabled}
            {...state.maxPdfPages} onEdit={(text) => { props.edit('maxPdfPages', text) }} onReset={() => { props.resetField('maxPdfPages') }} />
        </section>
      </div>
    </SettingsForm>
  )
}
