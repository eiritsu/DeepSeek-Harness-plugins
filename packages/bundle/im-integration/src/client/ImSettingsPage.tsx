/** Multi-platform IM Integration settings on its bundle detail page. */

import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ImSettingsPage.module.css'
import type { ImLocaleKey } from './locales.ts'
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
            <Button variant="outline">{t('weixinScanButton')}</Button>
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
          <div className={css.noticeBox}>{t('whatsappHint')}</div>
          <div>
            <Button variant="outline">{t('whatsappScanButton')}</Button>
          </div>
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
    </div>
  )
}
