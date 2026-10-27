/** Supported instant messaging platforms. */
export type ImPlatform =
  | 'lark'
  | 'dingtalk'
  | 'wecom'
  | 'weixin'
  | 'qq'
  | 'telegram'
  | 'discord'
  | 'whatsapp'

/** Connection state for an IM platform without credential values. */
export interface ImConnectionStatus {
  readonly platform: ImPlatform
  readonly state: 'disabled' | 'connecting' | 'connected' | 'error'
  readonly reason?: 'missing-identity' | 'missing-credential' | 'connection-failed' | 'unauthorized'
  readonly message?: string
}

/** Non-sensitive connection state consumed by the IM Settings page. */
export interface ImIntegrationStatusValue {
  readonly platform: ImPlatform
  readonly state: 'disabled' | 'connecting' | 'connected' | 'error' | 'unavailable'
  readonly reason?: 'missing-identity' | 'missing-credential' | 'connection-failed' | 'unauthorized'
}

/** Inbound normalized message delivered by an IM channel. */
export interface InboundImMessage {
  readonly platform: ImPlatform
  readonly messageId: string
  readonly senderId: string
  readonly senderName?: string
  readonly conversationId: string
  readonly content: string
  readonly timestamp: number
}
