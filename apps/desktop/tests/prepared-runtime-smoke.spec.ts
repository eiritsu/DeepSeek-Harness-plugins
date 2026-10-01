import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { assertDesktopDefaultRuntimeExcludesOptionalCua, smokePreparedRuntime } from '../scripts/smoke-prepared-runtime.ts'
import { smokeDesktopRuntime } from '../scripts/smoke-runtime.ts'
import { verifyDesktopRuntime, writeDesktopRuntime } from '../src/runtime-tree.ts'
import { runtimeFixture } from './runtime-fixture.ts'

const { payload } = vi.hoisted(() => ({ payload: vi.fn(async (
  _file: string,
  _args: string[],
  _options?: { cwd?: string; timeout?: number; windowsHide?: boolean; env?: NodeJS.ProcessEnv },
) => ({ stdout: '' })) }))
vi.mock('node:child_process', async (importOriginal) => {
  const { promisify } = await import('node:util')
  return { ...await importOriginal<typeof import('node:child_process')>(),
    execFile: Object.assign(vi.fn(), { [promisify.custom]: payload }) }
})
vi.mock('../scripts/smoke-runtime.ts', () => ({ smokeDesktopRuntime: vi.fn(async () => {}) }))

const roots: string[] = []
const hostArch = Object.getOwnPropertyDescriptor(process, 'arch')!
afterEach(() => {
  Object.defineProperty(process, 'arch', hostArch)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

it('smokes an x64 target verified on an arm64 build host without revalidating against the host', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prepared-runtime-target-'))
  roots.push(root)
  const fixture = runtimeFixture(root)
  const target = { platform: 'darwin' as const, arch: 'x64' }
  writeDesktopRuntime(root, fixture.release, fixture.sharedPackages.map(entry => entry.name), target)
  Object.defineProperty(process, 'arch', { ...hostArch, value: 'arm64' })
  await expect(verifyDesktopRuntime(root, fixture.release.version, { ...target, arch: process.arch }))
    .rejects.toThrow(/incompatible/u)
  const descriptor = await verifyDesktopRuntime(root, fixture.release.version, target)
  expect(() =>{  assertDesktopDefaultRuntimeExcludesOptionalCua(descriptor) }).not.toThrow()
  const electron = join(root, 'target-electron')
  const resources = join(root, 'runtime')
  await smokePreparedRuntime(root, electron, resources, descriptor)
  expect(payload).toHaveBeenCalledTimes(1)
  expect(payload.mock.calls[0]![0]).toBe(electron)
  expect(payload.mock.calls[0]![1]).toEqual(expect.arrayContaining([root, resources]))
  expect(smokeDesktopRuntime).toHaveBeenCalledWith(root, electron, expect.any(Object), resources)
  const environment = vi.mocked(smokeDesktopRuntime).mock.calls[0]![2]
  expect(existsSync(environment.NARB_NATIVE_CACHE_DIR!)).toBe(false)
})

it.each([
  '@deepseek-ai/dsh-experimental-computer-use-cua-native',
  '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
  '@deepseek-ai/dsh-computer-use',
  '@trycua/cua-driver',
])('rejects opt-in package %s in the default runtime package closure', (name) => {
  expect(() =>{  assertDesktopDefaultRuntimeExcludesOptionalCua({ sharedPackages: [{ name }], files: [] }) })
    .toThrow(/optional CUA packages/u)
  expect(() =>{  assertDesktopDefaultRuntimeExcludesOptionalCua({
    sharedPackages: [], files: [{ path: `node_modules/${name}/lib/index.js` }],
  }) }).toThrow(/optional CUA packages/u)
})
