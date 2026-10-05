/** Host entry for the optional calendar bundle. */

import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-schedule'
import { CalendarService } from './service.ts'
import { Config } from './config.ts'

export { Config, CalendarService }
export type * from './types.ts'
export {
  CALENDAR_CONFIG_LOCALE_NAMESPACE,
  CALENDAR_CONFIG_NAMESPACE,
  CALENDAR_LOCALE_NAMESPACE,
  CALENDAR_PACKAGE_NAME,
  CALENDAR_PANEL_ID,
  CALENDAR_PANEL_ORDER,
  CALENDAR_REMOTE_NAMESPACE,
  checkSubscriptionUrl,
  isAcceptedRange,
} from './client-api.ts'
export type {
  CalendarEntryMessageKey,
  CalendarFailureMessageKey,
  CalendarImportMessageKey,
  CalendarSubscriptionUrlCheck,
  CalendarTaskMessageKey,
} from './client-api.ts'

/**
 * Loader namespace: the calendar store and its Remote service.
 *
 * `schedule` is deliberately absent from the service's injections: it is an
 * optional official bundle, and a declared injection would leave this plugin
 * waiting without a message when a profile omits it. The service reads it with
 * `ctx.get('schedule')` instead, so the page still mounts and its task methods
 * report `service-unavailable`.
 */
export default CalendarService
