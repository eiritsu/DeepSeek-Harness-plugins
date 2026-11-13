import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('@deepseek-ai/dsh-purge bundle verification', () => {
  const root = join(fileURLToPath(new URL('..', import.meta.url)))

  it('declares valid cordis.patch.yml with dsh-purge entries', () => {
    const patchPath = join(root, 'cordis.patch.yml')
    expect(existsSync(patchPath)).toBe(true)
    const content = readFileSync(patchPath, 'utf8')
    const patch = load(content, { schema: entryListSchema }) as Array<Record<string, unknown>>
    expect(Array.isArray(patch)).toBe(true)

    const insertRow = patch.find(row => Array.isArray(row.insert)) as { insert: Array<{ id: string; name?: string }> } | undefined
    expect(insertRow).toBeDefined()

    const mainEntry = insertRow!.insert.find(item => item.id === 'dsh-purge')
    expect(mainEntry).toBeDefined()
    expect(mainEntry!.name).toBe('@deepseek-ai/dsh-purge')

    const redteamEntry = insertRow!.insert.find(item => item.id === 'dsh-purge-redteam')
    expect(redteamEntry).toBeDefined()
    expect(redteamEntry!.name).toBe('@deepseek-ai/dsh-purge/redteam')
  })

  it('has package.json aligned to 0.2.2-rc.1 and repository standards', () => {
    const pkgPath = join(root, 'package.json')
    expect(existsSync(pkgPath)).toBe(true)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

    expect(pkg.name).toBe('@deepseek-ai/dsh-purge')
    expect(pkg.version).toBe('0.2.2-rc.1')
    expect(pkg.dshTarget).toBe('0.2.2-rc.1')
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(pkg.exports['.']?.default).toBe('./lib/index.js')
    expect(pkg.exports['./client']).toBe('./client.js')
    expect(pkg.exports['./redteam']).toBe('./lib/redteam/index.js')
  })

  it('exports valid main module from lib/index.js', async () => {
    const mod = await import(join(root, 'lib', 'index.js'))
    expect(typeof mod.apply).toBe('function')
    expect(mod.name).toBe('dsh-purge')
    expect(Array.isArray(mod.inject)).toBe(true)
  })

  it('contains redteam presets and skills', () => {
    expect(existsSync(join(root, 'presets', 'redteam', 'preset.yml'))).toBe(true)
    expect(existsSync(join(root, 'presets', 'redteam', 'agent.cordis.yml'))).toBe(true)
    expect(existsSync(join(root, 'skills', 'redteam', 'recon-pipeline.md'))).toBe(true)
  })
})
