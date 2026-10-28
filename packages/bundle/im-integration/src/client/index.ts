/** Multi-platform IM Integration Client entry. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-im-integration/remote'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type { ImConnectionStatus } from '@deepseek-ai/dsh-im-integration/types'
import IM_REMOTE from '@deepseek-ai/dsh-im-integration/remote'
import { ImSettingsController } from './controller.ts'
import { ImSettingsPage } from './ImSettingsPage.tsx'
import { en, zh, type ImLocaleKey } from './locales.ts'
import { statusDiagnosticCode } from './status-diagnostic.ts'

export type { ImSettingsState, ImSettingsFace } from './controller.ts'
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
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']
/** Host Config row used to stage IM identity values. */
export const IM_CONFIG_NS = 'im'

/** Register IM configuration on its bundle detail page while Host configuration is served. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemotes = await ctx.remote.$mount(IM_REMOTE)
  const scope = ctx.inject(
    ['slots', 'locale', 'remote', 'remote.imStatus', 'remote.imSetup', 'remote.credentials', 'configForms'],
    (clientCtx) => {
      clientCtx.effect(() => clientCtx.locale.register(NS, { en, zh }), 'ui-im: dictionaries')
      const controller = new ImSettingsController(clientCtx.configForms.get(IM_CONFIG_NS), clientCtx)
      clientCtx.effect(() => () => { controller.dispose() }, 'ui-im: controller')
      const reportStatusUnavailable = (error: unknown): void => {
        controller.setStatusDiagnostic(statusDiagnosticCode(error))
        for (const platform of [
          'lark', 'dingtalk', 'wecom', 'weixin', 'qq', 'telegram', 'discord', 'whatsapp',
        ] as const) {
          controller.setConnectionStatus({ platform, state: 'unavailable' })
        }
      }
      const stream = clientCtx.remote.$stream<ImConnectionStatus>({
        name: 'im-status',
        open: signal => clientCtx.remote.imStatus.watch(signal),
        ended: () => new RemoteStreamCarrierError('IM status stream ended'),
        carrierFailed: () => {
          controller.setStatusDiagnostic('reconnecting')
          for (const platform of [
            'lark', 'dingtalk', 'wecom', 'weixin', 'qq', 'telegram', 'discord', 'whatsapp',
          ] as const) {
            controller.setConnectionStatus({ platform, state: 'unavailable' })
          }
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
      }, 'ui-im: status stream')
      clientCtx.effect(
        () => clientCtx.remote.$on('credentials/reference-updated', (ref) => { controller.refreshCredential(ref) }),
        'ui-im: credential invalidation',
      )
      clientCtx.effect(() => clientCtx.configForms.whileServed([IM_CONFIG_NS], () => clientCtx.slots.inject(
        'plugins.bundle.config',
        () => clientCtx.slots.register({
          name: 'plugins.bundle.config',
          key: '@deepseek-ai/dsh-im-integration',
          locale: NS,
          inject: () => controller.inject(),
        }, ImSettingsPage),
      )), 'ui-im: page')
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
