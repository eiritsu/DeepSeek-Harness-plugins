/** Optional Session-header action that copies the current Session identity. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { CopySessionIdAction } from './CopySessionIdAction.tsx'
import { en, NS, zh, type CopySessionIdKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy Session ID menu item copy. */
    'copySessionId': CopySessionIdKey
  }
}

/** Required services: Session-header utilities and the locale registry. */
export const inject = ['slots', 'locale']

/** Register the optional action in the existing Session-header utilities list. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-copy-session-id: dictionaries')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'copy-session-id',
    order: 100,
    locale: NS,
  }, CopySessionIdAction))
}
