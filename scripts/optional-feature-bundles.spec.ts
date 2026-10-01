/** Optional feature bundles add independent patch layers over the official Web profile. */

import { globSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadOverlayPatches } from '../packages/boot/app-boot/src/index.ts'
import { DEFAULT_PROFILE_BUNDLES, OPTIONAL_BUNDLES, PROFILE_TEMPLATES, bundlePatchPaths, composeEntries } from '../packages/boot/app-boot/src/profile.ts'
import type { DshBundleManifest } from '../packages/util/package-manifest/src/types.ts'

const root = resolve(import.meta.dirname, '..')

interface Manifest {
  name: string
  dependencies?: Record<string, string>
  dsh?: { bundle?: DshBundleManifest; client?: { inject?: string[]; platform?: string } }
}

const manifests = new Map(globSync('packages/*/*/package.json', { cwd: root }).map((path) => {
  const filename = resolve(root, path)
  const manifest = JSON.parse(readFileSync(filename, 'utf8')) as Manifest
  return [manifest.name, { path: filename, dir: dirname(filename), manifest }]
}))

const definitions = [
  { bundle: '@deepseek-ai/dsh-lark-integration', rows: ['lark'], clientRows: [] },
  { bundle: '@deepseek-ai/dsh-copy-session-id', rows: ['ui-copy-session-id'], clientRows: ['ui-copy-session-id'] },
  { bundle: '@deepseek-ai/dsh-turn-process-shimmer', rows: ['ui-turn-process-shimmer'], clientRows: ['ui-turn-process-shimmer'] },
  { bundle: '@deepseek-ai/dsh-tools-connections', rows: ['tools-connections'], clientRows: [] },
  { bundle: '@deepseek-ai/dsh-experimental-computer-use-cua-native', rows: ['computer-use', 'computer-use-cua-driver-native'], clientRows: [] },
] as const

const standaloneBundles = [
  '@deepseek-ai/dsh-community-plugin-catalog',
  '@deepseek-ai/dsh-community-skill-catalog',
  '@deepseek-ai/dsh-file-recognizer-office',
  '@deepseek-ai/dsh-model-catalog',
  '@deepseek-ai/dsh-configuration-and-skills-backup',
  '@deepseek-ai/dsh-desktop-profile-migration-bundle',
  '@deepseek-ai/dsh-session-archive',
  '@deepseek-ai/dsh-session-message-edit-resend',
  ...definitions.map(({ bundle }) => bundle),
] as const

function patches(name: string) {
  const entry = manifests.get(name)
  if (entry?.manifest.dsh?.bundle === undefined) throw new Error(`${name} is not a workspace bundle`)
  return bundlePatchPaths(entry.dir, entry.manifest.dsh.bundle).flatMap(path => loadOverlayPatches('test', path))
}

describe('optional feature bundles', () => {
  const officialWeb = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'].map(patches)

  it.each(standaloneBundles)('%s remains an installed opt-in bundle', (bundle) => {
    const entry = manifests.get(bundle)
    expect(entry?.manifest.dsh?.bundle).toBeDefined()
    expect(DEFAULT_PROFILE_BUNDLES).not.toContain(bundle)
    for (const template of Object.values(PROFILE_TEMPLATES)) expect(template.bundles).not.toContain(bundle)
    const inserted = patches(bundle).flatMap(patch => patch.insert ?? [])
    expect(inserted.length).toBeGreaterThan(0)
    expect(inserted.some(row => typeof row.name === 'string')).toBe(true)
  })

  it.each(definitions)('$bundle composes independently over the official Web layers', ({ bundle, rows }) => {
    const selected = patches(bundle)
    const warnings: string[] = []
    const baseline = composeEntries(officialWeb).map(row => row.id)
    const enabled = composeEntries([...officialWeb, selected], message => warnings.push(message)).map(row => row.id)

    expect(warnings).toEqual([])
    for (const id of rows) {
      expect(baseline).not.toContain(id)
      expect(enabled).toContain(id)
    }
  })

  it('composes all five layers together without changing the Web template selection', () => {
    const names = definitions.map(({ bundle }) => bundle)
    const rows = definitions.map(({ bundle }) => patches(bundle))
    const warnings: string[] = []
    const ids = composeEntries([...officialWeb, ...rows], message => warnings.push(message)).map(row => row.id)

    expect(warnings).toEqual([])
    expect(new Set(ids).size).toBe(ids.length)
    for (const { rows: expected } of definitions) for (const id of expected) expect(ids).toContain(id)
    for (const name of names) {
      expect(DEFAULT_PROFILE_BUNDLES).not.toContain(name)
      for (const template of Object.values(PROFILE_TEMPLATES)) expect(template.bundles).not.toContain(name)
    }
  })

  it.each(definitions)('$bundle declares every patched package as a direct dependency', ({ bundle, rows, clientRows }) => {
    const entry = manifests.get(bundle)
    expect(entry).toBeDefined()
    const inserted = patches(bundle).flatMap(patch => patch.insert ?? [])
    expect(inserted.map(row => row.id)).toEqual(rows)

    for (const row of inserted) {
      const name = typeof row.name === 'string' ? row.name : undefined
      expect(name).toBeDefined()
      expect(name === bundle || entry?.manifest.dependencies?.[name as string]).toBeTruthy()
      expect(manifests.has(name as string)).toBe(true)
    }

    for (const id of clientRows) {
      const row = inserted.find(candidate => candidate.id === id)
      const client = manifests.get(row?.name as string)?.manifest
      expect(client?.dsh?.client?.platform).toBe('web')
      expect(client?.dsh?.client?.inject?.length).toBeGreaterThan(0)
    }
  })

  it('keeps Lark disabled by default and Firecrawl inside the External Tools row', () => {
    const lark = patches('@deepseek-ai/dsh-lark-integration').flatMap(patch => patch.insert ?? [])
    expect(lark.find(row => row.id === 'lark')?.config).toMatchObject({ enabled: false })
    expect(manifests.get('@deepseek-ai/dsh-lark-integration')?.manifest.dsh?.client?.platform).toBe('web')

    expect(manifests.get('@deepseek-ai/dsh-web-extract-firecrawl')).toBeUndefined()
    expect(manifests.get('@deepseek-ai/dsh-firecrawl')).toBeUndefined()
    expect(patches('@deepseek-ai/dsh-tools-connections').flatMap(patch => patch.insert ?? []).map(row => row.id))
      .toEqual(['tools-connections'])
  })

  it('keeps native CUA outside every profile template and composes only official rows', () => {
    const nativeBundle = '@deepseek-ai/dsh-experimental-computer-use-cua-native'
    expect(OPTIONAL_BUNDLES).not.toContain(nativeBundle)
    expect(DEFAULT_PROFILE_BUNDLES).not.toContain(nativeBundle)
    for (const template of Object.values(PROFILE_TEMPLATES)) expect(template.bundles).not.toContain(nativeBundle)
    expect(patches(nativeBundle).flatMap(patch => patch.insert ?? []).map(row => row.name)).toEqual([
      '@deepseek-ai/dsh-computer-use',
      '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
    ])
  })
})
