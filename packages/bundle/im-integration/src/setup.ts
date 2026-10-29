/** Bundle-owned setup operations for IM channel authorization. */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-config-editor'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Config } from './config.ts'
import type { ImSetupResult, WeixinAuthorizationPayload } from './types.ts'

const WEIXIN_BOT_TOKEN = credentialRef('WEIXIN_BOT_TOKEN')

/** Persist channel authorization without returning secrets to Client. */
export class ImSetupService extends TypertRemoteService {
  private setupMutationTail: Promise<void> = Promise.resolve()

  /** @param ctx - Host context that owns the IM integration.
   * @param config - live IM configuration used by setup operations.
   */
  constructor(
    ctx: Context,
    private readonly config: Config,
  ) {
    super(ctx, 'imSetup')
  }

  /** Persist a successful WeChat ClawBot QR authorization and enable the channel.
   * @param authorization - non-empty bot token and optional bot/user ids from iLink.
   * @returns a safe setup result without the token value.
   */
  @Remote('commitWeixinAuthorization')
  async commitWeixinAuthorization(
    authorization: WeixinAuthorizationPayload,
  ): Promise<ImSetupResult<{ readonly botId?: string; readonly userId?: string }>> {
    const token = authorization.token.trim()
    if (token.length === 0) return { ok: false, code: 'not-configured' }
    const botId = authorization.botId?.trim()
    const userId = authorization.userId?.trim()
    const baseUrl = authorization.baseUrl?.trim()
    const payload = JSON.stringify({
      token,
      ...(botId === undefined || botId.length === 0 ? {} : { botId }),
      ...(userId === undefined || userId.length === 0 ? {} : { userId }),
      ...(baseUrl === undefined || baseUrl.length === 0 ? {} : { baseUrl }),
    })
    try {
      return await this.withSetupMutation(async () => {
        const secretRef = this.weixinSecretRef()
        await this.ctx.credentials.set(secretRef, payload)
        try {
          const row = this.imConfigRow()
          if (row !== undefined) {
            await this.ctx.configEditor.edit(row.entry, current => ({
              ...current,
              enabled: true,
              weixinEnabled: true,
              activePlatform: 'weixin',
              weixinBotTokenEnv: String(secretRef),
            }))
          }
        } catch (error: unknown) {
          this.ctx.logger.warn(`IM configuration save deferred: ${error instanceof Error ? error.message : String(error)}`)
        }
        return {
          ok: true as const,
          ...(botId === undefined || botId.length === 0 ? {} : { botId }),
          ...(userId === undefined || userId.length === 0 ? {} : { userId }),
        }
      })
    } catch (error: unknown) {
      return { ok: false, code: errorCode(error) }
    }
  }

  /** Remove the WeChat bot credential and disable the WeChat channel.
   * @returns a safe setup result.
   */
  @Remote('clearWeixinAuthorization')
  async clearWeixinAuthorization(): Promise<ImSetupResult> {
    try {
      return await this.withSetupMutation(async () => {
        const secretRef = this.weixinSecretRef()
        await this.ctx.credentials.unset(secretRef)
        try {
          const row = this.imConfigRow()
          if (row !== undefined) {
            await this.ctx.configEditor.edit(row.entry, current => ({
              ...current,
              weixinEnabled: false,
            }))
          }
        } catch (error: unknown) {
          this.ctx.logger.warn(`IM configuration save deferred: ${error instanceof Error ? error.message : String(error)}`)
        }
        return { ok: true as const }
      })
    } catch (error: unknown) {
      return { ok: false, code: errorCode(error) }
    }
  }

  private weixinSecretRef() {
    const configured = this.config.weixinBotTokenEnv.get().trim()
    return credentialRef(configured || String(WEIXIN_BOT_TOKEN))
  }

  private imConfigRow() {
    const isImEntry = (options: { id?: string; name?: string } | undefined) => {
      if (options === undefined) return false
      const id = options.id ?? ''
      const name = options.name ?? ''
      return id === 'im'
        || id === '@deepseek-ai/dsh-im-integration'
        || id.includes('im-integration')
        || name === 'im'
        || name === '@deepseek-ai/dsh-im-integration'
        || name.includes('im-integration')
    }
    const rows = this.ctx.configEditor.configuration().filter(({ entry }) =>
      isImEntry(entry.options as { id?: string; name?: string } | undefined),
    )
    return rows.length > 0 ? rows[0] : undefined
  }

  private async withSetupMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.setupMutationTail
    let release!: () => void
    this.setupMutationTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

function errorCode(error: unknown): 'cancelled' | 'not-ready' | 'operation-failed' | 'not-configured' {
  if (error instanceof Error && /abort|cancel/i.test(error.name + error.message)) return 'cancelled'
  if (error instanceof Error && /not.?ready|unavailable/i.test(error.message)) return 'not-ready'
  return 'operation-failed'
}
