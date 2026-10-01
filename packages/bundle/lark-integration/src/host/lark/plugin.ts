/** Lark/Feishu private-chat ingress for durable Harness Sessions. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { createLarkChannel } from '@larksuite/channel'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace'
import { LarkConversationBridge } from './conversation.ts'
import { LarkStatus } from './status.ts'
import type { LarkConnectionStatus } from './status.ts'
export { LarkStatus } from './status.ts'
export type { LarkConnectionStatus } from './status.ts'

interface LarkConfigSnapshot {
  appId: string
  appSecretEnv: string
  brand: 'feishu' | 'lark'
  authorizedUserOpenId: string
  enabled: boolean
  conversationCwd: string
  responseTimeoutMs: number
  handshakeTimeoutMs: number
  httpTimeoutMs: number
  cliTimeoutMs: number
  cliMaxOutputBytes: number
  cliGraceMs: number
  registrationTimeoutMs: number
}

function snapshot(config: Config): LarkConfigSnapshot {
  return {
    appId: config.appId.get(), appSecretEnv: config.appSecretEnv.get(), brand: config.brand.get(),
    authorizedUserOpenId: config.authorizedUserOpenId.get(), enabled: config.enabled.get(),
    conversationCwd: config.conversationCwd.get(), responseTimeoutMs: config.responseTimeoutMs.get(),
    handshakeTimeoutMs: config.handshakeTimeoutMs.get(), httpTimeoutMs: config.httpTimeoutMs.get(),
    cliTimeoutMs: config.cliTimeoutMs.get(), cliMaxOutputBytes: config.cliMaxOutputBytes.get(), cliGraceMs: config.cliGraceMs.get(),
    registrationTimeoutMs: config.registrationTimeoutMs.get(),
  }
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'lark'
/** Services required to create and resume private-chat Agents. */
export const inject = [
  'agentDefaultModel', 'agents', 'attachments', 'credentials', 'sessionPersistence', 'sessionQuery', 'workspaceRegistry',
]

/** Configuration editable through the profile's generated plugin settings form. */
export interface Config {
  /** Lark/Feishu application identifier. */
  appId: Volatile<string>
  /** Credential reference containing the application secret. */
  appSecretEnv: Volatile<string>
  /** Product endpoint family for the application. */
  brand: Volatile<'feishu' | 'lark'>
  /** Open ID whose private messages may create Agent turns. */
  authorizedUserOpenId: Volatile<string>
  /** Whether this plugin may open its long connection. Defaults off. */
  enabled: Volatile<boolean>
  /** Whether the model may call the official Lark CLI tool. Defaults off. */
  cliEnabled: Volatile<boolean>
  /** Working directory assigned to new chat Sessions. */
  conversationCwd: Volatile<string>
  /** Maximum time to wait for one Harness turn. */
  responseTimeoutMs: Volatile<number>
  /** Maximum time allowed for the initial Channel handshake. */
  handshakeTimeoutMs: Volatile<number>
  /** API request deadline used by Channel operations. */
  httpTimeoutMs: Volatile<number>
  /** Maximum duration of one official CLI process. */
  cliTimeoutMs: Volatile<number>
  /** Maximum captured bytes for each CLI output stream. */
  cliMaxOutputBytes: Volatile<number>
  /** Grace period before forced CLI process termination. */
  cliGraceMs: Volatile<number>
  /** Maximum wait for one official registration or user authorization flow. */
  registrationTimeoutMs: Volatile<number>
}

/** Schemastery configuration for private-chat ingress. */
export const Config = z.object({
  appId: z.string().default('').volatile(),
  appSecretEnv: z.string().role('credential-ref').default(String(credentialRef('LARK_APP_SECRET'))).volatile(),
  brand: z.union(['feishu', 'lark'] as const).default('feishu').volatile(),
  authorizedUserOpenId: z.string().default('').volatile(),
  enabled: z.boolean().default(false).volatile(),
  cliEnabled: z.boolean().default(false).volatile(),
  conversationCwd: z.string().default('').volatile(),
  responseTimeoutMs: z.number().step(1).min(1_000).max(30 * 60_000).default(10 * 60_000).volatile(),
  handshakeTimeoutMs: z.number().step(1).min(1_000).max(5 * 60_000).default(30_000).volatile(),
  httpTimeoutMs: z.number().step(1).min(1_000).max(5 * 60_000).default(30_000).volatile(),
  cliTimeoutMs: z.number().step(1).min(1_000).max(5 * 60_000).default(30_000).volatile(),
  cliMaxOutputBytes: z.number().step(1).min(1_024).max(4 * 1024 * 1024).default(256 * 1024).volatile(),
  cliGraceMs: z.number().step(1).min(100).max(30_000).default(2_000).volatile(),
  registrationTimeoutMs: z.number().step(1).min(30_000).max(15 * 60_000).default(10 * 60_000).volatile(),
})

/** Minimal status publisher required by the private-chat lifecycle. */
export interface LarkStatusPublisher {
  /** Publish the current non-sensitive connection state. */
  publish(status: LarkConnectionStatus): void
}

/** Constructor for a package-owned Remote identity that publishes Lark status. */
export type LarkStatusConstructor = new (ctx: Context, config: Config) => LarkStatusPublisher

function sameConfig(left: LarkConfigSnapshot, right: LarkConfigSnapshot): boolean {
  return left.appId === right.appId && left.appSecretEnv === right.appSecretEnv && left.brand === right.brand
    && left.authorizedUserOpenId === right.authorizedUserOpenId && left.enabled === right.enabled
    && left.conversationCwd === right.conversationCwd && left.responseTimeoutMs === right.responseTimeoutMs
    && left.handshakeTimeoutMs === right.handshakeTimeoutMs && left.httpTimeoutMs === right.httpTimeoutMs
}

/** Mount the optional Channel connection and its owned conversation Sessions. */
export function apply(ctx: Context, config: Config, Status: LarkStatusConstructor = LarkStatus): void {
  ctx.effect(() => {
    const status = new Status(ctx, config)
    let generation = 0
    let disposed = false
    /** Read the live disposal latch; the call keeps an awaiting caller from reusing a narrowed value. */
    const isDisposed = (): boolean => disposed
    let bridge: LarkConversationBridge | undefined
    let queue = Promise.resolve()
    let observedConfig = snapshot(config)
    const reconcile = async (requested: number): Promise<void> => {
      const current = snapshot(config)
      if (!current.enabled || requested !== generation || isDisposed()) return
      const appId = current.appId.trim()
      const allowedSenderId = current.authorizedUserOpenId.trim()
      if (appId === '' || allowedSenderId === '') {
        const missing = [appId === '' ? 'appId' : undefined, allowedSenderId === '' ? 'authorizedUserOpenId' : undefined]
          .filter((field): field is string => field !== undefined)
        status.publish({ state: 'error', reason: 'missing-identity' })
        ctx.logger.warn(`Lark is enabled but required configuration is missing: ${missing.join(', ')}`)
        return
      }
      const secretRef = credentialRef(current.appSecretEnv.trim())
      const secret = await ctx.credentials.resolve(secretRef)
      if (requested !== generation || isDisposed()) return
      if (secret === undefined) {
        status.publish({ state: 'error', reason: 'missing-credential' })
        ctx.logger.warn(`Lark application credential "${secretRef}" is not configured`)
        return
      }
      const configuredCwd = current.conversationCwd.trim()
      const cwd = configuredCwd || join(resolveDshHome(), 'workspaces', 'lark')
      if (configuredCwd === '') await mkdir(cwd, { recursive: true })
      if (requested !== generation || isDisposed()) return
      const nextBridge = new LarkConversationBridge(ctx, createLarkChannel({
        appId,
        appSecret: secret.value,
        domain: current.brand === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn',
        source: 'deepseek-harness',
        handshakeTimeoutMs: current.handshakeTimeoutMs,
        httpTimeoutMs: current.httpTimeoutMs,
        policy: { dmMode: 'allowlist', dmAllowlist: [allowedSenderId] },
      }), {
        appId,
        allowedSenderId,
        cwd,
        responseTimeoutMs: current.responseTimeoutMs,
        currentSelection: () => ctx.agentDefaultModel.currentSelection(),
      })
      bridge = nextBridge
      try {
        await nextBridge.connect()
      } catch (error: unknown) {
        await nextBridge.dispose()
        if (bridge === nextBridge) bridge = undefined
        if (requested === generation && !isDisposed()) {
          status.publish({ state: 'error', reason: 'connection-failed' })
          ctx.logger.warn(`Lark conversation connection failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        return
      }
      if (requested !== generation || isDisposed()) {
        if (bridge === nextBridge) bridge = undefined
      } else {
        status.publish({ state: 'connected' })
      }
    }
    const requestReconcile = (): void => {
      const requested = ++generation
      status.publish(snapshot(config).enabled ? { state: 'connecting' } : { state: 'disabled' })
      const previous = bridge
      bridge = undefined
      const stopping = previous?.dispose().catch(() => {
        ctx.logger.warn('Lark connection cleanup failed during configuration update')
      }) ?? Promise.resolve()
      queue = queue.then(async () => {
        await stopping
        await reconcile(requested)
      }).catch((error: unknown) => {
        if (requested === generation && !isDisposed()) status.publish({ state: 'error', reason: 'connection-failed' })
        ctx.logger.error(`Lark configuration reconciliation failed: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
    const stopVolatile = ctx.on('loader/volatile-update', () => {
      const next = snapshot(config)
      if (sameConfig(observedConfig, next)) return
      observedConfig = next
      requestReconcile()
    })
    const stopCredential = ctx.on('credentials/reference-updated', (ref) => {
      if (ref === config.appSecretEnv.get().trim()) requestReconcile()
    })
    requestReconcile()
    return async () => {
      disposed = true
      generation++
      stopVolatile()
      stopCredential()
      const active = bridge
      bridge = undefined
      await active?.dispose()
      await queue
      status.publish({ state: 'disabled' })
    }
  }, 'dsh-lark: conversation bridge')
}
