/** Register the shimmer turn-process renderer into the official keyed slot. */
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TurnProcessShimmerView } from './TurnProcessShimmerView.tsx'

const SLOT_NAME = 'conversation.chat.node'
const SLOT_KEY = 'turn-process'

/** Props for the turn-process-shimmer keyed renderer. */
export type TurnProcessShimmerNodeProps =
  PropsRuntime<typeof SLOT_NAME, typeof SLOT_KEY> & PropsLocale<'chat'>

/**
 * Register the shimmer replacement for the official turn-process keyed renderer.
 * @param ctx - owning client root context.
 * @returns nothing.
 */
export function registerTurnProcessShimmer(ctx: Context): void {
  ctx.slots.inject(SLOT_NAME, () => ctx.slots.register({
    name: SLOT_NAME,
    key: SLOT_KEY,
    priority: -1,
    locale: 'chat',
  }, TurnProcessShimmerView))
}
