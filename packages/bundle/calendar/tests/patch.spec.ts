import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import * as yaml from 'js-yaml'
import { Config as ConfigSchema } from '../src/config.ts'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * The rows this bundle's patch contributes.
 *
 * The patch is the profile-facing surface, so its contents are checked from
 * source: a row another bundle may also insert, or a bound the schema refuses,
 * both stop the shipped composition from activating.
 * @returns the inserted rows.
 */
function insertedRows(): { id: string; name: string; config?: Record<string, unknown> }[] {
  const layers = yaml.load(readFileSync(join(packageRoot, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as
    [{ insert: { id: string; name: string; config?: Record<string, unknown> }[] }]
  expect(layers).toHaveLength(1)
  return layers[0]?.insert ?? []
}

describe('calendar bundle patch', () => {
  it('inserts only its own row so it never mounts a second Schedule service', () => {
    const rows = insertedRows()
    expect(rows.map(row => row.id)).toEqual(['calendar'])
    expect(rows[0]?.name).toBe('@deepseek-ai/dsh-calendar')
  })

  it('ships a configuration the plugin schema accepts', () => {
    const validated = ConfigSchema(insertedRows()[0]?.config ?? {})
    // A bound the profile writes but the schema rejects would stop the row from
    // activating, so the shipped values are validated here.
    expect(validated.maxResponseBytes.get()).toBe(2 * 1024 * 1024)
    expect(validated.retentionDays.get()).toBe(90)
    expect(validated.maxOccurrences.get()).toBe(2_000)
    expect(validated.recurrenceLookaheadSteps).toBeUndefined()
  })
})

describe('calendar bundle manifest', () => {
  it('declares every artifact the installed package must contain', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      name: string
      version: string
      main: string
      exports: Record<string, unknown>
      files: string[]
      dsh: { bundle: { patch: string }; client: { platform: string } }
    }
    expect(manifest.name).toBe('@deepseek-ai/dsh-calendar')
    expect(manifest.version).toBe('0.2.0-rc.2')
    expect(manifest.main).toBe('lib/index.js')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh.client.platform).toBe('web')
    // The generated Remote pair is part of the installed surface: without them
    // the Client has no descriptor to mount.
    expect(manifest.exports['./typert']).toEqual({ types: './lib/typert.host.d.ts', default: './lib/typert.host.js' })
    expect(manifest.exports['./remote']).toEqual({
      types: './lib/typert.remote-client.d.ts',
      default: './lib/typert.remote-client.js',
    })
    for (const artifact of [
      'lib/index.js', 'lib/client.js', 'lib/types/**/*.d.ts',
      'lib/typert.host.js', 'lib/typert.host.d.ts', 'lib/typert.remote-client.js', 'lib/typert.remote-client.d.ts',
    ]) expect(manifest.files).toContain(artifact)
  })

  it('ships the runtime the Host needs to read a feed and a task', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      peerDependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    for (const runtime of ['ical.js', '@deepseek-ai/dsh-typert-protocol']) {
      expect(manifest.dependencies[runtime], `missing runtime ${runtime}`).toBeDefined()
    }
    // Schedule and storage-domain exports are shared runtime identities — the
    // calendar compares a ScheduleInputError with `instanceof` and reads the
    // provider's own domain tables — so the installed Host must resolve the
    // provider's instance rather than a duplicate copy under this package.
    for (const runtime of ['@deepseek-ai/dsh-schedule', '@deepseek-ai/dsh-storage-domain']) {
      expect(manifest.peerDependencies[runtime], `missing peer ${runtime}`).toBeDefined()
      expect(manifest.devDependencies[runtime], `missing dev link ${runtime}`).toBeDefined()
      expect(manifest.dependencies[runtime], `${runtime} must not be an ordinary dependency`).toBeUndefined()
    }
  })
})
