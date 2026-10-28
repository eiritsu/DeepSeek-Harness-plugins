/** Multi-platform IM Integration settings on its bundle detail page. */

import { useEffect, useState } from 'react'
import { Button, Modal, SettingsForm } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ImSettingsPage.module.css'
import type { ImSettingsFace, ImSettingsState } from './controller.ts'
import type { ImLocaleKey } from './locales.ts'
import { QrCodeSvg } from './QrCodeCard.tsx'
import { fetchWeixinBotQrCode, pollWeixinBotQrStatus } from './weixin-ilink.ts'
import { generateWhatsappPairingPayload } from './whatsapp-baileys.ts'
import type { ImPlatform } from '../types.ts'

/** Renderer-bound props for the IM bundle detail page. */
export type ImSettingsPageProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<'settings.im'>
  & InjectFace<ImSettingsFace>

interface PlatformTabDef {
  key: ImPlatform
  labelKey: ImLocaleKey
}

const PLATFORM_TABS: readonly PlatformTabDef[] = [
  { key: 'lark', labelKey: 'tabLark' },
  { key: 'dingtalk', labelKey: 'tabDingtalk' },
  { key: 'wecom', labelKey: 'tabWecom' },
  { key: 'weixin', labelKey: 'tabWeixin' },
  { key: 'qq', labelKey: 'tabQq' },
  { key: 'telegram', labelKey: 'tabTelegram' },
  { key: 'discord', labelKey: 'tabDiscord' },
  { key: 'whatsapp', labelKey: 'tabWhatsapp' },
]

/** Render multi-platform IM configuration with tabbed navigation. */
export function ImSettingsPage(props: ImSettingsPageProps) {
  const { t } = props
  const state = props.useImSettings(snapshot => snapshot)
  const disabled = !state.writable || state.setupBusy
  const activePlatform = (state.activePlatform.text || 'lark') as ImPlatform
  const status = state.connectionStatus
  const stateLabel: Record<typeof status.state, ImLocaleKey> = {
    disabled: 'statusDisabled',
    connecting: 'statusConnecting',
    connected: 'statusConnected',
    error: 'statusError',
    unavailable: 'statusUnavailable',
  }
  const reasonLabel: ImLocaleKey | undefined =
    status.reason === 'missing-identity' ? 'statusPendingAuthorization'
      : status.reason === 'missing-credential' ? 'statusMissingCredential'
        : status.reason === 'connection-failed' ? 'statusConnectionFailed'
          : undefined
  const badgeClass = status.state === 'connected' ? css.badgeConnected
    : status.state === 'connecting' ? css.badgeConnecting
      : status.state === 'error' || status.state === 'unavailable' ? css.badgeError
        : css.badgeDisabled

  interface QrModalData {
    readonly platform: 'weixin' | 'whatsapp'
    readonly value: string
    readonly ticket?: string
    readonly status: 'loading' | 'waiting' | 'scaned' | 'need_verifycode' | 'ok' | 'expired' | 'error'
  }

  const [qrModal, setQrModal] = useState<QrModalData | null>(null)
  const [verifyCodeInput, setVerifyCodeInput] = useState('')
  const [pendingVerifyCode, setPendingVerifyCode] = useState<string | undefined>(undefined)
  const [countdown, setCountdown] = useState<number>(120)
  const [whatsappMode, setWhatsappMode] = useState<'web' | 'cloud'>('web')

  const openWeixinQrModal = async (): Promise<void> => {
    setQrModal({ platform: 'weixin', value: '', status: 'loading' })
    setVerifyCodeInput('')
    setPendingVerifyCode(undefined)
    setCountdown(120)
    try {
      const res = await fetchWeixinBotQrCode()
      setQrModal({
        platform: 'weixin',
        value: res.qrcodeUrl,
        ticket: res.qrcode,
        status: 'waiting',
      })
    } catch {
      setQrModal({ platform: 'weixin', value: '', status: 'error' })
    }
  }

  const openWhatsappQrModal = (): void => {
    const payload = generateWhatsappPairingPayload()
    setQrModal({ platform: 'whatsapp', value: payload, status: 'waiting' })
    setCountdown(30)
  }

  const handleRefresh = (): void => {
    if (qrModal?.platform === 'weixin') void openWeixinQrModal()
    else if (qrModal?.platform === 'whatsapp') openWhatsappQrModal()
  }

  useEffect(() => {
    if (!qrModal || qrModal.status !== 'waiting') return
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setQrModal(curr => (curr ? { ...curr, status: 'expired' } : null))
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => { clearInterval(timer) }
  }, [qrModal?.status])

  useEffect(() => {
    if (
      !qrModal
      || qrModal.platform !== 'weixin'
      || !qrModal.ticket
      || qrModal.status === 'ok'
      || qrModal.status === 'expired'
      || qrModal.status === 'error'
    ) {
      return
    }
    let active = true
    let inFlight: AbortController | undefined
    const poll = async (): Promise<void> => {
      if (!active || !qrModal.ticket) return
      inFlight?.abort()
      const controller = new AbortController()
      inFlight = controller
      try {
        const res = await pollWeixinBotQrStatus(qrModal.ticket, pendingVerifyCode, controller.signal)
        if (!active || controller.signal.aborted) return
        if (res.status === 'scaned' && qrModal.status !== 'scaned') {
          setQrModal(prev => (prev ? { ...prev, status: 'scaned' } : null))
        } else if (res.status === 'need_verifycode' && qrModal.status !== 'need_verifycode') {
          setQrModal(prev => (prev ? { ...prev, status: 'need_verifycode' } : null))
        } else if (res.status === 'ok') {
          const token = res.token?.trim()
          if (token !== undefined && token.length > 0) {
            const committed = await props.commitWeixinAuthorization({
              token,
              ...(res.botId === undefined ? {} : { botId: res.botId }),
              ...(res.userId === undefined ? {} : { userId: res.userId }),
            })
            if (!active) return
            setQrModal(prev => (prev ? { ...prev, status: committed ? 'ok' : 'error' } : null))
          } else {
            setQrModal(prev => (prev ? { ...prev, status: 'error' } : null))
          }
        } else if (res.status === 'expired') {
          setQrModal(prev => (prev ? { ...prev, status: 'expired' } : null))
        }
      } catch {
        // Aborted or transient network errors keep waiting until the next tick.
      }
    }
    const interval = setInterval(() => { void poll() }, 3000)
    void poll()
    return () => {
      active = false
      inFlight?.abort()
      clearInterval(interval)
    }
  }, [qrModal?.ticket, qrModal?.status, qrModal?.platform, pendingVerifyCode, props])

  return (
    <SettingsForm
      labels={{
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('saveSettings'),
        saving: t('saving'),
      }}
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div className={css.page}>
        <nav className={css.tabBar} aria-label="IM Platforms">
          {PLATFORM_TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              className={`${css.tabItem} ${activePlatform === tab.key ? css.tabItemActive : ''}`}
              onClick={() => { props.selectPlatform(tab.key) }}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </nav>

        <section className={css.section}>
          <h3>{t('connectionStatus')}</h3>
          <div className={css.statusBanner} data-state={status.state} role="status" aria-live="polite">
            <div className={css.statusHeading}>
              <span>{t('connectionStatus')}:</span>
              <span className={`${css.statusBadge} ${badgeClass}`}>
                {t(stateLabel[status.state])}
              </span>
            </div>
            {reasonLabel !== undefined && <p className={css.hint}>{t(reasonLabel)}</p>}
          </div>
          <label className={css.checkboxRow}>
            <input
              type="checkbox"
              checked={state.enabled.text === 'true'}
              disabled={disabled}
              onChange={(event) => { props.edit('enabled', String(event.currentTarget.checked)) }}
            />
            <strong>{t('enablePlatform')}</strong>
          </label>
        </section>

        {activePlatform === 'lark' && (
          <section className={css.section}>
            <h3>{t('tabLark')}</h3>
            <div className={css.field}>
              <label className={css.label}>{t('larkBrand')}</label>
              <select
                className={css.select}
                disabled={disabled}
                value={state.larkBrand.text || 'feishu'}
                onChange={(event) => { props.edit('larkBrand', event.currentTarget.value) }}
              >
                <option value="feishu">{t('larkFeishu')}</option>
                <option value="lark">{t('larkSuite')}</option>
              </select>
            </div>
            <div className={css.field}>
              <label className={css.label}>{t('larkAppId')}</label>
              <input
                className={css.input}
                disabled={disabled}
                value={state.larkAppId.text}
                placeholder="cli_a..."
                onChange={(event) => { props.edit('larkAppId', event.currentTarget.value) }}
              />
            </div>
            <div className={css.field}>
              <label className={css.label}>{t('larkAppSecret')}</label>
              <input
                className={css.input}
                type="password"
                disabled={disabled}
                value={state.larkAppSecret.text}
                placeholder={state.secretsConfigured.larkAppSecret ? t('secretConfigured') : t('secretHint')}
                onChange={(event) => { props.edit('larkAppSecret', event.currentTarget.value) }}
              />
            </div>
          </section>
        )}

        {activePlatform === 'dingtalk' && (
          <section className={css.section}>
            <h3>{t('tabDingtalk')}</h3>
            <div className={css.noticeBox}>{t('dingtalkStreamHint')}</div>
            <div className={css.field}>
              <label className={css.label}>{t('dingtalkClientId')}</label>
              <input
                className={css.input}
                disabled={disabled}
                value={state.dingtalkClientId.text}
                placeholder="ding..."
                onChange={(event) => { props.edit('dingtalkClientId', event.currentTarget.value) }}
              />
            </div>
            <div className={css.field}>
              <label className={css.label}>{t('dingtalkClientSecret')}</label>
              <input
                className={css.input}
                type="password"
                disabled={disabled}
                value={state.dingtalkClientSecret.text}
                placeholder={state.secretsConfigured.dingtalkClientSecret ? t('secretConfigured') : t('secretHint')}
                onChange={(event) => { props.edit('dingtalkClientSecret', event.currentTarget.value) }}
              />
            </div>
          </section>
        )}

        {activePlatform === 'wecom' && (
          <section className={css.section}>
            <h3>{t('tabWecom')}</h3>
            <div className={css.noticeBox}>{t('wecomCliHint')}</div>
            <div className={css.field}>
              <label className={css.label}>{t('wecomBotId')}</label>
              <input
                className={css.input}
                disabled={disabled}
                value={state.wecomBotId.text}
                placeholder="bot_..."
                onChange={(event) => { props.edit('wecomBotId', event.currentTarget.value) }}
              />
            </div>
            <div className={css.field}>
              <label className={css.label}>{t('wecomBotSecret')}</label>
              <input
                className={css.input}
                type="password"
                disabled={disabled}
                value={state.wecomBotSecret.text}
                placeholder={state.secretsConfigured.wecomBotSecret ? t('secretConfigured') : t('secretHint')}
                onChange={(event) => { props.edit('wecomBotSecret', event.currentTarget.value) }}
              />
            </div>
          </section>
        )}

        {activePlatform === 'weixin' && (
          <section className={css.section}>
            <h3>{t('tabWeixin')}</h3>
            <div className={css.noticeBox}>{t('weixinScanHint')}</div>
            <div>
              <Button variant="outline" disabled={disabled} onClick={() => { void openWeixinQrModal() }}>
                {t('weixinScanButton')}
              </Button>
            </div>
            {status.state === 'connected' && (
              <Button variant="outline" disabled={disabled} onClick={() => { void props.clearWeixinAuthorization() }}>
                {t('weixinDisconnect')}
              </Button>
            )}
          </section>
        )}

        {activePlatform === 'qq' && (
          <section className={css.section}>
            <h3>{t('tabQq')}</h3>
            <div className={css.noticeBox}>{t('qqHint')}</div>
            <div className={css.field}>
              <label className={css.label}>{t('qqAppId')}</label>
              <input
                className={css.input}
                disabled={disabled}
                value={state.qqAppId.text}
                placeholder="102..."
                onChange={(event) => { props.edit('qqAppId', event.currentTarget.value) }}
              />
            </div>
            <div className={css.field}>
              <label className={css.label}>{t('qqAppSecret')}</label>
              <input
                className={css.input}
                type="password"
                disabled={disabled}
                value={state.qqAppSecret.text}
                placeholder={state.secretsConfigured.qqAppSecret ? t('secretConfigured') : t('secretHint')}
                onChange={(event) => { props.edit('qqAppSecret', event.currentTarget.value) }}
              />
            </div>
            <label className={css.checkboxRow}>
              <input
                type="checkbox"
                checked={state.qqSandbox.text === 'true'}
                disabled={disabled}
                onChange={(event) => { props.edit('qqSandbox', String(event.currentTarget.checked)) }}
              />
              <span>{t('qqSandbox')}</span>
            </label>
          </section>
        )}

        {activePlatform === 'telegram' && (
          <section className={css.section}>
            <h3>{t('tabTelegram')}</h3>
            <div className={css.noticeBox}>{t('telegramHint')}</div>
            <div className={css.field}>
              <label className={css.label}>{t('telegramBotToken')}</label>
              <input
                className={css.input}
                type="password"
                disabled={disabled}
                value={state.telegramBotToken.text}
                placeholder={state.secretsConfigured.telegramBotToken ? t('secretConfigured') : '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ'}
                onChange={(event) => { props.edit('telegramBotToken', event.currentTarget.value) }}
              />
            </div>
          </section>
        )}

        {activePlatform === 'discord' && (
          <section className={css.section}>
            <h3>{t('tabDiscord')}</h3>
            <div className={css.noticeBox}>{t('discordHint')}</div>
            <div className={css.field}>
              <label className={css.label}>{t('discordBotToken')}</label>
              <input
                className={css.input}
                type="password"
                disabled={disabled}
                value={state.discordBotToken.text}
                placeholder={state.secretsConfigured.discordBotToken ? t('secretConfigured') : 'MTAx...'}
                onChange={(event) => { props.edit('discordBotToken', event.currentTarget.value) }}
              />
            </div>
          </section>
        )}

        {activePlatform === 'whatsapp' && (
          <section className={css.section}>
            <h3>{t('tabWhatsapp')}</h3>
            <div className={css.field}>
              <label className={css.label}>{t('whatsappMode')}</label>
              <select
                className={css.select}
                disabled={disabled}
                value={whatsappMode}
                onChange={(e) => { setWhatsappMode(e.currentTarget.value as 'web' | 'cloud') }}
              >
                <option value="web">{t('whatsappModeWeb')}</option>
                <option value="cloud">{t('whatsappModeCloud')}</option>
              </select>
            </div>
            {whatsappMode === 'web' ? (
              <>
                <div className={css.noticeBox}>{t('whatsappHint')}</div>
                <div>
                  <Button variant="outline" disabled={disabled} onClick={openWhatsappQrModal}>{t('whatsappScanButton')}</Button>
                </div>
              </>
            ) : (
              <>
                <div className={css.noticeBox}>{t('whatsappCloudHint')}</div>
                <div className={css.field}>
                  <label className={css.label}>{t('whatsappAccessToken')}</label>
                  <input
                    className={css.input}
                    type="password"
                    disabled={disabled}
                    value={state.whatsappAccessToken.text}
                    placeholder={state.secretsConfigured.whatsappAccessToken ? t('secretConfigured') : t('secretHint')}
                    onChange={(event) => { props.edit('whatsappAccessToken', event.currentTarget.value) }}
                  />
                </div>
              </>
            )}
          </section>
        )}

        <section className={css.section}>
          <h3>{t('whitelistTitle')}</h3>
          <label className={css.checkboxRow}>
            <input
              type="checkbox"
              checked={state.whitelistEnabled.text === 'true'}
              disabled={disabled}
              onChange={(event) => { props.edit('whitelistEnabled', String(event.currentTarget.checked)) }}
            />
            <strong>{t('enableWhitelist')}</strong>
          </label>
          {state.whitelistEnabled.text === 'true' ? (
            <div className={css.field}>
              <label className={css.label}>{t('authorizedUsers')}</label>
              <input
                className={css.input}
                disabled={disabled}
                value={state.authorizedUsers.text}
                placeholder={t('authorizedUsersPlaceholder')}
                onChange={(event) => { props.edit('authorizedUsers', event.currentTarget.value) }}
              />
              <p className={css.hint}>{t('whitelistHintEnforced')}</p>
            </div>
          ) : (
            <div className={css.openModeBox}>{t('whitelistHintOpen')}</div>
          )}
        </section>

        <section className={css.section}>
          <h3>{t('moderationTitle')}</h3>
          <label className={css.checkboxRow}>
            <input
              type="checkbox"
              checked={state.moderationEnabled.text === 'true'}
              disabled={disabled}
              onChange={(event) => { props.edit('moderationEnabled', String(event.currentTarget.checked)) }}
            />
            <strong>{t('enableModeration')}</strong>
          </label>
          {state.moderationEnabled.text === 'true' ? (
            <>
              <p className={css.hint}>{t('moderationHintEnforced')}</p>
              <div className={css.radioGroup}>
                <label className={css.radioRow}>
                  <input
                    type="radio"
                    name="approval-policy"
                    checked={state.approvalPolicy.text !== 'all'}
                    disabled={disabled}
                    onChange={() => { props.edit('approvalPolicy', 'high_risk') }}
                  />
                  <span>{t('approvalHighRisk')}</span>
                </label>
                <label className={css.radioRow}>
                  <input
                    type="radio"
                    name="approval-policy"
                    checked={state.approvalPolicy.text === 'all'}
                    disabled={disabled}
                    onChange={() => { props.edit('approvalPolicy', 'all') }}
                  />
                  <span>{t('approvalAll')}</span>
                </label>
              </div>
              <div className={css.field}>
                <label className={css.label}>{t('sensitiveKeywords')}</label>
                <input
                  className={css.input}
                  disabled={disabled}
                  value={state.sensitiveKeywords.text}
                  placeholder={t('sensitiveKeywordsPlaceholder')}
                  onChange={(event) => { props.edit('sensitiveKeywords', event.currentTarget.value) }}
                />
              </div>
            </>
          ) : (
            <div className={css.autonomyBox}>{t('moderationHintBypass')}</div>
          )}
        </section>

        <section className={css.section}>
          <label className={css.checkboxRow}>
            <input
              type="checkbox"
              checked={state.cliEnabled.text === 'true'}
              disabled={disabled}
              onChange={(event) => { props.edit('cliEnabled', String(event.currentTarget.checked)) }}
            />
            <span>{t('enableCliTool')}</span>
          </label>
        </section>

        {setupResultMessage(state, t) !== undefined && (
          <section className={css.section}>
            <p className={css.hint} role="status">{setupResultMessage(state, t)}</p>
          </section>
        )}

        {qrModal !== null && (
          <Modal
            open
            onClose={() => { setQrModal(null) }}
            title={qrModal.platform === 'weixin' ? t('qrModalTitleWeixin') : t('qrModalTitleWhatsapp')}
            description={qrModal.platform === 'weixin' ? t('qrModalDescWeixin') : t('qrModalDescWhatsapp')}
            closeLabel={t('qrModalClose')}
            footer={(
              <>
                <Button variant="outline" onClick={handleRefresh}>{t('qrModalRefresh')}</Button>
                <Button variant="primary" onClick={() => { setQrModal(null) }}>{t('qrModalClose')}</Button>
              </>
            )}
          >
            <div className={css.qrModalBody}>
              <div className={css.qrCard}>
                {qrModal.status === 'loading' ? (
                  <div style={{ width: 200, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
                    <span>{t('qrModalStatusLoading')}</span>
                  </div>
                ) : qrModal.status === 'error' ? (
                  <div style={{ width: 200, height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 13, color: '#e74c3c', textAlign: 'center', padding: 12 }}>
                    <span>{t('qrModalStatusError')}</span>
                    <button type="button" className={css.qrRefreshOverlayButton} onClick={handleRefresh}>{t('qrModalClickToRefresh')}</button>
                  </div>
                ) : (
                  <QrCodeSvg value={qrModal.value} size={200} />
                )}

                {qrModal.status === 'expired' && (
                  <div className={css.qrExpiredOverlay}>
                    <span className={css.qrExpiredText}>{t('qrModalExpired')}</span>
                    <button type="button" className={css.qrRefreshOverlayButton} onClick={handleRefresh}>
                      {t('qrModalClickToRefresh')}
                    </button>
                  </div>
                )}

                <div className={css.qrStatusRow}>
                  {qrModal.status === 'waiting' && <span className={css.pulseDot} style={{ background: '#2ecc71' }} />}
                  {qrModal.status === 'scaned' && <span className={css.pulseDot} style={{ background: '#f1c40f' }} />}
                  {qrModal.status === 'ok' && <span style={{ color: '#2ecc71', fontWeight: 600 }}>✓</span>}
                  <span>
                    {qrModal.status === 'loading' && t('qrModalStatusLoading')}
                    {qrModal.status === 'waiting' && t('qrModalStatusWaiting')}
                    {qrModal.status === 'scaned' && t('qrModalStatusScaned')}
                    {qrModal.status === 'need_verifycode' && t('qrModalVerifying')}
                    {qrModal.status === 'ok' && t('qrModalStatusSuccess')}
                    {qrModal.status === 'expired' && t('qrModalExpired')}
                    {qrModal.status === 'error' && t('qrModalStatusError')}
                  </span>
                </div>

                {qrModal.status === 'waiting' && (
                  <span className={css.qrCountdown}>
                    {t('qrExpiresIn')}{countdown}{t('seconds')}
                  </span>
                )}
              </div>

              {qrModal.status === 'need_verifycode' && (
                <div className={css.verifyCodePanel}>
                  <div className={css.verifyCodePrompt}>{t('qrModalNeedVerifyCode')}</div>
                  <div className={css.verifyCodeRow}>
                    <input
                      type="text"
                      className={css.verifyCodeInput}
                      placeholder={t('qrModalVerifyCodePlaceholder')}
                      value={verifyCodeInput}
                      onChange={(e) => { setVerifyCodeInput(e.target.value) }}
                      maxLength={8}
                    />
                    <button
                      type="button"
                      className={css.verifyCodeSubmit}
                      onClick={() => { setPendingVerifyCode(verifyCodeInput.trim()) }}
                    >
                      {t('qrModalSubmitCode')}
                    </button>
                  </div>
                </div>
              )}

              <p className={css.qrInstructions}>
                {qrModal.platform === 'weixin' ? t('qrModalHintWeixin') : t('qrModalHintWhatsapp')}
              </p>
            </div>
          </Modal>
        )}
      </div>
    </SettingsForm>
  )
}

function setupResultMessage(
  state: ImSettingsState,
  t: (key: ImLocaleKey) => string,
): string | undefined {
  if (state.setupResult === undefined) return undefined
  const labels: Record<NonNullable<ImSettingsState['setupResult']>, ImLocaleKey> = {
    complete: 'setupComplete',
    cancelled: 'setupCancelled',
    'not-configured': 'setupNotConfigured',
    'not-ready': 'setupNotReady',
    'operation-failed': 'setupFailed',
  }
  return t(labels[state.setupResult])
}
