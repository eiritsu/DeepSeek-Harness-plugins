/** Translate authorized Feishu/Lark private messages into durable Harness Agent turns. */

import { Buffer } from 'node:buffer'
import { extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'
import type { LarkChannel, NormalizedMessage, ResourceDescriptor } from '@larksuite/channel'
import { imSessionId, openImConversation } from './conversation.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * Producing message fields for one Lark message; the bridge reads its platform id for duplicate suppression.
     * Unknown producer kinds and metadata remain readable without this package.
     * @persistenceAttribution
     */
    lark: {
      kind: 'lark'
      appId: string
      chatId: string
      messageId: string
      senderId: string
    }
  }
}

/** Options for one Feishu/Lark conversation bridge. */
export interface LarkConversationOptions {
  /** Application identity recorded on each message source and hashed into stable Session ids. */
  readonly appId: string
  /** When true, only {@link allowedSenderIds} may open a turn. */
  readonly whitelistEnabled: boolean
  /** Sender IDs allowed when whitelist is enabled. */
  readonly allowedSenderIds: readonly string[]
  /** Maximum wait for one completed Harness turn. */
  readonly responseTimeoutMs: number
  /** Current default route used by new and resumed private-chat agents. */
  readonly currentSelection: () => ModelSelection
}

const IMAGE_TYPES = new Set<ImageMediaType>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function imageType(contentType: string | undefined, filename: string | undefined): ImageMediaType | undefined {
  const normalized = contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (normalized !== undefined && IMAGE_TYPES.has(normalized as ImageMediaType)) return normalized as ImageMediaType
  switch (extname(filename ?? '').toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return undefined
  }
}

interface TurnResult { readonly message?: AssistantMessage; readonly failed: boolean }
interface TurnWait { readonly promise: Promise<TurnResult>; cancel(reason: unknown): void }

/** Own the Lark Channel subscription, queued message operations, and Agents it creates. */
export class LarkConversationBridge {
  private readonly abort = new AbortController()
  private readonly inFlight = new Set<Promise<void>>()
  private readonly queues = new Map<SessionId, Promise<void>>()
  private readonly reservations = new Set<string>()
  private readonly handles = new Map<SessionId, AgentHandle>()
  private readonly creations = new Map<SessionId, Promise<Agent>>()
  private readonly subscriptions: Array<() => void> = []
  private connected = false
  private connecting: Promise<void> | undefined
  private disposal: Promise<void> | undefined

  /** Bind a Channel instance to the DSH Agent, persistence, attachment, and Workspace services. */
  constructor(
    private readonly ctx: Context,
    private readonly channel: LarkChannel,
    private readonly options: LarkConversationOptions,
  ) {}

  /** Subscribe to Channel events and complete its initial long-connection handshake. */
  async connect(): Promise<void> {
    if (this.connected) return
    this.ctx.fiber.assertActive()
    this.subscriptions.push(
      this.channel.on('message', (message) => { this.accept(message) }),
      this.channel.on('error', (error) => {
        if (!this.abort.signal.aborted) this.ctx.logger.warn(`Lark channel error: ${String(error)}`)
      }),
    )
    try {
      const connecting = this.channel.connect()
      this.connecting = connecting
      await connecting
      if (this.abort.signal.aborted) {
        await this.channel.disconnect()
        return
      }
      this.connected = true
    } catch (error: unknown) {
      this.unsubscribe()
      throw error
    } finally {
      this.connecting = undefined
    }
  }

  /** Stop ingress, drain accepted operations, disconnect, and dispose owned Agents. */
  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.disposal = this.disposeOwnedResources()
    return this.disposal
  }

  private async disposeOwnedResources(): Promise<void> {
    if (!this.abort.signal.aborted) this.abort.abort(new Error('Lark conversation bridge disposed'))
    this.unsubscribe()
    const failures: unknown[] = []
    const connecting = this.connecting
    const firstDisconnect = await Promise.allSettled([Promise.resolve().then(() => this.channel.disconnect())])
    for (const result of firstDisconnect) if (result.status === 'rejected') failures.push(result.reason)
    if (connecting !== undefined) {
      await Promise.allSettled([connecting])
      const finalDisconnect = await Promise.allSettled([Promise.resolve().then(() => this.channel.disconnect())])
      for (const result of finalDisconnect) if (result.status === 'rejected') failures.push(result.reason)
    }
    const operations = await Promise.allSettled([...this.inFlight])
    for (const result of operations) if (result.status === 'rejected') failures.push(result.reason)
    const agents = await Promise.allSettled([...this.handles.values()].map(handle => handle.dispose()))
    for (const result of agents) if (result.status === 'rejected') failures.push(result.reason)
    this.handles.clear()
    this.connected = false
    if (failures.length > 0) throw new AggregateError(failures, 'Lark conversation bridge disposal failed')
  }

  private unsubscribe(): void {
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe()
  }

  private accept(message: NormalizedMessage): void {
    if (this.abort.signal.aborted || message.chatType !== 'p2p') return
    if (this.options.whitelistEnabled && !this.options.allowedSenderIds.includes(message.senderId)) {
      this.ctx.logger.info(`Lark dropping unauthorized sender=${message.senderId}`)
      return
    }
    const sessionId = imSessionId('lark', message.chatId)
    const reservation = `${sessionId}\0${message.messageId}`
    if (this.reservations.has(reservation)) return
    this.reservations.add(reservation)

    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      if (!this.abort.signal.aborted) await this.handleMessage(message, sessionId)
    }).finally(() => {
      this.reservations.delete(reservation)
      if (this.queues.get(sessionId) === operation) this.queues.delete(sessionId)
    }).catch((error: unknown) => {
      this.ctx.logger.warn(`Lark queued message failed: ${String(error)}`)
    })
    this.queues.set(sessionId, operation)
    this.inFlight.add(operation)
    void operation.finally(() => this.inFlight.delete(operation))
  }

  private async handleMessage(message: NormalizedMessage, sessionId: SessionId): Promise<void> {
    try {
      const agent = await this.ensureAgent(sessionId, message.chatId)
      if (await this.wasAccepted(agent, message.messageId)) return
      const content = await this.messageContent(message)
      if (content.length === 0) {
        await this.channel.reply(message, { text: '暂不支持这类消息内容。' })
        return
      }
      const wait = this.waitForTurn(agent, message.messageId)
      try {
        agent.followup(createUserMessage({
          content,
          source: {
            kind: 'lark',
            appId: this.options.appId,
            chatId: message.chatId,
            messageId: message.messageId,
            senderId: message.senderId,
          },
        }))
      } catch (error: unknown) {
        wait.cancel(error)
        void wait.promise.catch(() => {})
        throw error
      }
      await this.reply(message, await wait.promise)
    } catch (error: unknown) {
      if (this.abort.signal.aborted) return
      this.ctx.logger.warn(`Lark message handling failed: ${error instanceof Error ? error.message : String(error)}`)
      try {
        await this.channel.reply(message, { text: '处理消息时发生错误，请稍后重试。' })
      } catch (replyError: unknown) {
        this.ctx.logger.warn(`Lark error reply failed: ${String(replyError)}`)
      }
    }
  }

  private async wasAccepted(agent: Agent, messageId: string): Promise<boolean> {
    using observation = await this.ctx.sessionQuery.observeSession(agent.id, { signal: this.abort.signal })
    return observation.events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'lark'
      && event.data.source.appId === this.options.appId
      && event.data.source.messageId === messageId)
  }

  private async messageContent(message: NormalizedMessage): Promise<ContentBlock[]> {
    const content: ContentBlock[] = message.content.trim() === '' ? [] : [{ type: 'text', text: message.content }]
    for (const resource of message.resources) {
      if (resource.type !== 'image' && resource.type !== 'file') continue
      const prepared = await this.download(message.messageId, resource)
      if (prepared.kind === 'image') content.push({ type: 'image', attachment: await this.ctx.attachments.saveImage(prepared.input) })
      else content.push({ type: 'file', attachment: await this.ctx.attachments.saveFile(prepared.input) })
    }
    return content
  }

  private async download(messageId: string, resource: ResourceDescriptor): Promise<
    | { readonly kind: 'image'; readonly input: { data: Uint8Array; mediaType: ImageMediaType; name?: string } }
    | { readonly kind: 'file'; readonly input: { data: Uint8Array; name?: string } }
  > {
    const { buffer, contentType } = await this.channel.downloadResourceWithMeta(
      messageId, resource.fileKey, resource.type === 'image' ? 'image' : 'file',
    )
    const data = new Uint8Array(buffer)
    const mediaType = resource.type === 'image' ? imageType(contentType, resource.fileName) : undefined
    if (mediaType !== undefined) {
      return { kind: 'image', input: { data, mediaType, ...(resource.fileName === undefined ? {} : { name: resource.fileName }) } }
    }
    return { kind: 'file', input: { data, ...(resource.fileName === undefined ? {} : { name: resource.fileName }) } }
  }

  private async reply(inbound: NormalizedMessage, result: TurnResult): Promise<void> {
    const blocks = result.message?.content ?? []
    const text = blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n').trim()
    let sent = false
    if (text !== '') {
      await this.channel.reply(inbound, { text })
      sent = true
    }
    for (const block of blocks) {
      if (block.type !== 'image') continue
      const stored = await this.ctx.attachments.readImage(block.attachment, this.abort.signal)
      await this.channel.reply(inbound, { image: { source: Buffer.from(stored.data) } })
      sent = true
    }
    if (!sent) {
      await this.channel.reply(inbound, {
        text: result.failed ? '本次处理未能完成，请稍后重试。' : '处理已完成，但没有可发送的内容。',
      })
    }
  }

  private async ensureAgent(sessionId: SessionId, chatId: string): Promise<Agent> {
    const current = this.ctx.agents.get(sessionId)
    if (current !== undefined && this.handles.has(sessionId)) return current
    let creation = this.creations.get(sessionId)
    if (creation === undefined) {
      creation = this.openAgent(sessionId, chatId).finally(() => this.creations.delete(sessionId))
      this.creations.set(sessionId, creation)
    }
    return creation
  }

  private async openAgent(sessionId: SessionId, chatId: string): Promise<Agent> {
    const opened = await openImConversation(this.ctx, {
      platform: 'lark',
      conversationKey: chatId,
      selection: this.options.currentSelection(),
      signal: this.abort.signal,
    })
    if (opened.sessionId !== sessionId) {
      await opened.handle.dispose()
      throw new Error(`Lark session id mismatch: expected ${sessionId}, got ${opened.sessionId}`)
    }
    this.handles.set(sessionId, opened.handle)
    return opened.agent
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
        else reject(error instanceof Error ? error : new Error('Lark turn failed', { cause: error }))
      }
      const off = this.ctx.on('session/event', (session, event) => {
        if (session !== agent.session) return
        if (
          event.type === 'user/message'
          && event.data.source.kind === 'lark'
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
}
