/** Paths for the IM plugin's pinned CLI runners and per-channel config directories. */

import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Channel whose official CLI this plugin can install. */
export type ImCliChannel = 'lark' | 'wecom' | 'dingtalk'

/**
 * Directory of the download scripts shipped inside the package.
 * Resolved from this module so the same relative URL is correct for `src/` and for the bundled `lib/index.js`.
 * @returns the `scripts/vendor` directory URL.
 */
export function vendorRoot(): URL {
  return new URL('../scripts/vendor/', import.meta.url)
}

/**
 * Node runner that execs the verified binary named by `DSH_IM_CLI_BIN`.
 * @param channel - CLI channel.
 * @returns absolute path of that channel's `run.cjs`.
 */
export function channelRunner(channel: ImCliChannel): string {
  return fileURLToPath(new URL(`${channel}/run.cjs`, vendorRoot()))
}

/**
 * Shipped pin file (versions, URLs, hashes).
 * @returns absolute path of `manifest.json`.
 */
export function manifestPath(): string {
  return fileURLToPath(new URL('manifest.json', vendorRoot()))
}

/**
 * Configuration directory for one official CLI.
 * Lark stays at `~/.dsh/lark-cli` so an existing authorization record remains readable.
 * WeCom and DingTalk use `~/.dsh/im/cli-config/<channel>`.
 * @param channel - CLI channel.
 * @returns absolute configuration directory.
 */
export function channelConfigDir(channel: ImCliChannel): string {
  const home = resolveDshHome()
  if (channel === 'lark') return join(home, 'lark-cli')
  return join(home, 'im', 'cli-config', channel)
}

/**
 * Root that holds verified CLI binaries, `~/.dsh/im/cli-bin`.
 * @returns absolute binary cache root.
 */
export function cliBinRoot(): string {
  return join(resolveDshHome(), 'im', 'cli-bin')
}
