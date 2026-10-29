/** Which IM channels currently contribute an official CLI tool. */

import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.ts'
import type { ImCliChannel } from '../cli-paths.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isLoader(value: unknown): value is { entries: () => Iterable<unknown> } {
  return isRecord(value) && typeof value.entries === 'function'
}

function entryName(entry: Record<string, unknown>): string {
  const options = entry.options
  if (!isRecord(options)) return ''
  const name = options.name
  return typeof name === 'string' ? name : ''
}

/**
 * Whether an enabled loader entry is `@deepseek-ai/dsh-lark-integration`.
 * A disabled entry does not count. A missing loader does not count.
 * @param ctx - host context.
 * @returns `true` when that plugin is loaded.
 */
export function larkPluginLoaded(ctx: Context): boolean {
  const loader = ctx.get('loader', false)
  if (!isLoader(loader)) return false
  for (const entry of loader.entries()) {
    if (!isRecord(entry) || entry.disabled === true) continue
    const name = entryName(entry)
    if (name.includes('lark-integration')) return true
  }
  return false
}

/**
 * Whether `lark_cli` should be registered.
 * Requires the global switch, the Lark switch, and an application id.
 * It stays off when dsh-lark-integration is loaded, so the tool name is not registered twice.
 * @param config - live IM configuration.
 * @param larkLoaded - result of {@link larkPluginLoaded}.
 * @returns `true` when this plugin should register `lark_cli`.
 */
export function larkCliActive(config: Config, larkLoaded: boolean): boolean {
  return config.cliEnabled.get()
    && config.larkCliEnabled.get()
    && config.larkAppId.get().trim() !== ''
    && !larkLoaded
}

/**
 * Whether `wecom_cli` should be registered.
 * @param config - live IM configuration.
 * @returns `true` when the global switch and the WeCom switch are on.
 */
export function wecomCliActive(config: Config): boolean {
  return config.cliEnabled.get() && config.wecomCliEnabled.get()
}

/**
 * Whether `dingtalk_cli` should be registered.
 * A missing client secret does not unregister the tool; the call reports it.
 * @param config - live IM configuration.
 * @returns `true` when the switches are on and a client id is set.
 */
export function dingtalkCliActive(config: Config): boolean {
  return config.cliEnabled.get()
    && config.dingtalkCliEnabled.get()
    && config.dingtalkClientId.get().trim() !== ''
}

/**
 * Channels whose tools should be registered, in a stable order.
 * @param config - live IM configuration.
 * @param larkLoaded - result of {@link larkPluginLoaded}.
 * @returns the active channel ids.
 */
export function activeCliChannels(config: Config, larkLoaded: boolean): ImCliChannel[] {
  const channels: ImCliChannel[] = []
  if (larkCliActive(config, larkLoaded)) channels.push('lark')
  if (wecomCliActive(config)) channels.push('wecom')
  if (dingtalkCliActive(config)) channels.push('dingtalk')
  return channels
}

/**
 * Tool name for one channel.
 * @param channel - CLI channel.
 * @returns the model-facing tool name.
 */
export function cliToolName(channel: ImCliChannel): string {
  if (channel === 'lark') return 'lark_cli'
  if (channel === 'wecom') return 'wecom_cli'
  return 'dingtalk_cli'
}
