import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { initProfile } from '@deepseek-ai/dsh-app-boot'
import type { ProfileContext } from '@deepseek-ai/dsh-app-boot'
import { DesktopProfileMigration } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

async function profile(name: string, bundles: readonly string[]): Promise<{ dir: string; context: Context }> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-profile-migration-'))
  roots.push(home)
  const dir = join(home, 'profile')
  initProfile(dir, [...bundles])
  const context = new Context()
  const facts: ProfileContext = {
    name, dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'),
    cwd: home, home, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
  }
  context.provide('profileContext', facts)
  onTestFinished(() => context.fiber.dispose())
  return { dir, context }
}

describe('Desktop profile migration marker', () => {
  it('keeps prior selections, including retired names, until an explicit choice is saved', async () => {
    const original = ['base', 'web-app', '@deepseek-ai/dsh-experimental-desktop-app']
    const fixture = await profile('desktop', original)
    const manifestBefore = await readFile(join(fixture.dir, 'package.json'), 'utf8')
    const service = new DesktopProfileMigration(fixture.context)

    const state = await service.read()

    expect(state.eligible).toBe(true)
    expect(state.complete).toBe(false)
    expect(state.selected).toEqual(original)
    expect(state.candidates).toContain('@deepseek-ai/dsh-community-plugin-catalog')
    expect(await readFile(join(fixture.dir, 'package.json'), 'utf8')).toBe(manifestBefore)
  })

  it('writes a marker only for chosen bundles already present in the saved selection', async () => {
    const chosen = '@deepseek-ai/dsh-community-plugin-catalog'
    const fixture = await profile('desktop', ['base', 'web-app', chosen])
    const service = new DesktopProfileMigration(fixture.context)

    await expect(service.complete(['base', 'web-app'], [chosen])).rejects.toThrow('selection changed')
    await expect(service.complete(['base', 'web-app', chosen], ['@deepseek-ai/dsh-community-skill-catalog']))
      .rejects.toThrow('not in the saved profile')
    await expect(service.read()).resolves.toMatchObject({ complete: false, selected: ['base', 'web-app', chosen] })

    const completed = await service.complete(['base', 'web-app', chosen], [chosen])
    expect(completed).toMatchObject({ complete: true, selected: ['base', 'web-app', chosen] })
    const marker: unknown = JSON.parse(await readFile(join(fixture.dir, 'desktop-bundle-migration.json'), 'utf8'))
    expect(marker).toMatchObject({ selected: [chosen] })
  })

  it('does not offer Desktop migration in another profile family', async () => {
    const fixture = await profile('web', ['base'])
    const service = new DesktopProfileMigration(fixture.context)
    await expect(service.read()).resolves.toMatchObject({ eligible: false, complete: false, selected: ['base'], candidates: [] })
  })
})
