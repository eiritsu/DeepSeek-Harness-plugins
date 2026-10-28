/** Multi-platform IM Integration settings on its bundle detail page. */

import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ImSettingsPage.module.css'
import type { ImLocaleKey } from './locales.ts'
import { QrCodeSvg } from './QrCodeCard.tsx'
import { fetchWeixinBotQrCode, pollWeixinBotQrStatus } from './weixin-ilink.ts'
import { generateWhatsappPairingPayload } from './whatsapp-baileys.ts'
import type { ImPlatform } from '../types.ts'

/** Renderer-bound props for the IM bundle detail page. */
export type ImSettingsPageProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'settings.im'>

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
  const [activePlatform, setActivePlatform] = useState<ImPlatform>('lark')

  // Per-platform or global feature toggles
  const [whitelistEnabled, setWhitelistEnabled] = useState(false)
  const [moderationEnabled, setModerationEnabled] = useState(false)
  const [approvalPolicy, setApprovalPolicy] = useState<'high_risk' | 'all'>('high_risk')
  const [cliEnabled, setCliEnabled] = useState(false)
  const [whatsappMode, setWhatsappMode] = useState<'web' | 'cloud'>('web')

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

  const openWeixinQrModal = async (): Promise<void> => {
    setQrModal({
      platform: 'weixin',
      value: '',
      status: 'loading',
    })
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
      setQrModal({
        platform: 'weixin',
        value: '',
        status: 'error',
      })
    }
  }

  const openWhatsappQrModal = (): void => {
    const payload = generateWhatsappPairingPayload()
    setQrModal({
      platform: 'whatsapp',
      value: payload,
      status: 'waiting',
    })
    setCountdown(30)
  }

  const handleRefresh = (): void => {
    if (qrModal?.platform === 'weixin') {
      void openWeixinQrModal()
    } else if (qrModal?.platform === 'whatsapp') {
      openWhatsappQrModal()
    }
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
    if (!qrModal || qrModal.platform !== 'weixin' || !qrModal.ticket || qrModal.status === 'ok' || qrModal.status === 'expired' || qrModal.status === 'error') {
      return
    }
    let active = true
    const poll = async (): Promise<void> => {
      if (!active || !qrModal.ticket) return
      const res = await pollWeixinBotQrStatus(qrModal.ticket, pendingVerifyCode)
      if (!active) return
      if (res.status === 'scaned' && qrModal.status !== 'scaned') {
        setQrModal(prev => (prev ? { ...prev, status: 'scaned' } : null))
      } else if (res.status === 'need_verifycode' && qrModal.status !== 'need_verifycode') {
        setQrModal(prev => (prev ? { ...prev, status: 'need_verifycode' } : null))
      } else if (res.status === 'ok') {
        setQrModal(prev => (prev ? { ...prev, status: 'ok' } : null))
      } else if (res.status === 'expired') {
        setQrModal(prev => (prev ? { ...prev, status: 'expired' } : null))
      }
    }
    const interval = setInterval(() => { void poll() }, 3000)
    void poll()

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [qrModal?.ticket, qrModal?.status, qrModal?.platform, pendingVerifyCode])

  return (
    <div className={css.page}>
      {/* 1. Top Tab Bar */}
      <nav className={css.tabBar} aria-label="IM Platforms">
        {PLATFORM_TABS.map(tab => (
          <button
            key={tab.key}
            type="button"
            className={`${css.tabItem} ${activePlatform === tab.key ? css.tabItemActive : ''}`}
            onClick={() => { setActivePlatform(tab.key) }}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </nav>

      {/* 2. Platform Status Card */}
      <section className={css.section}>
        <h3>{t('connectionStatus')}</h3>
        <div className={css.statusBanner}>
          <div className={css.statusHeading}>
            <span>{t('connectionStatus')}:</span>
            <span className={`${css.statusBadge} ${css.badgeDisabled}`}>
              {t('statusDisabled')}
            </span>
          </div>
        </div>
      </section>

      {/* 3. Platform Credentials Panel */}
      {activePlatform === 'lark' && (
        <section className={css.section}>
          <h3>{t('tabLark')}</h3>
          <div className={css.field}>
            <label className={css.label}>{t('larkBrand')}</label>
            <select className={css.select} defaultValue="feishu">
              <option value="feishu">{t('larkFeishu')}</option>
              <option value="lark">{t('larkSuite')}</option>
            </select>
          </div>
          <div className={css.field}>
            <label className={css.label}>{t('larkAppId')}</label>
            <input className={css.input} placeholder="cli_a..." />
          </div>
          <div className={css.field}>
            <label className={css.label}>{t('larkAppSecret')}</label>
            <input className={css.input} type="password" placeholder={t('secretHint')} />
          </div>
        </section>
      )}

      {activePlatform === 'dingtalk' && (
        <section className={css.section}>
          <h3>{t('tabDingtalk')}</h3>
          <div className={css.noticeBox}>{t('dingtalkStreamHint')}</div>
          <div className={css.field}>
            <label className={css.label}>{t('dingtalkClientId')}</label>
            <input className={css.input} placeholder="ding..." />
          </div>
          <div className={css.field}>
            <label className={css.label}>{t('dingtalkClientSecret')}</label>
            <input className={css.input} type="password" placeholder={t('secretHint')} />
          </div>
        </section>
      )}

      {activePlatform === 'wecom' && (
        <section className={css.section}>
          <h3>{t('tabWecom')}</h3>
          <div className={css.noticeBox}>{t('wecomCliHint')}</div>
          <div className={css.field}>
            <label className={css.label}>{t('wecomBotId')}</label>
            <input className={css.input} placeholder="bot_..." />
          </div>
          <div className={css.field}>
            <label className={css.label}>{t('wecomBotSecret')}</label>
            <input className={css.input} type="password" placeholder={t('secretHint')} />
          </div>
        </section>
      )}

      {activePlatform === 'weixin' && (
        <section className={css.section}>
          <h3>{t('tabWeixin')}</h3>
          <div className={css.noticeBox}>{t('weixinScanHint')}</div>
          <div>
            <Button variant="outline" onClick={() => { void openWeixinQrModal() }}>{t('weixinScanButton')}</Button>
          </div>
        </section>
      )}

      {activePlatform === 'qq' && (
        <section className={css.section}>
          <h3>{t('tabQq')}</h3>
          <div className={css.noticeBox}>{t('qqHint')}</div>
          <div className={css.field}>
            <label className={css.label}>{t('qqAppId')}</label>
            <input className={css.input} placeholder="102..." />
          </div>
          <div className={css.field}>
            <label className={css.label}>{t('qqAppSecret')}</label>
            <input className={css.input} type="password" placeholder={t('secretHint')} />
          </div>
          <label className={css.checkboxRow}>
            <input type="checkbox" />
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
            <input className={css.input} type="password" placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ" />
          </div>
        </section>
      )}

      {activePlatform === 'discord' && (
        <section className={css.section}>
          <h3>{t('tabDiscord')}</h3>
          <div className={css.noticeBox}>{t('discordHint')}</div>
          <div className={css.field}>
            <label className={css.label}>{t('discordBotToken')}</label>
            <input className={css.input} type="password" placeholder="MTAx..." />
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
                <Button variant="outline" onClick={openWhatsappQrModal}>{t('whatsappScanButton')}</Button>
              </div>
            </>
          ) : (
            <>
              <div className={css.noticeBox}>{t('whatsappCloudHint')}</div>
              <div className={css.field}>
                <label className={css.label}>{t('whatsappPhoneNumberId')}</label>
                <input className={css.input} placeholder="1029384756..." />
              </div>
              <div className={css.field}>
                <label className={css.label}>{t('whatsappAccessToken')}</label>
                <input className={css.input} type="password" placeholder={t('secretHint')} />
              </div>
              <div className={css.field}>
                <label className={css.label}>{t('whatsappWabaId')}</label>
                <input className={css.input} placeholder="waba_..." />
              </div>
            </>
          )}
        </section>
      )}

      {/* 4. Access Control & User Whitelist Section */}
      <section className={css.section}>
        <h3>{t('whitelistTitle')}</h3>
        <label className={css.checkboxRow}>
          <input
            type="checkbox"
            checked={whitelistEnabled}
            onChange={(event) => { setWhitelistEnabled(event.currentTarget.checked) }}
          />
          <strong>{t('enableWhitelist')}</strong>
        </label>
        {whitelistEnabled ? (
          <div className={css.field}>
            <label className={css.label}>{t('authorizedUsers')}</label>
            <input className={css.input} placeholder={t('authorizedUsersPlaceholder')} />
            <p className={css.hint}>{t('whitelistHintEnforced')}</p>
          </div>
        ) : (
          <div className={css.openModeBox}>
            {t('whitelistHintOpen')}
          </div>
        )}
      </section>

      {/* 5. Moderation, Tool Approval & Full Autonomy Section */}
      <section className={css.section}>
        <h3>{t('moderationTitle')}</h3>
        <label className={css.checkboxRow}>
          <input
            type="checkbox"
            checked={moderationEnabled}
            onChange={(event) => { setModerationEnabled(event.currentTarget.checked) }}
          />
          <strong>{t('enableModeration')}</strong>
        </label>
        {moderationEnabled ? (
          <>
            <p className={css.hint}>{t('moderationHintEnforced')}</p>
            <div className={css.radioGroup}>
              <label className={css.radioRow}>
                <input
                  type="radio"
                  name="approval-policy"
                  checked={approvalPolicy === 'high_risk'}
                  onChange={() => { setApprovalPolicy('high_risk') }}
                />
                <span>{t('approvalHighRisk')}</span>
              </label>
              <label className={css.radioRow}>
                <input
                  type="radio"
                  name="approval-policy"
                  checked={approvalPolicy === 'all'}
                  onChange={() => { setApprovalPolicy('all') }}
                />
                <span>{t('approvalAll')}</span>
              </label>
            </div>
            <div className={css.field}>
              <label className={css.label}>{t('sensitiveKeywords')}</label>
              <input className={css.input} placeholder={t('sensitiveKeywordsPlaceholder')} />
            </div>
          </>
        ) : (
          <div className={css.autonomyBox}>
            {t('moderationHintBypass')}
          </div>
        )}
      </section>

      {/* 6. Optional CLI Tool Toggle */}
      <section className={css.section}>
        <label className={css.checkboxRow}>
          <input
            type="checkbox"
            checked={cliEnabled}
            onChange={(event) => { setCliEnabled(event.currentTarget.checked) }}
          />
          <span>{t('enableCliTool')}</span>
        </label>
      </section>

      {/* 7. Action Button */}
      <section className={css.section}>
        <div style={{ display: 'flex', gap: 10 }}>
          <Button variant="primary">{t('saveSettings')}</Button>
        </div>
      </section>

      {/* 8. QR Code Authorization & Pairing Modal */}
      {qrModal !== null && (
        <Modal
          open
          onClose={() => { setQrModal(null) }}
          title={qrModal.platform === 'weixin' ? t('qrModalTitleWeixin') : t('qrModalTitleWhatsapp')}
          description={qrModal.platform === 'weixin' ? t('qrModalDescWeixin') : t('qrModalDescWhatsapp')}
          closeLabel={t('qrModalClose')}
          footer={(
            <>
              <Button
                variant="outline"
                onClick={handleRefresh}
              >
                {t('qrModalRefresh')}
              </Button>
              <Button
                variant="primary"
                onClick={() => { setQrModal(null) }}
              >
                {t('qrModalClose')}
              </Button>
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
                <QrCodeSvg
                  value={qrModal.value}
                  size={200}
                />
              )}

              {qrModal.status === 'expired' && (
                <div className={css.qrExpiredOverlay}>
                  <span className={css.qrExpiredText}>{t('qrModalExpired')}</span>
                  <button
                    type="button"
                    className={css.qrRefreshOverlayButton}
                    onClick={handleRefresh}
                  >
                    {t('qrModalClickToRefresh')}
                  </button>
                </div>
              )}

              <div className={css.qrStatusRow}>
                {qrModal.status === 'loading' && <span className={css.pulseDot} style={{ background: '#3498db' }} />}
                {qrModal.status === 'waiting' && <span className={css.pulseDot} style={{ background: '#2ecc71' }} />}
                {qrModal.status === 'scaned' && <span className={css.pulseDot} style={{ background: '#f1c40f' }} />}
                {qrModal.status === 'need_verifycode' && <span className={css.pulseDot} style={{ background: '#e67e22' }} />}
                {qrModal.status === 'ok' && <span style={{ color: '#2ecc71', fontWeight: 600 }}>✓</span>}
                {qrModal.status === 'expired' && <span style={{ color: '#e74c3c', fontWeight: 600 }}>✕</span>}
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
              {qrModal.platform === 'weixin'
                ? t('qrModalHintWeixin')
                : t('qrModalHintWhatsapp')}
            </p>

            {qrModal.platform === 'whatsapp' && (
              <p className={css.qrInstructions} style={{ fontSize: 11, opacity: 0.85 }}>
                {t('whatsappWebTip')}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
