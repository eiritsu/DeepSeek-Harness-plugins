/** Sanitize Client transport failures for the IM Settings Advanced diagnostic. */

import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { isRemoteFailure } from '@deepseek-ai/dsh-api-gateway/client'

/** Map a status-stream failure to a short, non-sensitive diagnostic code.
 * @param error - the rejection from the status stream consumer.
 * @returns a gateway code, error name, or reconnect marker without the original message.
 */
export function statusDiagnosticCode(error: unknown): string {
  if (error instanceof RemoteStreamCarrierError) return 'reconnecting'
  if (isRemoteFailure(error)) return error.code
  if (error instanceof Error && error.name.length > 0) return error.name
  return 'unavailable'
}
