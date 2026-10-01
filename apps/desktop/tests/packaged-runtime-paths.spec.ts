import { join } from 'node:path'
import { expect, it } from 'vitest'
import { packagedDshDirectory, packagedSmokeBuildPaths } from '../scripts/packaged-runtime-paths.mjs'

it('selects the physical app tree only for the unsigned macOS test build', () => {
  const resources = join('Contents', 'Resources')
  expect(join(resources, packagedDshDirectory(true), 'dsh')).toBe(join(resources, 'app', 'dsh'))
  expect(join(resources, packagedDshDirectory(false), 'dsh')).toBe(join(resources, 'app.asar', 'dsh'))
})

it('uses the unsigned-test target root for the flag without mutating the environment', () => {
  const environment = { DSH_DESKTOP_TARGET_PLATFORM: 'darwin', DSH_DESKTOP_TARGET_ARCH: 'arm64' }
  const fromFlag = packagedSmokeBuildPaths(environment, true, 'darwin', 'arm64')
  const fromEnvironment = packagedSmokeBuildPaths({ ...environment, DSH_DESKTOP_UNSIGNED_TEST: '1' }, true, 'darwin', 'arm64')
  const release = packagedSmokeBuildPaths(environment, false, 'darwin', 'arm64')
  expect(fromFlag.root).toContain(join('targets', 'mac-arm64', 'unsigned-test'))
  expect(fromFlag).toEqual(fromEnvironment)
  expect(release.root).not.toContain(join('targets', 'mac-arm64', 'unsigned-test'))
  expect(environment).not.toHaveProperty('DSH_DESKTOP_UNSIGNED_TEST')
})
