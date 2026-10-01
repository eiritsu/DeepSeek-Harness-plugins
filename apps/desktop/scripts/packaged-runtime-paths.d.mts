import type { DesktopTargetBuildPaths } from './desktop-build-paths.mjs'

/**
 * Select the resource directory containing dsh for a packaged application.
 * @param unsignedTest Whether this is the unsigned macOS test build.
 * @returns Resource directory containing dsh.
 */
export function packagedDshDirectory(unsignedTest: boolean): 'app' | 'app.asar'

/**
 * Resolve smoke inputs for an explicit test flag without mutating process environment.
 * @param environment Caller environment.
 * @param unsignedTest Whether this is the unsigned macOS test build.
 * @param hostPlatform Host platform override for tests.
 * @param hostArch Host architecture override for tests.
 * @returns Paths for the selected target.
 */
export function packagedSmokeBuildPaths(
  environment: NodeJS.ProcessEnv,
  unsignedTest: boolean,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopTargetBuildPaths
