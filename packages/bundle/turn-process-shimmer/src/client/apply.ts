/** Mount the turn-process-shimmer plugin into the client slot registry. */
import type { Context } from '@deepseek-ai/cordis'
import { registerTurnProcessShimmer } from './register.ts'

/**
 * Client-side plugin entry point.
 * Registers the shimmer replacement for the official turn-process keyed renderer.
 * @param ctx - Client root context.
 * @returns nothing.
 */
export function apply(ctx: Context): void {
  registerTurnProcessShimmer(ctx)
}

/** Declared services this plugin reads through the inject face. */
export const inject = ['slots']
