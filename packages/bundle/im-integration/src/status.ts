/** Host-owned connection state for IM integration platforms. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { ImConnectionStatus, ImPlatform } from './types.ts'

export type { ImConnectionStatus }

/**
 * Publish the current Host connection state across platforms.
 * Local observers only until a Client Remote surface is wired with Typert artifacts.
 */
export class ImStatusService extends Service {
  private readonly platformStatuses = new Map<ImPlatform, ImConnectionStatus>()
  private readonly listeners = new Set<(status: ImConnectionStatus) => void>()

  /** @param ctx - Host context that owns the IM connection status. */
  constructor(ctx: Context) {
    super(ctx, 'imStatus')
  }

  /** Replace the observable connection state for a platform.
   * @param status - state and optional non-sensitive diagnostic code.
   */
  publish(status: ImConnectionStatus): void {
    const existing = this.platformStatuses.get(status.platform)
    if (existing?.state === status.state && existing.reason === status.reason) return
    this.platformStatuses.set(status.platform, status)
    for (const listener of this.listeners) listener(status)
  }

  /** Stream the current state and subsequent changes until aborted.
   * @param signal - cancellation owned by the caller.
   * @returns the latest connection state whenever it changes.
   */
  async *watch(signal: AbortSignal): AsyncIterable<ImConnectionStatus> {
    const queue: ImConnectionStatus[] = []
    let wake: (() => void) | undefined

    for (const status of this.platformStatuses.values()) {
      queue.push(status)
    }

    const update = (status: ImConnectionStatus): void => {
      queue.push(status)
      wake?.()
    }
    const stop = (): void => { wake?.() }
    this.listeners.add(update)
    signal.addEventListener('abort', stop, { once: true })
    try {
      while (!signal.aborted) {
        if (queue.length > 0) {
          const next = queue.shift()
          if (next !== undefined) {
            yield next
            continue
          }
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
