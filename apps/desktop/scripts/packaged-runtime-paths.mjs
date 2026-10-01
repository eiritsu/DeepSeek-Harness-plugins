import { resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'

/**
 * Select the dsh directory used by a packaged application.
 * @param {boolean} unsignedTest - Whether this is the unsigned macOS test build.
 * @returns {'app' | 'app.asar'} Resource directory containing dsh.
 */
export function packagedDshDirectory(unsignedTest) {
  return unsignedTest ? 'app' : 'app.asar'
}

/**
 * Resolve smoke inputs for an explicit test flag without mutating process environment.
 * @param {NodeJS.ProcessEnv} environment - Caller environment.
 * @param {boolean} unsignedTest - Whether this is the unsigned macOS test build.
 * @param {NodeJS.Platform | undefined} hostPlatform - Host platform override for tests.
 * @param {string | undefined} hostArch - Host architecture override for tests.
 * @returns {ReturnType<typeof resolveDesktopTargetBuildPaths>} Paths for the selected target.
 */
export function packagedSmokeBuildPaths(environment, unsignedTest, hostPlatform, hostArch) {
  const scopedEnvironment = unsignedTest
    ? { ...environment, DSH_DESKTOP_UNSIGNED_TEST: '1' }
    : environment
  return resolveDesktopTargetBuildPaths(scopedEnvironment, hostPlatform, hostArch)
}
