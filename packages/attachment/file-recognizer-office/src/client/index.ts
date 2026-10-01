/** The Plugins settings page for file-recognizer-office. */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { OfficeRecognitionCardController } from './controller.ts'
import { OfficeRecognitionCard } from './OfficeRecognitionCard.tsx'
import { en, zh, type OfficeRecognitionLocaleKey } from './locales.ts'
import { acceptsOfficeNativeUpload } from '../supported-file-types.ts'
import type { OfficeRecognitionSettings } from './controller.ts'

export type { OfficeRecognitionCardFace, OfficeRecognitionCardState } from './controller.ts'
export type { OfficeRecognitionLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Office recognition settings copy. */
    'settings.fileRecognition': OfficeRecognitionLocaleKey
  }
}

/** Dictionary namespace owned by this page. */
export const NS = 'settings.fileRecognition'
/** Browser services used by the page. */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms', 'nativeFileUploadPolicies']

/** Register the Office recognition page while the Host serves its configuration. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'file-recognizer-office: dictionaries')
  const form = ctx.configForms.get<OfficeRecognitionSettings>(OFFICE_RECOGNITION_NS)
  const controller = new OfficeRecognitionCardController(form, ctx)
  ctx.effect(() => () => { controller.dispose() }, 'file-recognizer-office: controller')
  ctx.effect(() => ctx.nativeFileUploadPolicies.register('file-recognizer-office', (file) => {
    return acceptsOfficeNativeUpload(file.name, form.getSnapshot().value)
  }), 'file-recognizer-office: composer file intake')
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => { controller.refreshCredential(ref) }),
    'file-recognizer-office: credential invalidation')
  ctx.effect(() => ctx.configForms.whileServed([OFFICE_RECOGNITION_NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: '@deepseek-ai/dsh-file-recognizer-office', locale: NS,
    inject: () => controller.inject(),
  }, OfficeRecognitionCard))), 'file-recognizer-office: page')
}

/** Host plugin row id owning the persisted recognition configuration. */
export const OFFICE_RECOGNITION_NS = 'file-recognizer-office'
