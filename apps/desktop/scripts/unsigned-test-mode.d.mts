/** Fixed identity for a local-only, unsigned macOS test application. */
export const DESKTOP_UNSIGNED_TEST_APP_ID: string
export const DESKTOP_UNSIGNED_TEST_APP_VERSION: string
export const DESKTOP_UNSIGNED_TEST_ENV: string

/** Read the explicit test-mode switch, rejecting malformed environment values. */
export function isDesktopUnsignedTest(environment: Record<string, string | undefined>): boolean

/** Label the isolated Electron test version separately from its bundled runtime. */
export function formatUnsignedTestVersionPair(runtimeVersion: string): string

/** Version fields recorded only for an isolated unsigned test application. */
export function unsignedTestVersionMetadata(runtimeVersion: string): {
  testAppVersion: string
  bundledRuntimeVersion: string
}
