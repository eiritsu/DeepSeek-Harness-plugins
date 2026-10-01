/** Return a code or error class name without exposing private messages or details. */
export function statusDiagnosticCode(error: unknown): string {
  if (error === null || typeof error !== 'object') return 'TransportError'
  const value = error as { readonly isDSHRemoteError?: unknown; readonly code?: unknown; readonly name?: unknown }
  if (value.isDSHRemoteError === true && typeof value.code === 'string') {
    return /^gateway\/[a-z-]{1,48}$/u.test(value.code) ? value.code : 'RemoteError'
  }
  return typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9.]{0,63}$/u.test(value.name)
    ? value.name
    : 'TransportError'
}
