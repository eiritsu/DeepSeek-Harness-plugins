import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { load } from 'js-yaml'
import { ComputerUseRegistry } from '../src/registry.ts'
import { ComputerUseProviderName } from '../src/brand.ts'

import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('cua-bundle self-contained package', () => {
  it('bundles prebuilt signed native helper receipt for darwin-arm64', () => {
    const root = join(fileURLToPath(new URL('..', import.meta.url)))
    const currentJson = join(root, 'native', 'bin', 'darwin-arm64', 'current.json')
    expect(existsSync(currentJson)).toBe(true)
    const receipt = JSON.parse(readFileSync(currentJson, 'utf8'))
    expect(typeof receipt.bundle).toBe('string')
    const appPath = join(root, 'native', 'bin', 'darwin-arm64', receipt.bundle, 'DSH Computer Use.app', 'Contents', 'MacOS', 'dsh-cua-native')
    expect(existsSync(appPath)).toBe(true)
  })

  it('provides ComputerUseRegistry capability seamlessly', () => {
    const ctx = new Context()
    new ComputerUseRegistry(ctx)
    expect(ctx.computerUse).toBeDefined()
    const disposer = ctx.computerUse.register(ComputerUseProviderName('test-cua'))
    expect(ctx.computerUse.providerName).toBe('test-cua')
    disposer()
    expect(ctx.computerUse.providerName).toBeUndefined()
  })

  it('has self-contained cordis.patch.yml configuring persistent PTC and default preset', () => {
    const patchPath = join(fileURLToPath(new URL('..', import.meta.url)), 'cordis.patch.yml')
    const patch = load(readFileSync(patchPath, 'utf8'), { schema: entryListSchema }) as Array<Record<string, unknown>>
    expect(Array.isArray(patch)).toBe(true)
    const insertRow = patch.find(row => Array.isArray(row.insert)) as { insert: Array<{ id: string; name?: string }> } | undefined
    expect(insertRow).toBeDefined()
    const cuaEntry = insertRow!.insert.find(item => item.id === 'dsh-cua-bundle')
    expect(cuaEntry).toBeDefined()
    expect(cuaEntry!.name).toBe('@deepseek-ai/dsh-cua-bundle')

    const ptcRow = patch.find(row => row.id === 'ptc-runtime') as { config?: { executionMode?: string } } | undefined
    expect(ptcRow).toBeDefined()
    expect(ptcRow?.config?.executionMode).toBe('persistent-in-memory')

    const presetRow = patch.find(row => row.id === 'agent-preset-registry') as { config?: { selectedDefault?: string } } | undefined
    expect(presetRow).toBeDefined()
    expect(presetRow?.config?.selectedDefault).toBe('ptc')
  })
})
