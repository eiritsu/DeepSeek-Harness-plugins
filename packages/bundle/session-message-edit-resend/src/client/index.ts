/** Optional Client contribution for editing and resending the latest user turn. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../projection.ts'
import type {} from '@deepseek-ai/dsh-session-message-edit-resend/remote'
import TYPERT_REMOTE from '@deepseek-ai/dsh-session-message-edit-resend/remote'
import { createEditResendDispatcher } from './submit.ts'
import { EditComposerNotice, type EditComposerNoticeInjected } from './EditComposerNotice.tsx'
import { MessageEditAction, type MessageEditActionInjected } from './MessageEditAction.tsx'
import { EditResendSurface } from './edit-surface.ts'
import { replacementMessageDefinition } from './replacement-message.ts'
import { en, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Labels for the optional edit-and-resend controls. */
    messageEditResend: import('./locales.ts').EditResendLocaleKey
  }
}

const NS = 'messageEditResend'

/** Client services required by the user-action and composer contributions. */
export const inject = ['slots', 'locale', 'remote', 'sessions', 'conversation', 'uiConversation']

/** Mount the Host Remote and register optional UI and composer behavior.
 * @param ctx - Client context for this bundle.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const scope = ctx.inject(['remote.messageEditResend'], (remoteCtx) => {
    remoteCtx.effect(() => remoteCtx.locale.register(NS, { zh, en }), 'message-edit-resend: dictionaries')
    remoteCtx.effect(() => remoteCtx.uiConversation.events.register(replacementMessageDefinition), 'message-edit-resend: transcript')

    let surfaces = new WeakMap<object, EditResendSurface>()
    const surfaceFor = (sessionId: SessionId): EditResendSurface => {
      const session = remoteCtx.sessions.scope(sessionId)
      if (session === undefined) throw new Error(`message-edit-resend: Session "${sessionId}" has no live scope`)
      let surface = surfaces.get(session)
      if (surface === undefined) {
        surface = new EditResendSurface()
        surfaces.set(session, surface)
      }
      return surface
    }
    remoteCtx.effect(() => () => { surfaces = new WeakMap() }, 'message-edit-resend: Session surfaces')

    remoteCtx.slots.inject('conversation.chat.user-actions', () => remoteCtx.slots.register({
      name: 'conversation.chat.user-actions',
      id: 'edit-resend',
      order: 10,
      locale: NS,
      inject: (sessionId): MessageEditActionInjected => ({ surface: surfaceFor(sessionId) }),
    }, MessageEditAction))

    remoteCtx.slots.inject('conversation.input.overlay', () => remoteCtx.slots.register({
      name: 'conversation.input.overlay',
      id: 'edit-resend',
      order: 1,
      locale: NS,
      inject: (sessionId): EditComposerNoticeInjected => ({
        surface: surfaceFor(sessionId),
        loadLatestStatus: async () => {
          const result = await remoteCtx.remote.messageEditResend.latestStatus(sessionId)
          return result.ok ? result.value : undefined
        },
        readStatus: async (requestId) => {
          const result = await remoteCtx.remote.messageEditResend.status(sessionId, requestId)
          return result.ok ? result.value : undefined
        },
      }),
    }, EditComposerNotice))

    const t = remoteCtx.locale.bind(NS)
    remoteCtx.effect(() => remoteCtx.conversation.registerSubmitDispatcher('message-edit-resend', createEditResendDispatcher(
      surfaceFor,
      (sessionId, request) => remoteCtx.remote.messageEditResend.replace(sessionId, request),
      t,
    )), 'message-edit-resend: composer route')
  })
  try {
    await scope
  } catch (error) {
    await scope.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await scope.dispose()
    await disposeRemote()
  }
}

export type { EditResendRequest, EditResendResult, EditResendStatus } from '../types.ts'
