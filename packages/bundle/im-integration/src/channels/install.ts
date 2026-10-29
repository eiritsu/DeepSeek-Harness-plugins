/** Install pinned IM CLI binaries through the shipped verifier. */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { cliBinRoot, manifestPath, vendorRoot, type ImCliChannel } from '../cli-paths.ts'

const require = createRequire(import.meta.url)

/** Options forwarded to the shipped installer. */
export interface EnsureChannelBinaryOptions {
  /** Override the binary cache root. */
  binRoot?: string
  /** Override the shipped manifest path. */
  manifestPath?: string
  /** Node or release platform name (`linux`, `darwin`, `win32`, `windows`). */
  platform?: string
  /** Node or release arch name (`x64`, `amd64`, `arm64`, `riscv64`). */
  arch?: string
  /** Replacement for global `fetch`, used for archive bytes and the Gitee release lookup. */
  fetch?: typeof fetch
  /** Replacement that returns the archive bytes for one URL. */
  download?: (url: string) => Promise<Buffer>
  /** Replacement for `tar` extraction. */
  extract?: (archive: string, dest: string) => Promise<void>
  /** How long a live install lock may be waited on, in milliseconds. */
  lockWaitMs?: number
  /** Delay between lock polls, in milliseconds. */
  lockPollMs?: number
  /** Replacement for the lock poll delay. */
  sleep?: (ms: number) => Promise<void>
}

interface InstallerModule {
  ensureChannelBinary(channel: string, options: EnsureChannelBinaryOptions & { binRoot: string; manifestPath: string }): Promise<string>
}

const installer = require(fileURLToPath(new URL('install.cjs', vendorRoot()))) as InstallerModule

/**
 * Return the verified binary for one channel, downloading it on first use.
 * @param channel - CLI channel.
 * @param options - test hooks and platform overrides. The cache root defaults to `~/.dsh/im/cli-bin`.
 * @returns absolute path of the verified executable.
 */
export async function ensureChannelBinary(channel: ImCliChannel, options: EnsureChannelBinaryOptions = {}): Promise<string> {
  return installer.ensureChannelBinary(channel, {
    ...options,
    binRoot: options.binRoot ?? cliBinRoot(),
    manifestPath: options.manifestPath ?? manifestPath(),
  })
}
