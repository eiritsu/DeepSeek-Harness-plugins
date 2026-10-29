/** Reconcile per-platform IM connection status from Config and credentials, and manage live bridges. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLarkChannel } from '@larksuite/channel'
import type { Config } from './config.ts'
import { LarkConversationBridge } from './lark-bridge.ts'
import type { ImStatusService } from './status.ts'
import type { ImConnectionStatus, ImPlatform } from './types.ts'
import { parseWeixinBotCredential } from './weixin-api.ts'
import { WeixinConversationBridge } from './weixin-bridge.ts'

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

interface LiveBridge {
  readonly key: string
  readonly bridge: { dispose(): Promise<void> }
}

function parseAuthorizedUsers(raw: string): string[] {
  return raw
    .split(',')
    .map(user => user.trim())
    .filter(user => user.length > 0)
}

/**
 * Watch Config and credentials, manage live IM conversation bridges (WeChat, Feishu/Lark),
 * and publish non-sensitive platform status for Settings.
 *
 * @param ctx - Host context with credentials.
 * @param config - live IM configuration.
 * @param status - Remote status publisher.
 * @returns disposer that stops observation, tears down bridges, and marks every platform disabled.
 */
export function applyImRuntime(
  ctx: Context,
  config: Config,
  status: ImStatusService,
): () => Promise<void> {
  let generation = 0
  let disposed = false
  let queue = Promise.resolve()

  let weixinBridge: LiveBridge | undefined
  let larkBridge: LiveBridge | undefined

  const isDisposed = (): boolean => disposed

  const requestReconcile = (): void => {
    const requested = ++generation
    const isOutdated = (): boolean => isDisposed() || requested !== generation

    queue = queue.then(async () => {
      if (isOutdated()) return

      // Reconcile WeChat ClawBot bridge
      weixinBridge = await reconcileWeixinBridge(ctx, config, status, weixinBridge, isOutdated)
      if (isOutdated()) return

      // Reconcile Feishu / Lark bridge
      larkBridge = await reconcileLarkBridge(ctx, config, status, larkBridge, isOutdated)
      if (isOutdated()) return

      // Reconcile remaining static platforms for settings UI
      for (const platform of PLATFORMS) {
        if (platform === 'weixin' || platform === 'lark') continue
        if (isOutdated()) return
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

  return async () => {
    disposed = true
    generation++
    stopVolatile()
    stopCredential()

    const stopping: Promise<unknown>[] = []
    if (weixinBridge !== undefined) {
      stopping.push(weixinBridge.bridge.dispose().catch(() => {}))
      weixinBridge = undefined
    }
    if (larkBridge !== undefined) {
      stopping.push(larkBridge.bridge.dispose().catch(() => {}))
      larkBridge = undefined
    }
    await Promise.allSettled(stopping)
    await queue.catch(() => {})

    for (const platform of PLATFORMS) {
      status.publish({ platform, state: 'disabled' })
    }
  }
}

async function reconcileWeixinBridge(
  ctx: Context,
  config: Config,
  status: ImStatusService,
  current: LiveBridge | undefined,
  isOutdated: () => boolean,
): Promise<LiveBridge | undefined> {
  if (!config.enabled.get() || !config.weixinEnabled.get()) {
    if (current !== undefined) await current.bridge.dispose().catch(() => {})
    status.publish({ platform: 'weixin', state: 'disabled' })
    return undefined
  }
  const secretRef = credentialRef(config.weixinBotTokenEnv.get().trim() || 'WEIXIN_BOT_TOKEN')
  const secret = await ctx.credentials.resolve(secretRef)
  if (isOutdated()) return current
  if (secret === undefined) {
    if (current !== undefined) await current.bridge.dispose().catch(() => {})
    status.publish({ platform: 'weixin', state: 'disabled' })
    return undefined
  }
  const cred = parseWeixinBotCredential(secret.value)
  if (cred === undefined) {
    if (current !== undefined) await current.bridge.dispose().catch(() => {})
    status.publish({ platform: 'weixin', state: 'error', reason: 'missing-credential' })
    return undefined
  }
  const whitelist = config.whitelistEnabled.get()
  const users = config.authorizedUsers.get()
  const key = `${cred.token}\0${cred.baseUrl}\0${whitelist}\0${users}`
  if (current !== undefined && current.key === key) {
    status.publish({ platform: 'weixin', state: 'connected' })
    return current
  }
  if (current !== undefined) await current.bridge.dispose().catch(() => {})
  if (isOutdated()) return undefined
  status.publish({ platform: 'weixin', state: 'connecting' })
  const bridge = new WeixinConversationBridge(ctx, {
    credential: cred,
    whitelistEnabled: whitelist,
    allowedSenderIds: parseAuthorizedUsers(users),
    responseTimeoutMs: 10 * 60_000,
    currentSelection: () => ctx.agentDefaultModel.currentSelection(),
  })
  try {
    await bridge.connect()
    if (isOutdated()) {
      await bridge.dispose().catch(() => {})
      return undefined
    }
    status.publish({ platform: 'weixin', state: 'connected' })
    return { key, bridge }
  } catch (error: unknown) {
    await bridge.dispose().catch(() => {})
    if (!isOutdated()) {
      status.publish({ platform: 'weixin', state: 'error', reason: 'connection-failed' })
      ctx.logger.warn(`WeChat bridge connection failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return undefined
  }
}

async function reconcileLarkBridge(
  ctx: Context,
  config: Config,
  status: ImStatusService,
  current: LiveBridge | undefined,
  isOutdated: () => boolean,
): Promise<LiveBridge | undefined> {
  if (!config.enabled.get()) {
    if (current !== undefined) await current.bridge.dispose().catch(() => {})
    status.publish({ platform: 'lark', state: 'disabled' })
    return undefined
  }
  const appId = config.larkAppId.get().trim()
  if (appId.length === 0) {
    if (current !== undefined) await current.bridge.dispose().catch(() => {})
    status.publish({ platform: 'lark', state: 'disabled' })
    return undefined
  }
  const secretRef = credentialRef(config.larkAppSecretEnv.get().trim() || 'LARK_APP_SECRET')
  const secret = await ctx.credentials.resolve(secretRef)
  if (isOutdated()) return current
  if (secret === undefined) {
    if (current !== undefined) await current.bridge.dispose().catch(() => {})
    status.publish({ platform: 'lark', state: 'error', reason: 'missing-credential' })
    return undefined
  }
  const brand = config.larkBrand.get()
  const whitelist = config.whitelistEnabled.get()
  const users = config.authorizedUsers.get()
  const key = `${appId}\0${secret.value}\0${brand}\0${whitelist}\0${users}`
  if (current !== undefined && current.key === key) {
    status.publish({ platform: 'lark', state: 'connected' })
    return current
  }
  if (current !== undefined) await current.bridge.dispose().catch(() => {})
  if (isOutdated()) return undefined
  status.publish({ platform: 'lark', state: 'connecting' })
  const channel = createLarkChannel({
    appId,
    appSecret: secret.value,
    domain: brand === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn',
    source: 'deepseek-harness',
    policy: {
      dmMode: whitelist ? 'allowlist' : 'open',
      dmAllowlist: parseAuthorizedUsers(users),
    },
  })
  const bridge = new LarkConversationBridge(ctx, channel, {
    appId,
    whitelistEnabled: whitelist,
    allowedSenderIds: parseAuthorizedUsers(users),
    responseTimeoutMs: 10 * 60_000,
    currentSelection: () => ctx.agentDefaultModel.currentSelection(),
  })
  try {
    await bridge.connect()
    if (isOutdated()) {
      await bridge.dispose().catch(() => {})
      return undefined
    }
    status.publish({ platform: 'lark', state: 'connected' })
    return { key, bridge }
  } catch (error: unknown) {
    await bridge.dispose().catch(() => {})
    if (!isOutdated()) {
      status.publish({ platform: 'lark', state: 'error', reason: 'connection-failed' })
      ctx.logger.warn(`Lark bridge connection failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return undefined
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
        requiresIdentity: false,
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
