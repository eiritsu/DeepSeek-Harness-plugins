/** Reconcile per-platform IM connection status from Config and credentials. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { Config } from './config.ts'
import type { ImStatusService } from './status.ts'
import type { ImConnectionStatus, ImPlatform } from './types.ts'

const PLATFORMS: readonly ImPlatform[] = [
  'lark', 'dingtalk', 'wecom', 'weixin', 'qq', 'telegram', 'discord', 'whatsapp',
]

interface IdentityCheck {
  readonly identityPresent: boolean
  readonly credentialRef: string
  readonly channelEnabled: boolean
  /** When true, an empty identity field means the channel is simply not configured. */
  readonly requiresIdentity: boolean
}

/** Watch Config and credentials, then publish non-sensitive platform status.
 * Platforms without a live message bridge report `connected` once identity and
 * credentials are present so Settings can show authorization readiness.
 * @param ctx - Host context with credentials.
 * @param config - live IM configuration.
 * @param status - Remote status publisher.
 * @returns disposer that stops observation and marks every platform disabled.
 */
export function applyImRuntime(ctx: Context, config: Config, status: ImStatusService): () => void {
  let generation = 0
  let disposed = false
  let queue = Promise.resolve()

  const isDisposed = (): boolean => disposed

  const requestReconcile = (): void => {
    const requested = ++generation
    queue = queue.then(async () => {
      if (requested !== generation || isDisposed()) return
      for (const platform of PLATFORMS) {
        if (requested !== generation || isDisposed()) return
        status.publish(await resolvePlatformStatus(ctx, config, platform))
      }
    }).catch((error: unknown) => {
      ctx.logger.error(
        `IM configuration reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  const stopVolatile = ctx.on('loader/volatile-update', () => { requestReconcile() })
  const stopCredential = ctx.on('credentials/reference-updated', () => { requestReconcile() })
  requestReconcile()

  return () => {
    disposed = true
    generation++
    stopVolatile()
    stopCredential()
    for (const platform of PLATFORMS) {
      status.publish({ platform, state: 'disabled' })
    }
  }
}

async function resolvePlatformStatus(
  ctx: Context,
  config: Config,
  platform: ImPlatform,
): Promise<ImConnectionStatus> {
  if (!config.enabled.get()) {
    return { platform, state: 'disabled' }
  }
  const check = identityFor(config, platform)
  if (!check.channelEnabled) {
    return { platform, state: 'disabled' }
  }
  // Identity-gated channels stay disabled until the user fills an app/bot id.
  if (!check.identityPresent && check.requiresIdentity) {
    return { platform, state: 'disabled' }
  }
  if (!check.identityPresent) {
    return { platform, state: 'error', reason: 'missing-identity' }
  }
  const secret = await ctx.credentials.resolve(credentialRef(check.credentialRef))
  if (secret === undefined) {
    // Token-only channels without a stored secret are simply not configured yet.
    if (!check.requiresIdentity) {
      return { platform, state: 'disabled' }
    }
    return { platform, state: 'error', reason: 'missing-credential' }
  }
  return { platform, state: 'connected' }
}

function identityFor(config: Config, platform: ImPlatform): IdentityCheck {
  switch (platform) {
    case 'lark':
      return {
        identityPresent: config.larkAppId.get().trim().length > 0,
        credentialRef: config.larkAppSecretEnv.get().trim() || 'LARK_APP_SECRET',
        channelEnabled: true,
        requiresIdentity: true,
      }
    case 'dingtalk':
      return {
        identityPresent: config.dingtalkClientId.get().trim().length > 0,
        credentialRef: config.dingtalkClientSecretEnv.get().trim() || 'DINGTALK_CLIENT_SECRET',
        channelEnabled: true,
        requiresIdentity: true,
      }
    case 'wecom':
      return {
        identityPresent: config.wecomBotId.get().trim().length > 0,
        credentialRef: config.wecomBotSecretEnv.get().trim() || 'WECOM_BOT_SECRET',
        channelEnabled: true,
        requiresIdentity: true,
      }
    case 'weixin':
      return {
        identityPresent: true,
        credentialRef: config.weixinBotTokenEnv.get().trim() || 'WEIXIN_BOT_TOKEN',
        channelEnabled: config.weixinEnabled.get(),
        requiresIdentity: true,
      }
    case 'qq':
      return {
        identityPresent: config.qqAppId.get().trim().length > 0,
        credentialRef: config.qqAppSecretEnv.get().trim() || 'QQ_BOT_SECRET',
        channelEnabled: true,
        requiresIdentity: true,
      }
    case 'telegram':
      return {
        identityPresent: true,
        credentialRef: config.telegramBotTokenEnv.get().trim() || 'TELEGRAM_BOT_TOKEN',
        channelEnabled: true,
        requiresIdentity: false,
      }
    case 'discord':
      return {
        identityPresent: true,
        credentialRef: config.discordBotTokenEnv.get().trim() || 'DISCORD_BOT_TOKEN',
        channelEnabled: true,
        requiresIdentity: false,
      }
    case 'whatsapp':
      return {
        identityPresent: config.whatsappPhoneNumberId.get().trim().length > 0,
        credentialRef: config.whatsappAccessTokenEnv.get().trim() || 'WHATSAPP_ACCESS_TOKEN',
        channelEnabled: config.whatsappEnabled.get(),
        requiresIdentity: true,
      }
    default: {
      const _exhaustive: never = platform
      return _exhaustive
    }
  }
}
