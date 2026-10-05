/**
 * Calendar Client entry. Mounts the generated Remote namespace, then registers
 * the dictionaries and the sidebar, centre-panel, and Plugins-detail surfaces.
 *
 * `remote.calendar` is deliberately absent from the outer `inject`: the service
 * does not exist until `$mount` runs, so depending on it at the outer level
 * would deadlock the plugin on itself. The inner `ctx.inject` names it after the
 * mount, the way the community catalogs mount their own namespaces.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-calendar/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import CALENDAR_REMOTE from '@deepseek-ai/dsh-calendar/remote'
import { browserTimeZone, sessionDirectory } from './calendar-model.ts'
import { CalendarController } from './controller.ts'
import { registerCalendarSurfaces } from './register.ts'
import { createCalendarPort } from './remote-port.ts'

/** Browser services present before the Remote namespace is mounted. */
export const inject = ['slots', 'locale', 'remote']

/**
 * Mount the Calendar Remote and register this bundle's surfaces.
 * @param ctx - Browser plugin context supplied by the dynamic Client runner.
 * @returns a disposer for every registration and the mounted Remote.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(CALENDAR_REMOTE)
  const scope = ctx.inject(
    ['slots', 'locale', 'remote', 'remote.calendar', 'configForms', 'sessions', 'workspaces', 'uiWorkspace'],
    (clientCtx) => {
      const controller = new CalendarController(createCalendarPort(clientCtx), {
        timeZone: browserTimeZone(),
        onOpenSession: (sessionId) => { clientCtx.uiWorkspace.openSession(sessionId as SessionId) },
      })
      clientCtx.effect(() => () => { controller.dispose() }, 'calendar: controller')
      clientCtx.effect(() => {
        const applyDirectory = (): void => {
          const sessions = clientCtx.sessions.list.getSnapshot()
          const archived = new Set<string>(clientCtx.workspaces.list.getSnapshot().archivedSessionIds)
          const directory = sessionDirectory(Object.values(sessions.byId), archived)
          controller.setSessionDirectory(directory.labels, directory.allowed)
        }
        applyDirectory()
        const stops = [
          clientCtx.sessions.list.subscribe(applyDirectory),
          clientCtx.workspaces.list.subscribe(applyDirectory),
        ]
        return () => { for (const stop of stops) stop() }
      }, 'calendar: session directory')
      controller.start()
      registerCalendarSurfaces(clientCtx, controller.inject())
    },
  )
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
