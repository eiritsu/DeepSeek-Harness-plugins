/** Community catalog overlay mounted in the official Web shell. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-community-plugin-catalog/remote'
import TYPERT_REMOTE from '@deepseek-ai/dsh-community-plugin-catalog/remote'
import { PluginCatalogAction } from './PluginCatalogAction.tsx'
import { PluginCatalogAddAction } from './PluginCatalogAddAction.tsx'
import { PluginCatalogPanel, type PluginCatalogPanelInjected } from './PluginCatalogPanel.tsx'
import type { PluginManagerClientFace } from './CatalogInstallDialog.tsx'
import { createPluginCatalogStore } from './store.ts'
import { en, NS, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { pluginCatalog: keyof typeof zh }
}

/** Services required by the catalog overlay. */
export const inject = ['slots', 'locale', 'remote']

/** Mount the catalog Remote and register its sidebar action and overlay.
 * @param ctx Browser services supplied by the dynamic Client plugin runner.
 * @returns Disposer for the overlay, dictionary, and mounted Remote.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const scope = ctx.inject(['slots', 'locale', 'remote', 'remote.pluginCatalog'], (clientCtx) => {
    clientCtx.effect(() => clientCtx.locale.register(NS, { en, zh }), 'community-plugin-catalog: dictionaries')
    const store = createPluginCatalogStore()
    const bus = clientCtx.remote as { $on?(event: string, cb: unknown): () => void }
    const injection = (): PluginCatalogPanelInjected => ({
      api: clientCtx.remote.pluginCatalog,
      pluginManager: clientCtx.get('remote.pluginManager') as PluginManagerClientFace | undefined,
      onInstallLog: (listener: (chunk: { requestId?: string; data: string; stream?: string }) => void) => (
        bus.$on?.('plugin-manager/install-log', listener) ?? (() => {})
      ),
      onInstallState: (
        listener: (state: { requestId?: string; phase: string; attempt?: { registry: string; index: number; total: number } }) => void,
      ) => bus.$on?.('plugin-manager/install-state', listener) ?? (() => {}),
      onChanged: (listener: () => void) => bus.$on?.('plugin-manager/changed', listener) ?? (() => {}),
      openInstall: (spec: string, options?: { autoRun?: boolean }) => {
        type NavFace = { openInstall?: (s: string, opt?: { autoRun?: boolean }) => void }
        const nav = clientCtx.get('pluginNavigation') as NavFace | undefined
        if (typeof nav?.openInstall === 'function') {
          if (options !== undefined) {
            nav.openInstall(spec, options)
          } else {
            nav.openInstall(spec)
          }
        }
      },
      language: () => clientCtx.locale.getSnapshot().active === 'zh' ? 'zh' : 'en',
    })
    clientCtx.slots.inject('sidebar.footer.action', () => clientCtx.slots.register({
      name: 'sidebar.footer.action', id: 'plugin-catalog', order: 20, locale: NS, store,
    }, PluginCatalogAction))
    // Backward compatibility for <= 0.2.2-alpha.2 hosts that expose `plugins.add.actions`.
    clientCtx.slots.inject('plugins.add.actions' as never, () => clientCtx.slots.register({
      name: 'plugins.add.actions', id: 'community-plugin-catalog', order: 10, locale: NS, store,
    } as never, PluginCatalogAddAction))
    clientCtx.slots.inject('shell.overlay', () => clientCtx.slots.register({
      name: 'shell.overlay', id: 'plugin-catalog', locale: NS, store, inject: injection,
    }, PluginCatalogPanel))
  })
  try {
    await scope
  } catch (error) {
    await disposeRemote()
    throw error
  }
  return async () => {
    await scope.dispose()
    await disposeRemote()
  }
}
