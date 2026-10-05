/**
 * Slot and dictionary registration for the Calendar GUI. Kept separate from the
 * Remote mount in `index.ts` so a spec can drive the registrations against a
 * stub face without loading the generated Remote artifact.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import {
  CALENDAR_CONFIG_LOCALE_NAMESPACE, CALENDAR_CONFIG_NAMESPACE, CALENDAR_LOCALE_NAMESPACE,
  CALENDAR_PACKAGE_NAME, CALENDAR_PANEL_ID, CALENDAR_PANEL_ORDER,
} from '../client-api.ts'
import { CalendarConfigPage } from './CalendarConfigPage.tsx'
import { CalendarPage } from './CalendarPage.tsx'
import { CalendarPanelIcon } from './CalendarPanelIcon.tsx'
import type { CalendarFace } from './controller.ts'
import { configEn, configZh, en, zh } from './locales.ts'

/**
 * Register this bundle's dictionaries, centre panel, sidebar entry, and Plugins
 * detail page. Every contribution is a `ctx.effect` or a `ctx.slots.inject`, so
 * disposing the owning fiber removes all of them.
 * @param ctx - Client context carrying `slots`, `locale`, and `configForms`.
 * @param face - the controller face both pages render from.
 */
export function registerCalendarSurfaces(ctx: ClientContext, face: CalendarFace): void {
  ctx.effect(() => ctx.locale.register(CALENDAR_LOCALE_NAMESPACE, { en, zh }), 'calendar: dictionaries')
  ctx.effect(() => ctx.locale.register(CALENDAR_CONFIG_LOCALE_NAMESPACE, { en: configEn, zh: configZh }), 'calendar: config dictionaries')
  const t = ctx.locale.bind(CALENDAR_LOCALE_NAMESPACE)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: CALENDAR_PANEL_ID as MainPanelId,
    locale: CALENDAR_LOCALE_NAMESPACE,
    inject: () => face,
  }, CalendarPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: CALENDAR_PANEL_ID,
    order: CALENDAR_PANEL_ORDER,
    locale: CALENDAR_LOCALE_NAMESPACE,
    label: () => t('panel'),
    inject: () => face,
  }, CalendarPanelIcon))
  ctx.effect(
    () => ctx.configForms.whileServed([CALENDAR_CONFIG_NAMESPACE], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
      name: 'plugins.bundle.config',
      key: CALENDAR_PACKAGE_NAME,
      locale: CALENDAR_CONFIG_LOCALE_NAMESPACE,
      inject: () => face,
    }, CalendarConfigPage))),
    'calendar: settings page',
  )
}
