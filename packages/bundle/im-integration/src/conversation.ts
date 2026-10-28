/** Open or resume an IM conversation Agent only after its dedicated Workspace exists. */

import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import type { ImPlatform } from './types.ts'
import { ensureImConversationWorkspace } from './workspace.ts'

/** Inputs required to open one IM conversation Session. */
export interface OpenImConversationOptions {
  /** IM channel that owns the conversation. */
  readonly platform: ImPlatform
  /** Opaque, stable conversation identity from that channel (chat id, peer id, …). */
  readonly conversationKey: string
  /** Model route for a newly created Agent. */
  readonly selection: ModelSelection
  /** Cancellation for create/resume and Workspace preparation. */
  readonly signal?: AbortSignal
}

/** Result of opening an IM conversation after its Workspace is ready. */
export interface OpenImConversationResult {
  /** Stable Session id derived from platform + conversation identity. */
  readonly sessionId: SessionId
  /** Working directory owned exclusively by this conversation. */
  readonly cwd: string
  /** Live Agent handle; caller owns disposal. */
  readonly handle: AgentHandle
  /** Convenience alias for `handle.agent`. */
  readonly agent: Agent
}

/**
 * Derive an opaque, stable Session id for one IM conversation.
 * @param platform - IM channel that owns the conversation.
 * @param conversationKey - Opaque conversation identity from that channel.
 * @returns branded Session id that does not embed provider ids.
 */
export function imSessionId(platform: ImPlatform, conversationKey: string): SessionId {
  const digest = createHash('sha256')
    .update('im-session-v1\0')
    .update(platform)
    .update('\0')
    .update(conversationKey)
    .digest('hex')
  return SessionId(`im-${platform}-${digest.slice(0, 32)}`)
}

/**
 * Create or resume an Agent for one IM conversation.
 * Always prepares an independent Workspace for that conversation before Session create/resume.
 * @param ctx - Host context with agents, persistence, and workspaceRegistry.
 * @param options - platform conversation identity and model selection.
 * @returns session id, cwd, and Agent handle.
 */
export async function openImConversation(
  ctx: Context,
  options: OpenImConversationOptions,
): Promise<OpenImConversationResult> {
  const conversationKey = options.conversationKey.trim()
  if (conversationKey === '') {
    throw new Error(`im: ${options.platform} conversation key must be non-empty`)
  }
  const { cwd, workspace } = await ensureImConversationWorkspace(ctx, options.platform, conversationKey)
  const sessionId = imSessionId(options.platform, conversationKey)
  const signal = options.signal
  const persisted = await ctx.sessionPersistence.stat(sessionId, { ...(signal === undefined ? {} : { signal }) }) !== undefined
  const agentOptions = {
    provider: options.selection.provider,
    model: options.selection.model,
    ...(options.selection.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: options.selection.reasoningEffort }),
  }
  const handle = persisted
    ? await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions,
      ...(signal === undefined ? {} : { signal }),
    })
    : await ctx.agents.create({
      sessionId,
      agentOptions,
      meta: { cwd },
      ...(signal === undefined ? {} : { signal }),
    })
  try {
    await workspace.attachSession(sessionId)
  } catch (error: unknown) {
    await handle.dispose()
    throw error
  }
  return { sessionId, cwd, handle, agent: handle.agent }
}
