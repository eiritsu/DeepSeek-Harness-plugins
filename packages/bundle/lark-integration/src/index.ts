/** Host entry for the opt-in Lark integration bundle. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import { apply as applyLark, Config, inject as larkInject, name } from './host/lark/plugin.ts'
import { applyLarkCli } from './lark-cli.ts'
import { LarkIntegrationSetup } from './status.ts'

export { Config, name }

/** Services used by private-chat ingress and the optional CLI tool. */
export const inject = [...larkInject, 'configEditor', 'subprocess', 'tools']

/** Mount private-chat ingress and an opt-in, approval-gated official CLI tool.
 * The package's `./typert` artifact is generated into `lib/` by the host
 * bundle, and `dsh-typert-loader` registers it for this Loader entry; importing
 * it here would read an artifact this face has not produced yet.
 */
export function apply(ctx: Context, config: Config): void {
  applyLark(ctx, config)
  new LarkIntegrationSetup(ctx, config)
  applyLarkCli(ctx, config)
}
