/** Check payloads and Host boot with private native-cache and Harness directories. */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { runtimeArchivePath } from '../../desktop-host/src/office-engine.ts'
import { desktopNodeEnvironment } from '../src/node-environment.ts'
import type { DesktopRuntimeDescriptor } from '../src/runtime-tree.ts'
import { scrubWindowsSigningEnvironment } from './windows-sign.mjs'
import { smokeDesktopRuntime } from './smoke-runtime.ts'
import { verifyRuntimeArchive } from './verify-runtime-archive.ts'

const OPTIONAL_CUA_PACKAGES = [
  '@deepseek-ai/dsh-experimental-computer-use-cua-native',
  '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
  '@deepseek-ai/dsh-computer-use',
  '@trycua/cua-driver',
] as const

/** Require that the default package closure excludes opt-in native computer-use packages.
 * @param inventory - Package names and file paths sealed into the runtime descriptor.
 * @returns Nothing.
 */
export function assertDesktopDefaultRuntimeExcludesOptionalCua(inventory: {
  readonly sharedPackages: readonly { readonly name: string }[]
  readonly files: readonly { readonly path: string }[]
}): void {
  const included = OPTIONAL_CUA_PACKAGES.filter((name) => {
    const packagePath = `node_modules/${name}/`
    return inventory.sharedPackages.some(entry => entry.name === name)
      || inventory.files.some(file => file.path.startsWith(packagePath))
  })
  if (included.length > 0) {
    throw new Error(`desktop smoke: optional CUA packages are in the default runtime: ${included.join(', ')}`)
  }
}

/**
 * Exercise real runtime files and Host composition, including an ASAR root when packaged.
 * @param root Prepared or archived dsh directory.
 * @param node Target Electron executable.
 * @param resourcesRuntime External runtime directory beside the archive.
 * @param descriptor Runtime descriptor already verified against the selected target, which may differ from the build host.
 * @returns Resolves after archive integrity, payload checks, Host startup, Office conversion and teardown.
 */
export async function smokePreparedRuntime(
  root: string, node: string, resourcesRuntime: string, descriptor: DesktopRuntimeDescriptor,
): Promise<void> {
  const cache = await mkdtemp(join(tmpdir(), 'desktop-native-smoke-'))
  const environment = { ...scrubWindowsSigningEnvironment(process.env), NODE_OPTIONS: '',
    NARB_NATIVE_CACHE_DIR: cache, NARB_DISABLE_NATIVE_CACHE: '0' }
  try {
    assertDesktopDefaultRuntimeExcludesOptionalCua(descriptor)
    const archive = runtimeArchivePath(root)
    if (archive !== undefined) await verifyRuntimeArchive(archive, descriptor)
    const { stdout } = await promisify(execFile)(node, [
      '--expose-internals', resolve(import.meta.dirname, '../tests/fixtures/runtime-payload-smoke.mjs'), root, resourcesRuntime,
    ], { timeout: 120_000, windowsHide: true,
      env: desktopNodeEnvironment(node, join(resourcesRuntime, 'bin'), environment) })
    process.stdout.write(stdout)
    await smokeDesktopRuntime(root, node, environment, resourcesRuntime)
  } finally {
    await rm(cache, { recursive: true, force: true })
  }
}
