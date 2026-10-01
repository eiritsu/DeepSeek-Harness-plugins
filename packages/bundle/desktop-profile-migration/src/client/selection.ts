import type { DesktopProfileMigrationState } from '../types.ts'

/** Result returned by the official Plugin Manager bundle mutation Remote. */
export type BundleEnableResult =
  | { readonly ok: true; readonly value: { readonly application: string } }
  | { readonly ok: false; readonly error: { readonly message: string } }

/** Official operations used by explicit migration selection. */
export interface MigrationSelectionOperations {
  setBundleEnabled: (name: string, enabled: boolean) => Promise<BundleEnableResult>
  read: () => Promise<DesktopProfileMigrationState>
  complete: (expected: readonly string[], chosen: readonly string[]) => Promise<DesktopProfileMigrationState>
}

/** Divide migration candidates into packages installed in this profile and missing packages. */
export function splitInstalledCandidates(
  candidates: readonly string[], bundles: readonly { readonly name: string; readonly installed: boolean }[],
): { readonly installed: readonly string[]; readonly missing: readonly string[] } {
  const available = new Set(bundles.filter(bundle => bundle.installed).map(bundle => bundle.name))
  return {
    installed: candidates.filter(name => available.has(name)),
    missing: candidates.filter(name => !available.has(name)),
  }
}

/** Apply choices through Plugin Manager serially and re-read persisted state after failures. */
export async function applyMigrationSelection(
  current: readonly string[], chosen: readonly string[], operations: MigrationSelectionOperations,
): Promise<
  | { readonly kind: 'partial'; readonly state: DesktopProfileMigrationState; readonly failedName: string }
  | { readonly kind: 'complete'; readonly state: DesktopProfileMigrationState; readonly restartRequired: boolean }
> {
  const expected = [...current]
  let restartRequired = false
  for (const name of chosen) {
    let result: BundleEnableResult
    try { result = await operations.setBundleEnabled(name, true) }
    catch { return { kind: 'partial', state: await operations.read(), failedName: name } }
    if (!result.ok || (result.value.application !== 'applied' && result.value.application !== 'restart-required')) {
      return { kind: 'partial', state: await operations.read(), failedName: name }
    }
    restartRequired ||= result.value.application === 'restart-required'
    if (!expected.includes(name)) expected.push(name)
  }
  const state = await operations.complete(expected, chosen)
  return { kind: 'complete', state, restartRequired }
}
