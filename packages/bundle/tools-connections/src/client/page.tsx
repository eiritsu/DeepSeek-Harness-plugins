import { SettingsForm, SettingsSecretField, SettingsValueField, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels, type LocaleKey } from './locales.ts'
import type { CardFace } from './controller.ts'
import css from './page.module.css'

/** Renderer-bound props for the bundle's Tools & connections settings. */
export type ToolsConnectionsCardProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'settings.toolsConnections'> & InjectFace<CardFace>

/** Render search-provider and Firecrawl controls in this bundle's Plugins detail page. */
export function ToolsConnectionsCard(props: ToolsConnectionsCardProps) {
  const { t } = props
  const state = props.useToolsConnections(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  const field = (id: string, key: 'braveApiKeyRef' | 'braveBaseURL' | 'tavilyApiKeyRef' | 'tavilyBaseURL' | 'maxResults' | 'firecrawlApiKeyRef' | 'firecrawlBaseURL' | 'firecrawlRequestTimeoutMs' | 'firecrawlMaxResponseBytes' | 'firecrawlMaxMarkdownChars') => {
    const labelKey: LocaleKey = key.endsWith('ApiKeyRef') ? 'reference' : key.endsWith('BaseURL') ? 'endpoint' : key === 'maxResults' ? 'maxResults' : key === 'firecrawlRequestTimeoutMs' ? 'requestTimeout' : key === 'firecrawlMaxResponseBytes' ? 'maxResponseBytes' : 'maxMarkdownChars'
    const hintKey: LocaleKey = key.endsWith('ApiKeyRef') ? 'referenceHint' : key.endsWith('BaseURL') ? 'endpointHint' : key === 'maxResults' ? 'maxResultsHint' : key === 'firecrawlRequestTimeoutMs' ? 'requestTimeoutHint' : key === 'firecrawlMaxResponseBytes' ? 'maxResponseBytesHint' : 'maxMarkdownCharsHint'
    return <SettingsValueField id={id} label={t(labelKey)} hint={t(hintKey)} overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')}
      disabled={disabled} numeric={key !== 'braveApiKeyRef' && key !== 'braveBaseURL' && key !== 'tavilyApiKeyRef' && key !== 'tavilyBaseURL' && key !== 'firecrawlApiKeyRef' && key !== 'firecrawlBaseURL'} {...state[key]} onEdit={(text) =>{  props.edit(key, text) }} onReset={() =>{  props.resetField(key) }} />
  }
  return <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
    <div className={css.section}>
      <section>
        <h3>{t('brave')}</h3>
        <Switch checked={state.braveEnabled.text === 'true'} label={t('braveEnabled')} disabled={disabled} onChange={(value) =>{  props.edit('braveEnabled', String(value)) }} />
        <SettingsSecretField id="tools-connections-brave-key" label={t('apiKey')} hint={t('keyHint')} disabled={!state.braveKeyWritable}
          text={state.braveKey.text} configured={state.braveKeyConfigured} stateLabel={state.braveKeyConfigured ? t('keySet') : t('keyMissing')}
          onEdit={(text) =>{  props.edit('braveKey', text) }} />
        {field('tools-connections-brave-ref', 'braveApiKeyRef')}{field('tools-connections-brave-endpoint', 'braveBaseURL')}
      </section>
      <section>
        <h3>{t('firecrawl')}</h3>
        <Switch checked={state.firecrawlEnabled.text === 'true'} label={t('firecrawlEnabled')} disabled={disabled} onChange={(value) =>{  props.edit('firecrawlEnabled', String(value)) }} />
        <SettingsSecretField id="tools-connections-firecrawl-key" label={t('apiKey')} hint={t('keyHint')} disabled={!state.firecrawlKeyWritable}
          text={state.firecrawlKey.text} configured={state.firecrawlKeyConfigured} stateLabel={state.firecrawlKeyConfigured ? t('keySet') : t('keyMissing')}
          onEdit={(text) =>{  props.edit('firecrawlKey', text) }} />
        {field('tools-connections-firecrawl-ref', 'firecrawlApiKeyRef')}{field('tools-connections-firecrawl-endpoint', 'firecrawlBaseURL')}
        {field('tools-connections-firecrawl-timeout', 'firecrawlRequestTimeoutMs')}{field('tools-connections-firecrawl-response-bytes', 'firecrawlMaxResponseBytes')}{field('tools-connections-firecrawl-markdown-chars', 'firecrawlMaxMarkdownChars')}
      </section>
      <section>
        <h3>{t('tavily')}</h3>
        <Switch checked={state.tavilyEnabled.text === 'true'} label={t('tavilyEnabled')} disabled={disabled} onChange={(value) =>{  props.edit('tavilyEnabled', String(value)) }} />
        <SettingsSecretField id="tools-connections-tavily-key" label={t('apiKey')} hint={t('keyHint')} disabled={!state.tavilyKeyWritable}
          text={state.tavilyKey.text} configured={state.tavilyKeyConfigured} stateLabel={state.tavilyKeyConfigured ? t('keySet') : t('keyMissing')}
          onEdit={(text) =>{  props.edit('tavilyKey', text) }} />
        {field('tools-connections-tavily-ref', 'tavilyApiKeyRef')}{field('tools-connections-tavily-endpoint', 'tavilyBaseURL')}
      </section>
      <section>
        <h3>{t('provider')}</h3>
        <p className={css.hint}>{t('providerHint')}</p>
        <p className={css.hint}>{t('otherPlugins')}</p>
        {field('tools-connections-max-results', 'maxResults')}
      </section>
    </div>
  </SettingsForm>
}
