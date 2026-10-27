/** Host entry for the opt-in IM integration bundle. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-config-editor'
import { ImStatusService } from './status.ts'
import type { ImPlatform } from './types.ts'

export { ImStatusService } from './status.ts'
export type { ImConnectionStatus, ImPlatform } from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'im'

/** Configuration editable through the profile's generated plugin settings form. */
export interface Config {
  /** Active selected platform in UI. */
  activePlatform: Volatile<ImPlatform>
  /** Master switch for IM integration. Defaults false. */
  enabled: Volatile<boolean>

  // --- Common Access Control & Whitelist ---
  /** Whether to enforce the user whitelist. When false, open to all callers. Defaults false. */
  whitelistEnabled: Volatile<boolean>
  /** Authorized user accounts when whitelist is enabled. Comma-separated. */
  authorizedUsers: Volatile<string>

  // --- Common Moderation, Approvals & Full Autonomy ---
  /** Whether moderation and action approval are enforced. When false, full autonomy is granted. Defaults false. */
  moderationEnabled: Volatile<boolean>
  /** Approval policy when moderation is enabled. */
  approvalPolicy: Volatile<'high_risk' | 'all'>
  /** Comma-separated sensitive keywords to block. */
  sensitiveKeywords: Volatile<string>

  // --- Common CLI tool switch ---
  cliEnabled: Volatile<boolean>

  // --- Lark / 飞书 ---
  larkAppId: Volatile<string>
  larkAppSecretEnv: Volatile<string>
  larkBrand: Volatile<'feishu' | 'lark'>

  // --- 钉钉 / DingTalk ---
  dingtalkClientId: Volatile<string>
  dingtalkClientSecretEnv: Volatile<string>

  // --- 企业微信 / WeCom ---
  wecomBotId: Volatile<string>
  wecomBotSecretEnv: Volatile<string>

  // --- 微信 / WeChat ---
  weixinEnabled: Volatile<boolean>

  // --- QQ ---
  qqAppId: Volatile<string>
  qqAppSecretEnv: Volatile<string>
  qqSandbox: Volatile<boolean>

  // --- Telegram ---
  telegramBotTokenEnv: Volatile<string>

  // --- Discord ---
  discordBotTokenEnv: Volatile<string>

  // --- WhatsApp ---
  whatsappEnabled: Volatile<boolean>
}

/** Schemastery configuration for IM ingress. */
export const Config = z.object({
  activePlatform: z.union([
    'lark', 'dingtalk', 'wecom', 'weixin', 'qq', 'telegram', 'discord', 'whatsapp',
  ] as const).default('lark').volatile(),
  enabled: z.boolean().default(false).volatile(),

  // Access Control & Whitelist
  whitelistEnabled: z.boolean().default(false).volatile(),
  authorizedUsers: z.string().default('').volatile(),

  // Moderation & Approval (Defaults to false for Full Autonomy)
  moderationEnabled: z.boolean().default(false).volatile(),
  approvalPolicy: z.union(['high_risk', 'all'] as const).default('high_risk').volatile(),
  sensitiveKeywords: z.string().default('').volatile(),

  // CLI Tool switch
  cliEnabled: z.boolean().default(false).volatile(),

  // Lark
  larkAppId: z.string().default('').volatile(),
  larkAppSecretEnv: z.string().role('credential-ref').default(String(credentialRef('LARK_APP_SECRET'))).volatile(),
  larkBrand: z.union(['feishu', 'lark'] as const).default('feishu').volatile(),

  // DingTalk
  dingtalkClientId: z.string().default('').volatile(),
  dingtalkClientSecretEnv: z.string().role('credential-ref').default(String(credentialRef('DINGTALK_CLIENT_SECRET'))).volatile(),

  // WeCom
  wecomBotId: z.string().default('').volatile(),
  wecomBotSecretEnv: z.string().role('credential-ref').default(String(credentialRef('WECOM_BOT_SECRET'))).volatile(),

  // WeChat
  weixinEnabled: z.boolean().default(false).volatile(),

  // QQ
  qqAppId: z.string().default('').volatile(),
  qqAppSecretEnv: z.string().role('credential-ref').default(String(credentialRef('QQ_BOT_SECRET'))).volatile(),
  qqSandbox: z.boolean().default(false).volatile(),

  // Telegram
  telegramBotTokenEnv: z.string().role('credential-ref').default(String(credentialRef('TELEGRAM_BOT_TOKEN'))).volatile(),

  // Discord
  discordBotTokenEnv: z.string().role('credential-ref').default(String(credentialRef('DISCORD_BOT_TOKEN'))).volatile(),

  // WhatsApp
  whatsappEnabled: z.boolean().default(false).volatile(),
})

/** Services required for IM integration. */
export const inject = [
  'agentDefaultModel',
  'agents',
  'attachments',
  'credentials',
  'sessionPersistence',
  'sessionQuery',
  'workspaceRegistry',
  'configEditor',
  'subprocess',
  'tools',
]

/** Mount the IM integration host services. */
export function apply(ctx: Context, _config: Config): void {
  const status = new ImStatusService(ctx)
  // Register initial platform states
  status.publish({ platform: 'lark', state: 'disabled' })
  status.publish({ platform: 'dingtalk', state: 'disabled' })
  status.publish({ platform: 'wecom', state: 'disabled' })
  status.publish({ platform: 'weixin', state: 'disabled' })
  status.publish({ platform: 'qq', state: 'disabled' })
  status.publish({ platform: 'telegram', state: 'disabled' })
  status.publish({ platform: 'discord', state: 'disabled' })
  status.publish({ platform: 'whatsapp', state: 'disabled' })
}
