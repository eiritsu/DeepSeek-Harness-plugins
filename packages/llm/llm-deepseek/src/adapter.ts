/** Direct Messages transport with one cancellable lifecycle per model request. */

import { attributionHeaders, LlmAdapter, LlmError, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ImageAttachmentAccessResolver, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { DeepSeekLlmApiJson } from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { connectionForModel, modelInfo } from './model-info.ts'
import type { DeepSeekAdapterOptions, DeepSeekConnectionOptions as Connection } from './types.ts'
import { DeepSeekFileStore } from './file-store.ts'
import { MESSAGES_FILES_BETA, MESSAGES_TOOL_CHANGES_BETA, messagesApiRoot } from './messages-api.ts'
import { FileResolutionFailure, RequestFiles } from './request-files.ts'
import { prepareRequestExtensions } from './request-extensions.ts'
import { imagePricing, inlineImages, prepareFileIds, prepareImages } from './images.ts'
import { serialize } from './serialize.ts'
import { parseSse } from './sse.ts'
import { translate } from './translate.ts'
import { providerError, providerErrorDetail } from './transport.ts'

/** DeepSeek provider using Messages content and native thinking replay. */
export class DeepSeekAdapter<C extends Connection = Connection> extends LlmAdapter {
  private readonly files: DeepSeekFileStore
  private readonly imageAccess: ImageAttachmentAccessResolver = (ref) => {
    const attachments = this.dependencies.resolveAttachments?.()
    return attachments === undefined ? undefined : this.dependencies.resolveImageAccess?.(attachments, ref)
  }

  constructor(private readonly dependencies: DeepSeekAdapterOptions<C>) {
    super()
    this.files = dependencies.resolveFiles?.() ?? new DeepSeekFileStore()
  }

  override providerInfo(provider: string) { return { id: provider, name: this.dependencies.providerName ?? 'DeepSeek' } }
  override providerRetryPolicy(_provider: string) { return this.dependencies.options().retryPolicy }
  override async listModels(provider: string) {
    return this.dependencies.discoverModels?.(provider) ?? []
  }
  override async resolveModel(provider: string, model: string, signal?: AbortSignal) {
    const connection = this.dependencies.options()
    return this.resolveModelInfo(connection, provider, model, signal)
  }
  override imageRequestPricing(_provider: string, model: string) {
    const connection = this.dependencies.options()
    const metadata = this.dependencies.resolveModelMetadataSnapshot?.({
      provider: _provider, model, baseURL: connection.baseURL, api: 'anthropic-messages',
    })
    const explicit = connection.explicitModelMetadata?.find(entry => entry.id === model)
    const modalities = explicit !== undefined && Object.hasOwn(explicit, 'inputModalities')
      ? explicit.inputModalities
      : metadata?.inputModalities
    return imagePricing(connection, model, this.imageAccess, modalities)
  }
  override prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const connection = this.dependencies.options()
    return this.resolveModelInfo(connection, provider, model, _signal).then(resolved => ({
      model: resolved,
      stream: options => this.generate(options, connection, resolved),
    }))
  }
  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.generate(options, this.dependencies.options())
  }

  private async resolveModelInfo(connection: C, provider: string, model: string, signal?: AbortSignal) {
    try {
      const metadata = await this.dependencies.resolveModelMetadata?.({
        provider, model, baseURL: connection.baseURL, api: 'anthropic-messages',
        ...signal === undefined ? {} : { signal },
      })
      signal?.throwIfAborted()
      return modelInfo(connection, provider, model, metadata)
    } catch (error) {
      if (signal?.aborted) throw new LlmError('DeepSeek model resolution aborted', 'ABORTED', { cause: error })
      throw error
    }
  }

  private async * generate(
    options: GenerateOptions,
    connection: C,
    preparedModel?: Awaited<ReturnType<DeepSeekAdapter<C>['resolveModelInfo']>>,
  ): AsyncGenerator<StreamChunk> {
    const consumer = new AbortController()
    const signal = options.signal === undefined ? consumer.signal : AbortSignal.any([consumer.signal, options.signal])
    using watchdog = idleWatchdog(signal, connection.streamIdleTimeoutMs, 'MESSAGES_IDLE')
    let iterator: AsyncGenerator<StreamChunk> | undefined
    try {
      const model = preparedModel ?? await this.resolveModelInfo(connection, options.provider, options.model, watchdog.signal)
      const requestConnection = connectionForModel(connection, model)
      const effort = options.purpose === 'session-title'
        ? 'off'
        : options.reasoningEffort ?? model.reasoning?.defaultEffort ?? 'high'
      if (!model.reasoning?.efforts.some(item => item.id === effort)) {
        throw new LlmError(
          `DeepSeek Messages does not support reasoning effort ${effort} for ${options.provider}/${options.model}`,
          'UNSUPPORTED_REASONING_EFFORT',
        )
      }
      const resolvedOptions = options.reasoningEffort === effort
        ? options
        : { ...options, reasoningEffort: ReasoningEffortId(effort) }
      iterator = this.request(resolvedOptions, requestConnection as C, watchdog.signal, () => { watchdog.pulse() })
      while (true) {
        const next = await watchdog.next(iterator)
        if (next.done) return
        yield next.value
      }
    } catch (error) {
      if (timeoutOf(watchdog.signal, 'MESSAGES_IDLE') !== undefined) throw new LlmError('DeepSeek Messages stream idle timeout', 'TIMEOUT', { cause: error })
      if (options.signal?.aborted) throw new LlmError('DeepSeek Messages request aborted', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      throw new LlmError('DeepSeek Messages transport failed', 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort()
      try { await iterator?.return(undefined) } catch (_abortedRequestCleanup) {
        // The request already settled; aborting its reader cannot replace that outcome.
      }
    }
  }

  private async * request(
    options: GenerateOptions, connection: C, signal: AbortSignal, activity: () => void,
  ): AsyncGenerator<StreamChunk> {
    signal.throwIfAborted()
    const { messages, versions } = await prepareImages(
      options.messages, connection, options.model, this.dependencies.resolveAttachments?.(), this.imageAccess, signal,
    )
    const auth = await this.dependencies.resolveAuth(connection)
    try {
      const files = new RequestFiles(this.files, {
        baseURL: connection.baseURL, headers: auth.headers,
      },
      connection.filePolicy, connection.filesApiTimeoutMs, signal, activity)
      let inline = false
      while (true) {
        signal.throwIfAborted()
        files.beginAttempt()
        let fileIds: Awaited<ReturnType<typeof prepareFileIds>> | undefined
        if (!inline) {
          try {
            fileIds = await prepareFileIds(messages, versions, files)
          } catch (error) {
            if (!(error instanceof FileResolutionFailure)) throw error
            inline = true
            continue
          }
        }
        const history = inline ? inlineImages(messages, versions, connection) : messages
        const body = serialize(options, connection, history, versions, this.imageAccess, (reason) => {
          this.dependencies.onReplayDegrade?.({ provider: options.provider, model: options.model, reason })
        }, fileIds)
        const extensions = await prepareRequestExtensions(body as Readonly<Record<string, DeepSeekLlmApiJson>>, {
          signal,
          ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
          ...options.purpose === undefined ? {} : { purpose: options.purpose },
        }, this.dependencies.prepareExtensions, (fields, error) => {
          this.dependencies.onExtensionsOmitted?.({ provider: options.provider, model: options.model, fields, error })
        })
        signal.throwIfAborted()
        const betas = [
          ...fileIds !== undefined && fileIds.size > 0 ? [MESSAGES_FILES_BETA] : [],
          ...body.messages.some(message => message.content.some(block => block.type === 'tool_addition' || block.type === 'tool_removal'))
            ? [MESSAGES_TOOL_CHANGES_BETA]
            : [],
        ]
        const response = await fetch(`${messagesApiRoot(connection.baseURL)}/messages`, {
          method: 'POST', signal, body: extensions.payload, redirect: 'error',
          headers: {
            ...attributionHeaders(),
            'content-type': 'application/json', 'accept': 'text/event-stream',
            ...auth.headers,
            'anthropic-version': '2023-06-01',
            ...betas.length === 0 ? {} : { 'anthropic-beta': betas.join(',') },
            'x-deepseek-harness-user-id': this.dependencies.resolveUserId(),
            ...options.sessionId === undefined ? {} : { 'x-deepseek-harness-session-id': String(options.sessionId) },
            ...options.purpose === 'compaction' ? { 'x-deepseek-harness-compact': '1' } : {},
          },
        })
        if (!response.ok) {
          const text = await response.text()
          let raw: unknown
          try { raw = JSON.parse(text) } catch (_nonJsonGatewayError) {
            // HTTP status is authoritative when a gateway does not return JSON.
          }
          const detail = providerErrorDetail(raw)
          if (await files.retry(detail)) continue
          const failure = providerError(raw, response.status, response.headers)
          const message = files.errorMessage(response.status, failure.message, detail)
          throw new LlmError(message, failure.code, { ...failure.failure, cause: new Error(text) })
        }
        await extensions.accept()
        if (response.body === null) throw new LlmError('DeepSeek Messages returned no response body', 'EMPTY_RESPONSE')
        yield* translate(parseSse(response.body, activity), options.model)
        return
      }
    } catch (error) {
      if (auth.onRequestError !== undefined) {
        let mapped: unknown
        try { mapped = await auth.onRequestError(error) }
        catch (_credentialUpdateFailed) { throw error }
        throw mapped
      }
      throw error
    }
  }
}
