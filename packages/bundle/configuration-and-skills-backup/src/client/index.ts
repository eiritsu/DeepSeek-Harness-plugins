/** Register localized configuration and skills backup controls. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ConfigurationSkillsBackupPage } from './page.tsx'
import { en, zh, type ConfigurationSkillsBackupLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Configuration and skills backup copy. */
    'settings.configurationSkillsBackup': ConfigurationSkillsBackupLocaleKey
  }
}

const NS = 'settings.configurationSkillsBackup'
export const inject = ['slots', 'locale']

/** Register backup controls on the bundle detail page. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'configuration-skills-backup: dictionaries')
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: '@deepseek-ai/dsh-configuration-and-skills-backup',
    locale: NS,
  }, ConfigurationSkillsBackupPage))
}
