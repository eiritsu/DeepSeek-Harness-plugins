/**
 * The Desktop bundle's substance is its patch layer over dsh-base and
 * dsh-web-app: exactly one session persistence provider, held in one SQLite
 * database. The web composition must keep the JSONL provider instead.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

/** Load one bundle package's declared patch files as parsed patch lists. */
function bundleLayers(packageDir: string): PatchOptions[][] {
  const manifest = JSON.parse(readFileSync(resolve(repoRoot, packageDir, 'package.json'), 'utf8')) as {
    dsh?: { bundle?: { patch?: string | string[] } }
  }
  const declared = manifest.dsh?.bundle?.patch
  const files = typeof declared === 'string' ? [declared] : declared
  if (files === undefined) throw new Error(`${packageDir} declares no dsh.bundle.patch`)
  return files.map((file) => {
    const parsed: unknown = yaml.load(
      readFileSync(resolve(repoRoot, packageDir, file), 'utf8'),
      { schema: entryListSchema },
    )
    if (!Array.isArray(parsed)) throw new Error(`${packageDir}/${file} must be a top-level patch list`)
    return parsed as PatchOptions[]
  })
}

/** Compose the supplied bundles over an empty root, as the launcher does. */
function compose(bundles: readonly string[]): EntryOptions[] {
  const layers = bundles.flatMap(bundleLayers)
  return applyEntryPatches([], layers.flat(), (message: string, ...args: unknown[]) => {
    throw new Error(`desktop-app composition: ${message} ${args.map(String).join(' ')}`)
  })
}

/** One composed row, including the nested `insert` list a patch adds. */
interface ComposedRow extends EntryOptions {
  insert?: ComposedRow[]
}

/** Every plugin row, descending `insert` lists the way the Loader mounts them. */
function rows(entries: readonly ComposedRow[]): ComposedRow[] {
  return entries.flatMap(entry => [entry, ...rows(entry.insert ?? [])])
}

const DESKTOP_BUNDLES = [
  'packages/bundle/base',
  'packages/bundle/web-app',
  'packages/experimental/desktop-app',
]

describe('dsh-experimental-desktop-app bundle composition', () => {
  it('replaces the JSONL persistence row with exactly one SQLite provider', () => {
    const composed = rows(compose(DESKTOP_BUNDLES))
    const active = composed.filter(entry => entry.disabled !== true)
    const persistence = active.filter(entry => typeof entry.name === 'string' && entry.name.includes('session-persistence'))
    expect(persistence.map(entry => entry.name)).toEqual(['@deepseek-ai/dsh-session-persistence-sqlite'])
    expect(composed.find(entry => entry.id === 'session-persistence-jsonl')?.disabled).toBe(true)
    expect(composed.find(entry => entry.id === 'session-persistence-sqlite')).toMatchObject({
      name: '@deepseek-ai/dsh-session-persistence-sqlite',
      config: { path: { __jsExpr: "dshHomePath('desktop', 'dsh-desktop.sqlite')" } },
    })
  })

  it('keeps the SQLite provider out of the web composition', () => {
    const names = rows(compose(['packages/bundle/base', 'packages/bundle/web-app'])).map(entry => entry.name)
    expect(names).not.toContain('@deepseek-ai/dsh-session-persistence-sqlite')
    expect(names).toContain('@deepseek-ai/dsh-session-persistence-jsonl')
  })
})
