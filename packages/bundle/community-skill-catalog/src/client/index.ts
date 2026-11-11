/** Opt-in dual-source skill catalog mounted through official sidebar, overlay, and Plugins slots. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-community-skill-catalog/remote'
import TYPERT_REMOTE from '@deepseek-ai/dsh-community-skill-catalog/remote'
import { SkillCatalogAction } from './SkillCatalogAction.tsx'
import { SkillCatalogPanel } from './SkillCatalogPanel.tsx'
import { InstalledSkillsPage } from './InstalledSkillsPage.tsx'
import { createSkillCatalogStore } from './store.ts'
import { en, NS, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { skillCatalog: keyof typeof zh }
}

/** Services required by the community skill catalog. */
export const inject = ['slots', 'locale', 'remote']

/** Mount the skill catalog Remote, Plugins skills manager, and sidebar directory.
 * @param ctx Browser services supplied by the dynamic Client plugin runner.
 * @returns Disposer for slots, locale dictionaries, and mounted Remote.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const scope = ctx.inject(['slots', 'locale', 'remote', 'remote.skillCatalog'], (clientCtx) => {
    clientCtx.effect(() => clientCtx.locale.register(NS, { en, zh }), 'skill-catalog: dictionaries')
    const store = createSkillCatalogStore()
    const injection = () => ({ api: clientCtx.remote.skillCatalog })
    clientCtx.slots.inject('plugins.item', () => clientCtx.slots.register({
      name: 'plugins.item', id: 'installed-skills', order: 50,
      label: () => clientCtx.locale.bind(NS)('managerTitle'), locale: NS, store, inject: injection,
    }, InstalledSkillsPage))
    clientCtx.slots.inject('sidebar.footer.action', () => clientCtx.slots.register({
      name: 'sidebar.footer.action', id: 'skill-catalog', order: 21, locale: NS, store,
    }, SkillCatalogAction))
    clientCtx.slots.inject('shell.overlay', () => clientCtx.slots.register({
      name: 'shell.overlay', id: 'skill-catalog', locale: NS, store, inject: injection,
    }, SkillCatalogPanel))
  })
  try { await scope }
  catch (error) { await disposeRemote(); throw error }
  return async () => { await scope.dispose(); await disposeRemote() }
}
