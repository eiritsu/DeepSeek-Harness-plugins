/** Host-owned connection state stream for the Lark Settings page. */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { LarkConnectionStatus } from '../../types.ts'

export type { LarkConnectionStatus }

/** Publish the current Host connection state to mounted Client observers. */
export class LarkStatus extends TypertRemoteService {
  private current: LarkConnectionStatus = { state: 'disabled' }
  private readonly listeners = new Set<(status: LarkConnectionStatus) => void>()

  /** @param ctx - Host context that owns the Lark connection and Remote service. */
  constructor(ctx: Context) { super(ctx, 'larkStatus') }

  /** Replace the observable connection state.
   * @param status - state and optional non-sensitive diagnostic code.
   */
  publish(status: LarkConnectionStatus): void {
    if (status.state === this.current.state && status.reason === this.current.reason) return
    this.current = status
    for (const listener of this.listeners) listener(status)
  }

  /** Stream the current state and subsequent changes until the Client disconnects.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns the latest connection state whenever it changes.
   */
  @Remote({ mode: 'stream' })
  async *watch(signal: AbortSignal): AsyncIterable<LarkConnectionStatus> {
    let pending: LarkConnectionStatus | undefined = this.current
    let wake: (() => void) | undefined
    const update = (status: LarkConnectionStatus): void => { pending = status; wake?.() }
    const stop = (): void => { wake?.() }
    this.listeners.add(update)
    signal.addEventListener('abort', stop, { once: true })
    try {
      while (!signal.aborted) {
        if (pending !== undefined) {
          const current = pending
          pending = undefined
          yield current
          continue
        }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      this.listeners.delete(update)
      signal.removeEventListener('abort', stop)
    }
  }
}
