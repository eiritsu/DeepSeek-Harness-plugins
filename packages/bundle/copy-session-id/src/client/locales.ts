/** `copySessionId` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source. */
export const zh = {
  'action.copy': '复制 Session ID',
  'action.copied': 'Session ID 已复制',
  'action.copyFailed': '复制 Session ID 失败',
  'action.copying': '正在复制 Session ID…',
} as const

/** English dictionary, aligned with the Chinese key set. */
export const en = {
  'action.copy': 'Copy Session ID',
  'action.copied': 'Session ID copied',
  'action.copyFailed': 'Could not copy Session ID',
  'action.copying': 'Copying Session ID…',
} satisfies Record<keyof typeof zh, string>

/** Namespace consumed by the registered menu item. */
export const NS = 'copySessionId'

/** Typed dictionary keys. */
export type CopySessionIdKey = keyof typeof zh
