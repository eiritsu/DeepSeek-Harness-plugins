/** Settings tab for explicitly adding optional features to an existing Desktop profile. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-plugin-manager/remote'
import type {} from '@deepseek-ai/dsh-desktop-profile-migration-bundle/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import TYPERT_REMOTE from '@deepseek-ai/dsh-desktop-profile-migration-bundle/remote'
import { MigrationPanel, type MigrationPanelFace } from './MigrationPanel.tsx'
import { en, zh, type DesktopMigrationLocaleKey } from './locales.ts'

export type { DesktopMigrationLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Localized labels for the profile migration tab. */
    'settings.desktopMigration': DesktopMigrationLocaleKey
  }
}

/** Locale namespace owned by this Settings page. */
export const NS = 'settings.desktopMigration'
/** Runtime services used by the migration Settings page. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager']

/** Mount the Host migration Remote and register the official Plugins Settings tab.
 * @param ctx - Client context scoped to the selected plugin package.
 * @returns Disposer for the Remote contribution and its Settings registration.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'desktop-profile-migration: dictionaries')
  const t = ctx.locale.bind(NS)
  const injected = (): MigrationPanelFace => ({
    migration: {
      read: async () => unwrap(await ctx.remote.desktopProfileMigration.read()),
      complete: async (expected, chosen) => unwrap(await ctx.remote.desktopProfileMigration.complete(expected, chosen)),
    },
    bundles: ctx.remote.pluginManager,
  })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: 'desktop-migration', order: 20, label: () => t('tab'), locale: NS, inject: injected,
  }, MigrationPanel))
  return async () => { await disposeRemote() }
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
