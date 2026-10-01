/** Host entry for the optional Session message edit-and-resend bundle. */

import type { Context } from '@deepseek-ai/cordis'
import { MessageEditResendService } from './service.ts'

/** Required Host services: live Agents and Session projections. */
export const inject = ['agents', 'sessionProjections']

/** Register the durable Session policy and Remote service.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(MessageEditResendService)
}

export { MessageEditResendService }
export { messageEditResendProjectionDefinition } from './projection.ts'
export type { EditEligibility, EditResendRequest, EditResendResult, EditResendStatus } from './types.ts'

/** Loader namespace: this bundle's Host entry name, injections, and apply. */
const plugin = { name: '@deepseek-ai/dsh-session-message-edit-resend', inject, apply }

export default plugin
