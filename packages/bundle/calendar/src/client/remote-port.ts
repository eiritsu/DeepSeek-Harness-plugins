/**
 * Typed RPC adapter: the single bridge between `ctx.remote.calendar` and the
 * controller's {@link CalendarPort}. The generated Remote wraps every reply in
 * `RemoteResult<T>`, so this module unwraps exactly one carrier layer and throws
 * on a transport failure; the inner domain result (`{ ok: true } | { ok: false,
 * code, message }`) passes through untouched. Nothing else in the GUI reaches
 * the wire, so the controller and its specs stay transport-independent.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-calendar/remote'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import type { CalendarChange } from '../types.ts'
import type { CalendarPort } from './controller.ts'

/**
 * Build the controller port from the mounted Client Remote and its carriers.
 * @param ctx - Client context whose `remote.calendar` namespace is mounted.
 * @returns the port the controller consumes, without the carrier wrapper.
 */
export function createCalendarPort(ctx: ClientContext): CalendarPort {
  const remote = ctx.remote.calendar
  return {
    snapshot: request => unwrap(remote.snapshot(request)),
    createTask: request => unwrap(remote.createTask(request)),
    updateTask: request => unwrap(remote.updateTask(request)),
    deleteTask: request => unwrap(remote.deleteTask(request)),
    addSubscription: request => unwrap(remote.addSubscription(request)),
    updateSubscription: request => unwrap(remote.updateSubscription(request)),
    deleteSubscription: request => unwrap(remote.deleteSubscription(request)),
    refreshSubscription: request => unwrap(remote.refreshSubscription(request)),
    importIcs: request => unwrap(remote.importIcs(request)),
    deleteImported: request => unwrap(remote.deleteImported(request)),
    onScheduleChanged: listener => ctx.remote.$on('schedule/changed', listener),
    watch: signal => watchCalendar(ctx, signal),
  }
}

/** Unwrap the Remote carrier result: a transport failure rejects, a domain failure passes through. */
async function unwrap<T>(pending: Promise<RemoteResult<T>>): Promise<T> {
  const result = await pending
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * Wrap the Remote watch carrier as a plain async iterable of change frames,
 * aborting the carrier when the caller's signal aborts.
 * @param ctx - Client context carrying the Remote stream service.
 * @param signal - controller-owned abort signal.
 * @returns change frames until the carrier ends or aborts.
 */
async function* watchCalendar(ctx: ClientContext, signal: AbortSignal): AsyncIterable<CalendarChange> {
  const stream = ctx.remote.$stream<CalendarChange>({
    name: 'calendar',
    open: inner => ctx.remote.calendar.watch(inner),
    ended: () => new RemoteStreamCarrierError('Calendar stream ended'),
    carrierFailed: () => { reportCarrierFailure() },
  })
  const abort = (): void => { void stream.dispose() }
  signal.addEventListener('abort', abort)
  try {
    for await (const frame of stream) {
      frame.accept()
      yield frame.value
    }
  } finally {
    signal.removeEventListener('abort', abort)
    void stream.dispose()
  }
}

/** A transport carrier failure ends this stream; the next change or reload refetches the snapshot. */
function reportCarrierFailure(): void {
  // No local state to mutate: the snapshot is the single source of truth and
  // the forwarded `schedule/changed` subscription remains the fallback trigger.
}
