/** Optional Host entry for explicit migration of an existing Desktop profile. */

import { join } from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { readProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import Schema from '@deepseek-ai/schemastery'
import { DESKTOP_MIGRATION_CANDIDATES, type DesktopProfileMigrationState } from './types.ts'
export { DESKTOP_MIGRATION_CANDIDATES, type DesktopProfileMigrationState } from './types.ts'

const MARKER = 'desktop-bundle-migration.json'

interface Marker {
  readonly schemaVersion: 1
  readonly selected: readonly string[]
  readonly completedAt: string
}

/** Stores the explicit migration marker in the current profile. */
export class DesktopProfileMigration extends TypertRemoteService {
  static inject = ['profileContext']
  static Config = Schema.object({})
  private readonly profile: Context['profileContext']

  constructor(ctx: Context) {
    super(ctx, 'desktopProfileMigration')
    this.profile = ctx.profileContext
  }

  /** Read current Desktop selection and pending optional candidates.
   * @returns The selection and whether this profile has recorded a choice.
   */
  @Remote
  async read(): Promise<DesktopProfileMigrationState> {
    const profile = this.profile
    const selected = readProfileManifest('dsh', profile.dir).dsh?.profile?.bundles ?? []
    if (profile.name !== 'desktop') return { eligible: false, complete: false, selected, candidates: [] }
    try {
      await readMarker(join(profile.dir, MARKER))
      return { eligible: true, complete: true, selected, candidates: [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { eligible: true, complete: false, selected, candidates: [], warning: messageOf(error) }
      }
    }
    const existing = new Set(selected)
    return {
      eligible: true,
      complete: false,
      selected,
      candidates: DESKTOP_MIGRATION_CANDIDATES.filter(name => !existing.has(name)),
    }
  }

  /** Record the chosen subset after the official Plugin Manager saves it.
   * @param expectedSelection - Full selection observed after Plugin Manager operations.
   * @param chosen - Migration candidates present in the saved selection.
   * @returns The committed migration state.
   */
  @Remote
  async complete(expectedSelection: readonly string[], chosen: readonly string[]): Promise<DesktopProfileMigrationState> {
    const profile = this.profile
    if (profile.name !== 'desktop') throw new Error('Desktop migration is unavailable for this profile.')
    validateSelection(expectedSelection)
    validateNames(chosen, DESKTOP_MIGRATION_CANDIDATES)
    const path = join(profile.dir, MARKER)
    await withFileLock(join(profile.dir, 'package.json'), async () => {
      const current = readProfileManifest('dsh', profile.dir).dsh?.profile?.bundles ?? []
      if (JSON.stringify(current) !== JSON.stringify(expectedSelection)) throw new Error('Desktop bundle selection changed; reload and retry.')
      if (chosen.some(name => !current.includes(name))) throw new Error('A selected migration bundle is not in the saved profile.')
      try {
        await readMarker(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const marker: Marker = { schemaVersion: 1, selected: [...chosen], completedAt: new Date().toISOString() }
        await writeFileAtomic(path, `${JSON.stringify(marker, undefined, 2)}\n`, { mode: 0o600 })
      }
    })
    const state = await this.read()
    if (!state.complete) throw new Error(state.warning ?? 'Desktop migration marker was not committed.')
    return state
  }
}

export default DesktopProfileMigration

async function readMarker(path: string): Promise<Marker> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Desktop migration marker is not a regular file.')
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Desktop migration marker is invalid.')
  const marker = value as Record<string, unknown>
  if (marker.schemaVersion !== 1 || typeof marker.completedAt !== 'string' || !Array.isArray(marker.selected)) {
    throw new Error('Desktop migration marker is invalid.')
  }
  const selected = marker.selected as unknown[]
  const names = selected.filter((name): name is string => typeof name === 'string')
  if (names.length !== selected.length) throw new Error('Desktop migration marker is invalid.')
  validateNames(names, DESKTOP_MIGRATION_CANDIDATES)
  return { schemaVersion: 1, selected: [...names], completedAt: marker.completedAt }
}

function validateNames(names: readonly string[], allowed: readonly string[]): void {
  if (new Set(names).size !== names.length || names.some(name => !allowed.includes(name))) {
    throw new Error('Desktop migration contains an invalid bundle selection.')
  }
}

function validateSelection(names: readonly string[]): void {
  if (names.some(name => typeof name !== 'string') || new Set(names).size !== names.length) {
    throw new Error('Desktop migration contains an invalid profile selection.')
  }
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }
