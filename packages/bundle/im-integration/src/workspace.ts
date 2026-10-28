/** Per-conversation Workspace ownership for IM channel sessions. */

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-workspace'
import type { ImPlatform } from './types.ts'

/** Absolute cwd and registry entity for one IM conversation. */
export interface ImConversationWorkspace {
  /** Fully qualified working directory created for this conversation. */
  readonly cwd: string
  /** Registry entity bound to {@link cwd}. */
  readonly workspace: Workspace
}

/**
 * Stable digest for one IM conversation identity.
 * Provider ids stay out of the directory name.
 * @param platform - IM channel that owns the conversation.
 * @param conversationKey - Opaque, stable conversation identity from that channel.
 * @returns hex digest used under the platform workspace root.
 */
export function imConversationDigest(platform: ImPlatform, conversationKey: string): string {
  return createHash('sha256')
    .update('im-workspace-v1\0')
    .update(platform)
    .update('\0')
    .update(conversationKey)
    .digest('hex')
    .slice(0, 32)
}

/**
 * Absolute directory for one IM conversation Workspace.
 * @param platform - IM channel that owns the conversation.
 * @param conversationKey - Opaque, stable conversation identity from that channel.
 * @param home - Optional DSH home override (tests).
 * @returns fully qualified directory path under `workspaces/im/<platform>/`.
 */
export function imConversationCwd(
  platform: ImPlatform,
  conversationKey: string,
  home: string = resolveDshHome(),
): string {
  return join(home, 'workspaces', 'im', platform, imConversationDigest(platform, conversationKey))
}

/**
 * Ensure the on-disk directory and Workspace registry entry exist before a Session starts.
 * Every IM channel conversation gets its own Workspace; channels never share cwd.
 * @param ctx - Host context with `workspaceRegistry`.
 * @param platform - IM channel that owns the conversation.
 * @param conversationKey - Opaque, stable conversation identity from that channel.
 * @returns cwd and registry Workspace ready for `agents.create` / `attachSession`.
 */
export async function ensureImConversationWorkspace(
  ctx: Context,
  platform: ImPlatform,
  conversationKey: string,
): Promise<ImConversationWorkspace> {
  const key = conversationKey.trim()
  if (key === '') {
    throw new Error(`im: ${platform} conversation key must be non-empty before creating a Workspace`)
  }
  const cwd = imConversationCwd(platform, key)
  await mkdir(cwd, { recursive: true })
  const workspace = await ctx.workspaceRegistry.resolveByPath(cwd)
    ?? await ctx.workspaceRegistry.create(cwd, `IM ${platform}`)
  return { cwd, workspace }
}
