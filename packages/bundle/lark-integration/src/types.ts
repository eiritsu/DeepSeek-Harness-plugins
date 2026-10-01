/** Connection state without credential values or provider response bodies. */
export interface LarkConnectionStatus {
  readonly state: 'disabled' | 'connecting' | 'connected' | 'error'
  readonly reason?: 'missing-identity' | 'missing-credential' | 'connection-failed'
}

/** Non-sensitive connection state consumed by the Lark Settings page. */
export interface LarkIntegrationStatusValue {
  readonly state: 'disabled' | 'connecting' | 'connected' | 'error' | 'unavailable'
  readonly reason?: 'missing-identity' | 'missing-credential' | 'connection-failed'
}

/** Safe result from a setup action; secret values never cross the Remote. */
export type LarkSetupResult<T extends object = Record<never, never>> =
  | { readonly ok: true } & T
  | { readonly ok: false; readonly code: 'cancelled' | 'expired' | 'not-configured' | 'not-ready' | 'operation-failed' | 'unsupported-url' }

/** Public portion of an official browser device-authorization request. */
export interface LarkAuthorizationRequest {
  readonly verificationUrl: string
}

/** Application identity returned after official managed registration. */
export interface LarkRegisteredApplication {
  readonly appId: string
  readonly brand: 'feishu' | 'lark'
}
