/** Lark application and private-chat identity settings. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-lark-integration/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type { LarkConnectionStatus } from '@deepseek-ai/dsh-lark-integration/types'
import LARK_REMOTE from '@deepseek-ai/dsh-lark-integration/remote'
import { LarkSettingsController } from './controller.ts'
import { LarkSettingsPage } from './LarkSettingsPage.tsx'
import { en, zh, type LarkLocaleKey } from './locales.ts'
import { statusDiagnosticCode } from './status-diagnostic.ts'

export type { LarkSettingsState, LarkSettingsFace } from './controller.ts'
export type { LarkLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Lark Settings copy. */
    'settings.lark': LarkLocaleKey
  }
}

/** Dictionary namespace owned by this page. */
export const NS = 'settings.lark'
/** Browser services used by the page. */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']
/** Host Config row used to stage Lark identity values. */
export const LARK_CONFIG_NS = 'lark'

/** Register Lark configuration on its bundle detail page while Host configuration is served. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemotes = await ctx.remote.$mount(LARK_REMOTE)
  const scope = ctx.inject(
    ['slots', 'locale', 'remote', 'remote.larkStatus', 'remote.larkSetup', 'remote.credentials', 'configForms'],
    (clientCtx) => {
      clientCtx.effect(() => clientCtx.locale.register(NS, { en, zh }), 'ui-lark: dictionaries')
      const controller = new LarkSettingsController(clientCtx.configForms.get(LARK_CONFIG_NS), clientCtx)
      clientCtx.effect(() => () => { controller.dispose() }, 'ui-lark: controller')
      const reportStatusUnavailable = (error: unknown): void => {
        controller.setStatusDiagnostic(statusDiagnosticCode(error))
        controller.setConnectionStatus({ state: 'unavailable' })
      }
      const stream = clientCtx.remote.$stream<LarkConnectionStatus>({
        name: 'lark-status', open: signal => clientCtx.remote.larkStatus.watch(signal),
        ended: () => new RemoteStreamCarrierError('Lark status stream ended'),
        carrierFailed: () => {
          controller.setStatusDiagnostic('reconnecting')
          controller.setConnectionStatus({ state: 'unavailable' })
        },
      })
      let disposed = false
      void (async () => {
        for await (const frame of stream) {
          controller.setStatusDiagnostic(undefined)
          controller.setConnectionStatus(frame.value)
          frame.accept()
        }
      })().catch((error: unknown) => {
        if (!disposed) reportStatusUnavailable(error)
      })
      clientCtx.effect(() => () => {
        disposed = true
        void stream.dispose()
      }, 'ui-lark: status stream')
      clientCtx.effect(() => clientCtx.remote.$on('credentials/reference-updated', (ref) => { controller.refreshCredential(ref) }),
        'ui-lark: credential invalidation')
      clientCtx.effect(() => clientCtx.configForms.whileServed([LARK_CONFIG_NS], () => clientCtx.slots.inject('plugins.bundle.config', () => clientCtx.slots.register({
        name: 'plugins.bundle.config', key: '@deepseek-ai/dsh-lark-integration', locale: NS,
        inject: () => controller.inject(),
      }, LarkSettingsPage))), 'ui-lark: page')
    },
  )
  try { await scope }
  catch (error) {
    await disposeRemotes()
    throw error
  }
  return async () => {
    await scope.dispose()
    await disposeRemotes()
  }
}
