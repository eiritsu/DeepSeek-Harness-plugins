/** Host configuration for the multi-platform IM integration bundle. */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { ImPlatform } from './types.ts'

/** Configuration editable through the profile's generated plugin settings form. */
export interface Config {
  /** Active selected platform in UI. */
  activePlatform: Volatile<ImPlatform>
  /** Master switch for IM integration. Defaults false. */
  enabled: Volatile<boolean>

  /** Whether to enforce the user whitelist. When false, open to all callers. Defaults false. */
  whitelistEnabled: Volatile<boolean>
  /** Authorized user accounts when whitelist is enabled. Comma-separated. */
  authorizedUsers: Volatile<string>

  /** Whether moderation and action approval are enforced. When false, full autonomy is granted. Defaults false. */
  moderationEnabled: Volatile<boolean>
  /** Approval policy when moderation is enabled. */
  approvalPolicy: Volatile<'high_risk' | 'all'>
  /** Comma-separated sensitive keywords to block. */
  sensitiveKeywords: Volatile<string>

  /** Whether the model may call official channel CLI tools. Defaults false. */
  cliEnabled: Volatile<boolean>
  /** Whether `lark_cli` is offered while `cliEnabled` is on. Defaults true. */
  larkCliEnabled: Volatile<boolean>
  /** Whether `wecom_cli` is offered while `cliEnabled` is on. Defaults false. */
  wecomCliEnabled: Volatile<boolean>
  /** Whether `dingtalk_cli` is offered while `cliEnabled` is on. Defaults false. */
  dingtalkCliEnabled: Volatile<boolean>
  /** Per-process CLI deadline in milliseconds. */
  cliTimeoutMs: Volatile<number>
  /** Maximum retained bytes of each CLI output stream. */
  cliMaxOutputBytes: Volatile<number>
  /** CLI process termination grace in milliseconds. */
  cliGraceMs: Volatile<number>

  /** Lark / Feishu application id. */
  larkAppId: Volatile<string>
  /** Credential reference for the Lark application secret. */
  larkAppSecretEnv: Volatile<string>
  /** Lark product endpoint family. */
  larkBrand: Volatile<'feishu' | 'lark'>

  /** DingTalk application client id. */
  dingtalkClientId: Volatile<string>
  /** Credential reference for the DingTalk client secret. */
  dingtalkClientSecretEnv: Volatile<string>

  /** WeCom bot id. */
  wecomBotId: Volatile<string>
  /** Credential reference for the WeCom bot secret. */
  wecomBotSecretEnv: Volatile<string>

  /** Whether the WeChat ClawBot channel is enabled. */
  weixinEnabled: Volatile<boolean>
  /** Credential reference for the WeChat ClawBot token payload. */
  weixinBotTokenEnv: Volatile<string>

  /** QQ Open Platform application id. */
  qqAppId: Volatile<string>
  /** Credential reference for the QQ bot secret. */
  qqAppSecretEnv: Volatile<string>
  /** Whether QQ uses the sandbox gateway. */
  qqSandbox: Volatile<boolean>

  /** Credential reference for the Telegram bot token. */
  telegramBotTokenEnv: Volatile<string>

  /** Credential reference for the Discord bot token. */
  discordBotTokenEnv: Volatile<string>

  /** Whether the WhatsApp channel is enabled. */
  whatsappEnabled: Volatile<boolean>
  /** WhatsApp Cloud API phone number id. */
  whatsappPhoneNumberId: Volatile<string>
  /** WhatsApp Business Account id. */
  whatsappWabaId: Volatile<string>
  /** Credential reference for WhatsApp Cloud API access token. */
  whatsappAccessTokenEnv: Volatile<string>
}

/** Schemastery configuration for IM ingress. */
export const Config = z.object({
  activePlatform: z.union([
    'lark', 'dingtalk', 'wecom', 'weixin', 'qq', 'telegram', 'discord', 'whatsapp',
  ] as const).default('lark').volatile(),
  enabled: z.boolean().default(true).volatile(),

  whitelistEnabled: z.boolean().default(false).volatile(),
  authorizedUsers: z.string().default('').volatile(),

  moderationEnabled: z.boolean().default(false).volatile(),
  approvalPolicy: z.union(['high_risk', 'all'] as const).default('high_risk').volatile(),
  sensitiveKeywords: z.string().default('').volatile(),

  cliEnabled: z.boolean().default(false).volatile(),
  larkCliEnabled: z.boolean().default(true).volatile(),
  wecomCliEnabled: z.boolean().default(false).volatile(),
  dingtalkCliEnabled: z.boolean().default(false).volatile(),
  cliTimeoutMs: z.number().step(1).min(1_000).max(5 * 60_000).default(30_000).volatile(),
  cliMaxOutputBytes: z.number().step(1).min(1_024).max(4 * 1024 * 1024).default(256 * 1024).volatile(),
  cliGraceMs: z.number().step(1).min(100).max(30_000).default(2_000).volatile(),

  larkAppId: z.string().default('').volatile(),
  larkAppSecretEnv: z.string().role('credential-ref').default(String(credentialRef('LARK_APP_SECRET'))).volatile(),
  larkBrand: z.union(['feishu', 'lark'] as const).default('feishu').volatile(),

  dingtalkClientId: z.string().default('').volatile(),
  dingtalkClientSecretEnv: z.string().role('credential-ref').default(String(credentialRef('DINGTALK_CLIENT_SECRET'))).volatile(),

  wecomBotId: z.string().default('').volatile(),
  wecomBotSecretEnv: z.string().role('credential-ref').default(String(credentialRef('WECOM_BOT_SECRET'))).volatile(),

  weixinEnabled: z.boolean().default(true).volatile(),
  weixinBotTokenEnv: z.string().role('credential-ref').default(String(credentialRef('WEIXIN_BOT_TOKEN'))).volatile(),

  qqAppId: z.string().default('').volatile(),
  qqAppSecretEnv: z.string().role('credential-ref').default(String(credentialRef('QQ_BOT_SECRET'))).volatile(),
  qqSandbox: z.boolean().default(false).volatile(),

  telegramBotTokenEnv: z.string().role('credential-ref').default(String(credentialRef('TELEGRAM_BOT_TOKEN'))).volatile(),

  discordBotTokenEnv: z.string().role('credential-ref').default(String(credentialRef('DISCORD_BOT_TOKEN'))).volatile(),

  whatsappEnabled: z.boolean().default(false).volatile(),
  whatsappPhoneNumberId: z.string().default('').volatile(),
  whatsappWabaId: z.string().default('').volatile(),
  whatsappAccessTokenEnv: z.string().role('credential-ref').default(String(credentialRef('WHATSAPP_ACCESS_TOKEN'))).volatile(),
})
