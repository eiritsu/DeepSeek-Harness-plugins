import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ToolsConnectionsCard } from './page.tsx'
import { ToolsConnectionsController, type Settings } from './controller.ts'
import { en, zh, type LocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Tools and connections settings copy. */
    'settings.toolsConnections': LocaleKey
  }
}

/** Locale namespace owned by this page. */
export const NS = 'settings.toolsConnections'
/** Services used by the settings card. */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

/** Register this bundle's settings in its own Plugins detail page while the Host serves its config. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'tools-connections: dictionaries')
  const card = new ToolsConnectionsController(ctx.configForms.get<Settings>('tools-connections'), ctx)
  ctx.effect(() => () =>{  card.dispose() }, 'tools-connections: form subscription')
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) =>{  card.refreshCredential(ref) }),
    'tools-connections: credential invalidations',
  )
  ctx.effect(() => ctx.configForms.whileServed(['tools-connections'], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: '@deepseek-ai/dsh-tools-connections', locale: NS, inject: () => card.inject(),
  }, ToolsConnectionsCard))), 'tools-connections: settings page')
}
