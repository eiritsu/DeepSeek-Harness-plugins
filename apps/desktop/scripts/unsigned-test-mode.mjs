/** Fixed identity for a local-only, unsigned macOS test application. */
export const DESKTOP_UNSIGNED_TEST_APP_ID = 'com.deepseek.harness.unsignedtest'
export const DESKTOP_UNSIGNED_TEST_APP_VERSION = '0.1.22'
export const DESKTOP_UNSIGNED_TEST_ENV = 'DSH_DESKTOP_UNSIGNED_TEST'

/** Read the explicit test-mode switch, rejecting malformed environment values. */
export function isDesktopUnsignedTest(environment) {
  const value = environment[DESKTOP_UNSIGNED_TEST_ENV]
  if (value === undefined || value === '0') return false
  if (value !== '1') throw new Error(`desktop package: ${DESKTOP_UNSIGNED_TEST_ENV} must be 0 or 1`)
  return true
}

/** Label the isolated Electron test version separately from its bundled runtime.
 * @param {string} runtimeVersion - Version declared by the bundled dsh runtime.
 * @returns {string} Label containing both version owners.
 */
export function formatUnsignedTestVersionPair(runtimeVersion) {
  return `unsigned test App version ${DESKTOP_UNSIGNED_TEST_APP_VERSION}; bundled DSH runtime version ${runtimeVersion}`
}

/** Version fields recorded only for an isolated unsigned test application.
 * @param {string} runtimeVersion - Version declared by the bundled dsh runtime.
 * @returns {{testAppVersion: string, bundledRuntimeVersion: string}} Separate application and runtime versions.
 */
export function unsignedTestVersionMetadata(runtimeVersion) {
  return {
    testAppVersion: DESKTOP_UNSIGNED_TEST_APP_VERSION,
    bundledRuntimeVersion: runtimeVersion,
  }
}
