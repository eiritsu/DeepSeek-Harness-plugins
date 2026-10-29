/** Translate authorized WeChat ClawBot messages into durable Harness Agent turns. */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import { imSessionId, openImConversation } from './conversation.ts'
import {
  extractWeixinText,
  weixinGetUpdates,
  weixinMessageId,
  weixinNotifyStart,
  weixinNotifyStop,
  weixinSendText,
  type WeixinBotCredential,
  type WeixinMessage,
} from './weixin-api.ts'
import {
  ILINK_LONG_POLL_TIMEOUT_MS,
  ILINK_MESSAGE_TYPE,
  ILINK_STALE_TOKEN_ERRCODE,
} from './weixin-ilink-protocol.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * Producing message fields for one WeChat ClawBot message; the bridge reads
     * its platform id for duplicate suppression.
     * Unknown producer kinds and metadata remain readable without this package.
     * @persistenceAttribution
     */
    weixin: {
      kind: 'weixin'
      botId: string
      conversationId: string
      messageId: string
      senderId: string
    }
  }
}

/** Options for one WeChat ClawBot conversation bridge. */
export interface WeixinConversationOptions {
  /** Parsed bot credential from Host credentials. */
  readonly credential: WeixinBotCredential
  /** When true, only {@link allowedSenderIds} may open a turn. */
  readonly whitelistEnabled: boolean
  /** Sender ids allowed when whitelist is enabled (plus credential.userId when set). */
  readonly allowedSenderIds: readonly string[]
  /** Maximum wait for one completed Harness turn. */
  readonly responseTimeoutMs: number
  /** Current default route used by new and resumed conversation agents. */
  readonly currentSelection: () => ModelSelection
  /** Optional home override for sync-buf persistence (tests). */
  readonly home?: string
}

interface TurnResult { readonly message?: AssistantMessage; readonly failed: boolean }
interface TurnWait { readonly promise: Promise<TurnResult>; cancel(reason: unknown): void }

const MAX_CONSECUTIVE_FAILURES = 3
const BACKOFF_DELAY_MS = 30_000
const RETRY_DELAY_MS = 2_000
const STALE_TOKEN_PAUSE_MS = 60 * 60 * 1000

/**
 * Own the getUpdates long-poll, per-conversation Agent queue, and outbound text replies.
 */
export class WeixinConversationBridge {
  private readonly abort = new AbortController()
  private readonly inFlight = new Set<Promise<void>>()
  private readonly queues = new Map<SessionId, Promise<void>>()
  private readonly reservations = new Set<string>()
  private readonly handles = new Map<SessionId, AgentHandle>()
  private readonly creations = new Map<SessionId, Promise<Agent>>()
  private readonly contextTokens = new Map<string, string>()
  private monitor: Promise<void> | undefined
  private disposal: Promise<void> | undefined
  private readonly accountKey: string
  private readonly allowSet: ReadonlySet<string>

  /** Bind Host services to one authenticated WeChat bot credential. */
  constructor(
    private readonly ctx: Context,
    private readonly options: WeixinConversationOptions,
  ) {
    const { credential } = options
    this.accountKey = credential.botId
      ?? credential.userId
      ?? hashToken(credential.token)
    const allowed = new Set(options.allowedSenderIds.map(id => id.trim()).filter(id => id.length > 0))
    if (credential.userId !== undefined) allowed.add(credential.userId)
    this.allowSet = allowed
  }

  /** Notify iLink and start the getUpdates loop. Resolves once the monitor is running. */
  async connect(): Promise<void> {
    this.ctx.fiber.assertActive()
    const { credential } = this.options
    await weixinNotifyStart({
      baseUrl: credential.baseUrl,
      token: credential.token,
      abortSignal: this.abort.signal,
    })
    if (this.abort.signal.aborted) return
    this.monitor = this.runMonitor().catch((error: unknown) => {
      if (!this.abort.signal.aborted) {
        this.ctx.logger.warn(
          `WeChat getUpdates monitor ended: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    })
  }

  /** Stop ingress, drain accepted operations, notify stop, and dispose owned Agents. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposal = this.disposeOwnedResources()
    return this.disposal
  }

  private async disposeOwnedResources(): Promise<void> {
    if (!this.abort.signal.aborted) this.abort.abort(new Error('WeChat conversation bridge disposed'))
    const failures: unknown[] = []
    if (this.monitor !== undefined) {
      const monitorResult = await Promise.allSettled([this.monitor])
      for (const result of monitorResult) if (result.status === 'rejected') failures.push(result.reason)
    }
    try {
      await weixinNotifyStop({
        baseUrl: this.options.credential.baseUrl,
        token: this.options.credential.token,
      })
    } catch (error: unknown) {
      failures.push(error)
    }
    const operations = await Promise.allSettled([...this.inFlight])
    for (const result of operations) if (result.status === 'rejected') failures.push(result.reason)
    const agents = await Promise.allSettled([...this.handles.values()].map(handle => handle.dispose()))
    for (const result of agents) if (result.status === 'rejected') failures.push(result.reason)
    this.handles.clear()
    if (failures.length > 0) throw new AggregateError(failures, 'WeChat conversation bridge disposal failed')
  }

  private async runMonitor(): Promise<void> {
    const { credential } = this.options
    let getUpdatesBuf = await loadGetUpdatesBuf(this.syncBufPath())
    let nextTimeoutMs = ILINK_LONG_POLL_TIMEOUT_MS
    let consecutiveFailures = 0

    while (!this.abort.signal.aborted) {
      try {
        const resp = await weixinGetUpdates({
          baseUrl: credential.baseUrl,
          token: credential.token,
          getUpdatesBuf,
          timeoutMs: nextTimeoutMs,
          abortSignal: this.abort.signal,
        })
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- abort can happen concurrently during await
        if (this.abort.signal.aborted) return

        if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
          nextTimeoutMs = resp.longpolling_timeout_ms
        }

        const isApiError =
          (resp.ret !== undefined && resp.ret !== 0)
          || (resp.errcode !== undefined && resp.errcode !== 0)
        if (isApiError) {
          if (resp.errcode === ILINK_STALE_TOKEN_ERRCODE || resp.ret === ILINK_STALE_TOKEN_ERRCODE) {
            this.ctx.logger.error(
              `WeChat bot token is stale (errcode ${ILINK_STALE_TOKEN_ERRCODE}); pausing getUpdates for 1h`,
            )
            consecutiveFailures = 0
            await sleep(STALE_TOKEN_PAUSE_MS, this.abort.signal)
            continue
          }
          consecutiveFailures += 1
          this.ctx.logger.warn(
            `WeChat getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ''} (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
          )
          await sleep(
            consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS,
            this.abort.signal,
          )
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) consecutiveFailures = 0
          continue
        }

        consecutiveFailures = 0
        if (resp.get_updates_buf != null && resp.get_updates_buf !== '') {
          getUpdatesBuf = resp.get_updates_buf
          await saveGetUpdatesBuf(this.syncBufPath(), getUpdatesBuf)
        }
        for (const message of resp.msgs ?? []) {
          this.accept(message)
        }
      } catch (error: unknown) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- abort can happen concurrently during await
        if (this.abort.signal.aborted) return
        consecutiveFailures += 1
        this.ctx.logger.warn(
          `WeChat getUpdates error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${error instanceof Error ? error.message : String(error)}`,
        )
        await sleep(
          consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? BACKOFF_DELAY_MS : RETRY_DELAY_MS,
          this.abort.signal,
        )
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) consecutiveFailures = 0
      }
    }
  }

  private accept(message: WeixinMessage): void {
    if (this.abort.signal.aborted) return
    if (message.message_type !== undefined && message.message_type !== ILINK_MESSAGE_TYPE.USER) return
    const senderId = message.from_user_id?.trim() ?? ''
    if (senderId.length === 0) return
    if (this.options.whitelistEnabled && !this.allowSet.has(senderId)) {
      this.ctx.logger.info(`WeChat dropping unauthorized sender=${senderId}`)
      return
    }
    const messageId = weixinMessageId(message)
    if (messageId === undefined) return
    const contextToken = message.context_token?.trim()
    if (contextToken !== undefined && contextToken.length > 0) {
      this.contextTokens.set(senderId, contextToken)
    }

    const sessionId = imSessionId('weixin', senderId)
    const reservation = `${sessionId}\0${messageId}`
    if (this.reservations.has(reservation)) return
    this.reservations.add(reservation)

    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      if (!this.abort.signal.aborted) {
        await this.handleMessage(message, messageId, senderId, sessionId)
      }
    }).finally(() => {
      this.reservations.delete(reservation)
      if (this.queues.get(sessionId) === operation) this.queues.delete(sessionId)
    }).catch((error: unknown) => {
      this.ctx.logger.warn(`WeChat queued message failed: ${String(error)}`)
    })
    this.queues.set(sessionId, operation)
    this.inFlight.add(operation)
    void operation.finally(() => this.inFlight.delete(operation))
  }

  private async handleMessage(
    message: WeixinMessage,
    messageId: string,
    senderId: string,
    sessionId: SessionId,
  ): Promise<void> {
    try {
      const agent = await this.ensureAgent(sessionId, senderId)
      if (await this.wasAccepted(agent, messageId)) return
      const text = extractWeixinText(message)
      if (text.length === 0) {
        await this.sendReply(senderId, '暂不支持这类消息内容。')
        return
      }
      const wait = this.waitForTurn(agent, messageId)
      try {
        agent.followup(createUserMessage({
          content: [{ type: 'text', text }],
          source: {
            kind: 'weixin',
            botId: this.accountKey,
            conversationId: senderId,
            messageId,
            senderId,
          },
        }))
      } catch (error: unknown) {
        wait.cancel(error)
        void wait.promise.catch(() => {})
        throw error
      }
      await this.reply(senderId, await wait.promise)
    } catch (error: unknown) {
      if (this.abort.signal.aborted) return
      this.ctx.logger.warn(`WeChat message handling failed: ${error instanceof Error ? error.message : String(error)}`)
      try {
        await this.sendReply(senderId, '处理消息时发生错误，请稍后重试。')
      } catch (replyError: unknown) {
        this.ctx.logger.warn(`WeChat error reply failed: ${String(replyError)}`)
      }
    }
  }

  /**
   * Reuse a live Agent for this conversation, or open one via {@link openImConversation}.
   * Handles stay owned until {@link dispose}; disposing after each turn removes the
   * Session from the Host store and the client Workspace list.
   */
  private async ensureAgent(sessionId: SessionId, senderId: string): Promise<Agent> {
    const current = this.ctx.agents.get(sessionId)
    if (current !== undefined && this.handles.has(sessionId)) return current
    let creation = this.creations.get(sessionId)
    if (creation === undefined) {
      creation = this.openAgent(sessionId, senderId).finally(() => this.creations.delete(sessionId))
      this.creations.set(sessionId, creation)
    }
    return creation
  }

  private async openAgent(sessionId: SessionId, senderId: string): Promise<Agent> {
    const opened = await openImConversation(this.ctx, {
      platform: 'weixin',
      conversationKey: senderId,
      selection: this.options.currentSelection(),
      signal: this.abort.signal,
    })
    if (opened.sessionId !== sessionId) {
      await opened.handle.dispose()
      throw new Error(`WeChat session id mismatch: expected ${sessionId}, got ${opened.sessionId}`)
    }
    this.handles.set(sessionId, opened.handle)
    return opened.agent
  }

  private async wasAccepted(agent: Agent, messageId: string): Promise<boolean> {
    using observation = await this.ctx.sessionQuery.observeSession(agent.id, { signal: this.abort.signal })
    return observation.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'weixin'
      && event.data.source.botId === this.accountKey
      && event.data.source.messageId === messageId)
  }

  private async reply(senderId: string, result: TurnResult): Promise<void> {
    const blocks = result.message?.content ?? []
    const text = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
    if (text !== '') {
      await this.sendReply(senderId, text)
      return
    }
    await this.sendReply(
      senderId,
      result.failed ? '本次处理未能完成，请稍后重试。' : '处理已完成，但没有可发送的内容。',
    )
  }

  private async sendReply(senderId: string, text: string): Promise<void> {
    const contextToken = this.contextTokens.get(senderId)
    await weixinSendText({
      baseUrl: this.options.credential.baseUrl,
      token: this.options.credential.token,
      toUserId: senderId,
      text,
      ...(contextToken === undefined ? {} : { contextToken }),
      abortSignal: this.abort.signal,
    })
  }

  private waitForTurn(agent: Agent, messageId: string): TurnWait {
    const cancel = new AbortController()
    const signal = AbortSignal.any([this.abort.signal, cancel.signal, AbortSignal.timeout(this.options.responseTimeoutMs)])
    const promise = new Promise<TurnResult>((resolve, reject) => {
      let accepted = false
      let latest: AssistantMessage | undefined
      let settled = false
      const finish = (result?: TurnResult, error?: unknown): void => {
        if (settled) return
        settled = true
        off()
        signal.removeEventListener('abort', onAbort)
        if (error === undefined) resolve(result as TurnResult)
        else reject(error instanceof Error ? error : new Error('WeChat turn failed', { cause: error }))
      }
      const off = this.ctx.on('session/event', (session, event) => {
        if (session !== agent.session) return
        if (
          event.type === 'user/message'
          && event.data.source.kind === 'weixin'
          && event.data.source.messageId === messageId
        ) {
          accepted = true
          return
        }
        if (!accepted) return
        if (event.type === 'assistant/message') latest = event.data.message
        else if (event.type === 'turn/end') {
          finish({
            ...(latest === undefined ? {} : { message: latest }),
            failed: event.data.reason.kind === 'error' || event.data.reason.kind === 'aborted',
          })
        }
      })
      const onAbort = (): void => { finish(undefined, signal.reason) }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
    return { promise, cancel: (reason) => { cancel.abort(reason) } }
  }

  private syncBufPath(): string {
    const home = this.options.home ?? resolveDshHome()
    return join(home, 'im', 'weixin', this.accountKey, 'get_updates_buf')
  }
}

function hashToken(token: string): string {
  let hash = 0
  for (let i = 0; i < token.length; i++) hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0
  return `tok-${(hash >>> 0).toString(16)}`
}

async function loadGetUpdatesBuf(path: string): Promise<string> {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

async function saveGetUpdatesBuf(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value, 'utf8')
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted', { cause: signal.reason }))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted', { cause: signal.reason }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
