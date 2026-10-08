/** Opt-in SkillsMP browser directory mounted through official sidebar slots. */
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

/** Services required by the SkillsMP directory. */
export const inject = ['slots', 'locale', 'remote']

/** Mount the verified-install Remote and the sidebar directory.
 * @param ctx Browser services supplied by the dynamic Client plugin runner.
 * @returns a disposer for slots, locale, and Remote.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const scope = ctx.inject(['slots', 'locale', 'remote', 'remote.skillsMpCatalog'], (clientCtx) => {
    clientCtx.effect(() => clientCtx.locale.register(NS, { en, zh }), 'skill-catalog: dictionaries')
    const store = createSkillCatalogStore()
    const injection = () => ({ api: clientCtx.remote.skillsMpCatalog })
    clientCtx.slots.inject('plugins.item', () => clientCtx.slots.register({
      name: 'plugins.item', id: 'installed-skills', order: 50,
      label: () => clientCtx.locale.bind(NS)('managerTitle'), locale: NS, inject: injection,
    }, InstalledSkillsPage))
    clientCtx.slots.inject('sidebar.footer.action', () => clientCtx.slots.register({
      name: 'sidebar.footer.action', id: 'skill-catalog', order: 21, locale: NS, store, inject: injection,
    }, SkillCatalogAction))
    clientCtx.slots.inject('shell.overlay', () => clientCtx.slots.register({
      name: 'shell.overlay', id: 'skill-catalog', locale: NS, store, inject: injection,
    }, SkillCatalogPanel))
  })
  try { await scope }
  catch (error) { await disposeRemote(); throw error }
  return async () => { await scope.dispose(); await disposeRemote() }
}
