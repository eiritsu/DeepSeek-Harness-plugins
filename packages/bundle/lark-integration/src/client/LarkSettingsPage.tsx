/** Lark application settings on its bundle detail page. */

import { Button, SettingsForm, SettingsSecretField, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './LarkSettingsPage.module.css'
import { formLabels, type LarkLocaleKey } from './locales.ts'
import type { LarkSettingsFace, LarkSettingsState } from './controller.ts'

/** Renderer-bound props for the Lark bundle detail page. */
export type LarkSettingsPageProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'settings.lark'> & InjectFace<LarkSettingsFace>

/** Render Lark identity and credential state without exposing the credential value. */
export function LarkSettingsPage(props: LarkSettingsPageProps) {
  const { t } = props
  const state = props.useLarkSettings(snapshot => snapshot)
  const disabled = !state.writable
  const setupLabels: Record<NonNullable<LarkSettingsState['setupResult']>, LarkLocaleKey> = {
    complete: 'setupComplete', cancelled: 'setupCancelled', expired: 'setupExpired',
    'not-configured': 'setupNotConfigured', 'not-ready': 'setupNotReady',
    'operation-failed': 'setupFailed', 'unsupported-url': 'setupUnsupportedUrl',
  }
  const status = state.connectionStatus
  const stateLabel: Record<typeof status.state, LarkLocaleKey> = {
    disabled: 'statusDisabled', connecting: 'statusConnecting', connected: 'statusConnected',
    error: 'statusError', unavailable: 'statusUnavailable',
  }
  const pendingAuthorization = status.state === 'error' && status.reason === 'missing-identity'
  const reasonLabel: LarkLocaleKey | undefined = pendingAuthorization ? 'statusPendingAuthorization'
    : status.reason === 'missing-credential' ? 'statusMissingCredential'
      : status.reason === 'connection-failed' ? 'statusConnectionFailed'
        : undefined
  const statusTone: 'pending' | 'error' | undefined = pendingAuthorization ? 'pending'
    : status.state === 'error' && status.reason === 'connection-failed' ? 'error'
      : status.state === 'error' && status.reason === 'missing-credential' ? 'error'
        : undefined
  const stateHeading: LarkLocaleKey = pendingAuthorization ? 'statusPendingAuthorization'
    : stateLabel[status.state]
  const resumableAuthorization = state.pendingAuthorization?.matchesIdentity === true
    && state.pendingAuthorization?.expired === false
    ? state.pendingAuthorization
    : undefined
  const expiredAuthorization = state.pendingAuthorization?.matchesIdentity === true
    && state.pendingAuthorization?.expired === true
    ? state.pendingAuthorization
    : undefined
  const pendingFlow = state.pendingFlow
  const isQuick = state.connectionPath === 'quick'
  const brand = state.brand.text === 'lark' ? 'lark' : 'feishu'
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <div className={css.page}>
        <section className={css.section}>
          <h3>{t('connectionStatus')}</h3>
          <div
            className={css.statusBanner}
            data-state={status.state}
            data-tone={statusTone}
            role="status"
            aria-live="polite"
          >
            <div className={css.statusHeading}>
              <span className={css.statusLabel}>{t(stateHeading)}</span>
              {statusTone === 'pending' && <span className={css.statusBadge}>{t('authorizationBadgePending')}</span>}
              {statusTone === 'error' && <span className={css.statusBadge}>{t('authorizationBadgeOpen')}</span>}
            </div>
            {pendingAuthorization && <p className={css.statusReason}>{t('statusMissingIdentityHint')}</p>}
            {reasonLabel !== undefined && !pendingAuthorization && <p className={css.statusReason}>{t(reasonLabel)}</p>}
          </div>
        </section>

        <section className={css.section}>
          <h3>{t('brand')}</h3>
          <div className={css.field}>
            <label className={css.label} htmlFor="lark-brand">{t('brand')}</label>
            <select id="lark-brand" className={css.select} disabled={disabled} value={brand}
              onChange={(event) => { props.edit('brand', event.currentTarget.value) }}>
              <option value="feishu">{t('feishu')}</option>
              <option value="lark">{t('lark')}</option>
            </select>
          </div>
          <fieldset className={css.paths} disabled={disabled || state.setupBusy}>
            <legend>{t('connectionPath')}</legend>
            <label className={css.pathOption}>
              <input type="radio" name="lark-connection-path" checked={isQuick}
                onChange={() => props.chooseConnectionPath('quick')} />
              <span><strong>{t('quickPath')}</strong><small>{t('quickPathHint')}</small></span>
            </label>
            <label className={css.pathOption}>
              <input type="radio" name="lark-connection-path" checked={!isQuick}
                onChange={() => props.chooseConnectionPath('existing')} />
              <span><strong>{t('existingPath')}</strong><small>{t('existingPathHint')}</small></span>
            </label>
          </fieldset>
          {isQuick ? (
            <div className={css.flow}>
              <Button variant="outline" disabled={disabled || state.setupBusy} onClick={() => { void props.beginQuickConnect(brand) }}>
                {t('startQuickConnect')}
              </Button>
            </div>
          ) : (
            <div className={css.fieldGroup}>
              <SettingsValueField id="lark-app-id" label={t('appId')} hint={t('appIdHint')} overriddenLabel={t('overridden')}
                resetLabel={t('reset')} invalidLabel={t('invalid')} disabled={disabled} {...state.appId}
                onEdit={(text) => { props.edit('appId', text) }} onReset={() => { props.resetField('appId') }} />
              <SettingsSecretField id="lark-app-secret" label={t('appSecret')} hint={t('appSecretHint')}
                disabled={!state.appSecretWritable} text={state.appSecret.text} configured={state.appSecretConfigured}
                stateLabel={state.appSecretConfigured ? t('secretConfigured') : t('secretMissing')}
                onEdit={(text) => { props.edit('appSecret', text) }} />
              <div className={css.flow}>
                <Button variant="outline" disabled={disabled || state.setupBusy || !state.appId.text || (!state.appSecret.text && !state.appSecretConfigured)}
                  onClick={() => { void props.beginUserAuthorization() }}>
                  {t('saveAndAuthorize')}
                </Button>
              </div>
            </div>
          )}
        </section>

        {state.verificationUrl !== undefined && pendingFlow === 'registration' && (
          <section className={css.section} aria-labelledby="lark-registration-callout">
            <h3 id="lark-registration-callout">{t('quickPath')}</h3>
            <div className={css.authorizeCallout}>
              <div className={css.authorizeHeading}>
                <span>{t('authorizationHint')}</span>
              </div>
              <div className={css.flow}>
                <a className={css.authorizeLink} href={state.verificationUrl} target="_blank" rel="noreferrer">
                  {t('openVerificationPage')}
                </a>
                <Button variant="outline" disabled={disabled || state.setupBusy} onClick={() => {
                  void props.completeQuickConnect()
                }}>
                  {t('completeQuickConnect')}
                </Button>
                <Button variant="outline" className={css.dangerCancel} disabled={disabled} onClick={() => { void props.cancelSetupFlow() }}>
                  {t('cancelAuthorization')}
                </Button>
              </div>
            </div>
          </section>
        )}

        {state.verificationUrl !== undefined && pendingFlow === 'user-authorization' && (
          <section className={css.section} aria-labelledby="lark-authorization-callout">
            <h3 id="lark-authorization-callout">{t('authorizationCallout')}</h3>
            <div className={css.authorizeCallout}>
              <div className={css.authorizeHeading}>
                <span>{t('authorizationHint')}</span>
              </div>
              <div className={css.flow}>
                <a className={css.authorizeLink} href={state.verificationUrl} target="_blank" rel="noreferrer">
                  {t('openVerificationPage')}
                </a>
                <Button variant="outline" disabled={disabled || state.setupBusy} onClick={() => {
                  void props.completeUserAuthorization()
                }}>
                  {t('completeUserAuthorization')}
                </Button>
                <Button variant="outline" className={css.dangerCancel} disabled={disabled} onClick={() => { void props.cancelSetupFlow() }}>
                  {t('cancelAuthorization')}
                </Button>
              </div>
            </div>
          </section>
        )}

        {resumableAuthorization !== undefined && state.verificationUrl === undefined && (
          <section className={css.section} aria-labelledby="lark-resume-callout">
            <h3 id="lark-resume-callout">{t('authorizationCallout')}</h3>
            <div className={css.authorizeCallout}>
              <div className={css.authorizeHeading}>
                <span>{t('authorizationResumable')}</span>
              </div>
              <div className={css.flow}>
                <Button variant="primary" disabled={disabled || state.setupBusy} onClick={() => {
                  void props.completeUserAuthorization()
                }}>
                  {t('completeUserAuthorization')}
                </Button>
                <Button variant="outline" disabled={disabled || state.setupBusy || !state.appId.text || (!state.appSecret.text && !state.appSecretConfigured)}
                  onClick={() => { void props.beginUserAuthorization() }}>
                  {t('authorizationRestart')}
                </Button>
                <Button variant="outline" className={css.dangerCancel} disabled={disabled} onClick={() => { void props.cancelSetupFlow() }}>
                  {t('cancelAuthorization')}
                </Button>
              </div>
              <p className={css.hint}>{t('authorizationRestartHint')}</p>
            </div>
          </section>
        )}

        {expiredAuthorization !== undefined && state.verificationUrl === undefined && (
          <section className={css.section}>
            <p className={css.hint} role="status">{t('authorizationExpired')}</p>
            <div className={css.flow}>
              <Button variant="outline" disabled={disabled || state.setupBusy || !state.appId.text || (!state.appSecret.text && !state.appSecretConfigured)}
                onClick={() => { void props.beginUserAuthorization() }}>
                {t('authorizationRestart')}
              </Button>
            </div>
          </section>
        )}

        {state.setupResult && <p className={css.hint} role="status">{t(setupLabels[state.setupResult])}</p>}

        <section className={css.section}>
          <h3>{t('enabled')}</h3>
          <label className={css.toggle}>
            <input type="checkbox" disabled={disabled} checked={state.enabled.text === 'true'}
              onChange={(event) => { props.edit('enabled', String(event.currentTarget.checked)) }} />
            <span>{t('enabledHint')}</span>
          </label>
        </section>

        <details className={css.advanced}>
          <summary>{t('advanced')}</summary>
          <section className={css.section}>
            {state.statusDiagnostic && <div className={css.field}>
              <span className={css.label}>{t('statusDiagnostic')}</span>
              <code>{state.statusDiagnostic}</code>
            </div>}
            <SettingsValueField id="lark-registration-timeout" label={t('registrationTimeoutMs')} hint={t('registrationTimeoutMsHint')}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')} disabled={disabled}
              numeric {...state.registrationTimeoutMs} onEdit={(text) => { props.edit('registrationTimeoutMs', text) }}
              onReset={() => { props.resetField('registrationTimeoutMs') }} />
            <SettingsValueField id="lark-secret-reference" label={t('appSecretEnv')} hint={t('appSecretEnvHint')}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')} disabled={disabled}
              {...state.appSecretEnv} onEdit={(text) => { props.edit('appSecretEnv', text) }}
              onReset={() => { props.resetField('appSecretEnv') }} />
            <SettingsValueField id="lark-authorized-open-id" label={t('authorizedUserOpenId')} hint={t('authorizedUserOpenIdHint')}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')} disabled={disabled}
              {...state.authorizedUserOpenId} onEdit={(text) => { props.edit('authorizedUserOpenId', text) }}
              onReset={() => { props.resetField('authorizedUserOpenId') }} />
            <label className={css.toggle}>
              <input type="checkbox" disabled={disabled} checked={state.cliEnabled.text === 'true'}
                onChange={(event) => { props.edit('cliEnabled', String(event.currentTarget.checked)) }} />
              <span>{t('cliEnabled')}</span>
            </label>
            <SettingsValueField id="lark-cli-timeout" label={t('cliTimeoutMs')} hint={t('cliTimeoutMsHint')}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')} disabled={disabled}
              numeric {...state.cliTimeoutMs} onEdit={(text) => { props.edit('cliTimeoutMs', text) }}
              onReset={() => { props.resetField('cliTimeoutMs') }} />
            <SettingsValueField id="lark-cli-output-limit" label={t('cliMaxOutputBytes')} hint={t('cliMaxOutputBytesHint')}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')} disabled={disabled}
              numeric {...state.cliMaxOutputBytes} onEdit={(text) => { props.edit('cliMaxOutputBytes', text) }}
              onReset={() => { props.resetField('cliMaxOutputBytes') }} />
            <SettingsValueField id="lark-cli-grace" label={t('cliGraceMs')} hint={t('cliGraceMsHint')}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')} disabled={disabled}
              numeric {...state.cliGraceMs} onEdit={(text) => { props.edit('cliGraceMs', text) }}
              onReset={() => { props.resetField('cliGraceMs') }} />
            <SettingsValueField id="lark-conversation-cwd" label={t('conversationCwd')} hint={t('conversationCwdHint')}
              overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalid')} disabled={disabled}
              {...state.conversationCwd} onEdit={(text) => { props.edit('conversationCwd', text) }}
              onReset={() => { props.resetField('conversationCwd') }} />
          </section>
        </details>
      </div>
    </SettingsForm>
  )
}
