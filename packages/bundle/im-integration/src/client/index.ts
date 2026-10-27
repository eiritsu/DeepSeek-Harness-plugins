/** Multi-platform IM Integration Client entry. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ImSettingsPage } from './ImSettingsPage.tsx'
import { en, zh, type ImLocaleKey } from './locales.ts'

export type { ImLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** IM Settings copy. */
    'settings.im': ImLocaleKey
  }
}

/** Dictionary namespace owned by this page. */
export const NS = 'settings.im'
/** Browser services used by the page. */
export const inject = ['slots', 'locale', 'configForms']
/** Host Config row used to stage IM identity values. */
export const IM_CONFIG_NS = 'im'

/** Register IM configuration on its bundle detail page while Host configuration is served. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const scope = ctx.inject(['slots', 'locale', 'configForms'], (clientCtx) => {
    clientCtx.effect(() => clientCtx.locale.register(NS, { en, zh }), 'ui-im: dictionaries')
    clientCtx.effect(
      () => clientCtx.configForms.whileServed([IM_CONFIG_NS], () => clientCtx.slots.inject(
        'plugins.bundle.config',
        () => clientCtx.slots.register({
          name: 'plugins.bundle.config',
          key: '@deepseek-ai/dsh-im-integration',
          locale: NS,
        }, ImSettingsPage),
      )),
      'ui-im: page',
    )
  })

  await scope
  return async () => {
    await scope.dispose()
  }
}
