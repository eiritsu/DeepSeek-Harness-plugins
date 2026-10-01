/** Browser registration for Session archive transfers. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { SessionArchivePage } from './SessionArchivePage.tsx'
import { en, zh, type SessionArchiveLocaleKey } from './locales.ts'

export type { SessionArchiveLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session archive Settings copy. */
    'settings.sessionArchive': SessionArchiveLocaleKey
  }
}

const NS = 'settings.sessionArchive'
export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.directoryPicker']

/** Register the localized Session archive bundle detail page.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'session-archive: dictionaries')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: '@deepseek-ai/dsh-session-archive',
    locale: NS,
    inject: () => ({
      refreshSessions: () => ctx.sessions.refresh(),
      directoryPicker: ctx.remote.directoryPicker,
    }),
  }, SessionArchivePage))
}
