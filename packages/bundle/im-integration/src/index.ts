/** Host entry for the opt-in IM integration bundle. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import { Config } from './config.ts'
import { applyImRuntime } from './runtime.ts'
import { ImSetupService } from './setup.ts'
import { ImStatusService } from './status.ts'
import {
  handleWeixinQrCode,
  handleWeixinQrStatus,
  WEIXIN_QRCODE_PATH,
  WEIXIN_STATUS_PATH,
} from './weixin-proxy.ts'

export { Config } from './config.ts'
export type { Config as ImConfig } from './config.ts'
export { ImStatusService } from './status.ts'
export { ImSetupService } from './setup.ts'
export type { ImConnectionStatus, ImPlatform, ImSetupResult, WeixinAuthorizationPayload } from './types.ts'
export {
  handleWeixinQrCode,
  handleWeixinQrStatus,
  WEIXIN_QRCODE_PATH,
  WEIXIN_STATUS_PATH,
} from './weixin-proxy.ts'
export {
  imConversationCwd,
  imConversationDigest,
  ensureImConversationWorkspace,
} from './workspace.ts'
export type { ImConversationWorkspace } from './workspace.ts'
export { imSessionId, openImConversation } from './conversation.ts'
export type { OpenImConversationOptions, OpenImConversationResult } from './conversation.ts'
export { WeixinConversationBridge } from './weixin-bridge.ts'
export type { WeixinConversationOptions } from './weixin-bridge.ts'
export { LarkConversationBridge } from './lark-bridge.ts'
export type { LarkConversationOptions } from './lark-bridge.ts'
export {
  extractWeixinText,
  parseWeixinApiJson,
  parseWeixinBotCredential,
  weixinMessageId,
} from './weixin-api.ts'
export type {
  WeixinBotCredential,
  WeixinMessage,
  WeixinMessageItem,
} from './weixin-api.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'im'

/**
 * Services required before an IM channel may open a conversation Session.
 * Matches the create/resume + Workspace path used by {@link openImConversation}.
 * `configEditor` is required by setup remotes that persist channel enablement.
 */
export const inject = [
  'agentDefaultModel',
  'agents',
  'attachments',
  'configEditor',
  'credentials',
  'sessionPersistence',
  'sessionQuery',
  'workspaceRegistry',
]

/** Mount the IM integration host services.
 * The package's `./typert` artifact is generated into `lib/` by the host
 * bundle, and `dsh-typert-loader` registers it for this Loader entry; importing
 * it here would read an artifact this face has not produced yet.
 */
export function apply(ctx: Context, config: Config): void {
  const status = new ImStatusService(ctx)
  new ImSetupService(ctx, config)
  ctx.effect(() => applyImRuntime(ctx, config, status), 'im: platform status reconcile')

  ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(
      () => connectionCtx.connection.fetch.register({
        path: WEIXIN_QRCODE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: () => handleWeixinQrCode(ctx, config),
      }),
      'im: weixin qr code route',
    )
    connectionCtx.effect(
      () => connectionCtx.connection.fetch.register({
        path: WEIXIN_STATUS_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: request => handleWeixinQrStatus(request),
      }),
      'im: weixin qr status route',
    )
  })
}
