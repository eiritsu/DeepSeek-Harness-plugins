import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { SkillHubCatalog, replaceSkill, validateSkillHubFile, validateSkillHubSlug } from '../src/host/skillhub-catalog.ts'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skillhub-test-'))
  roots.push(root)
  return root
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('SkillHub response validation', () => {
  it('normalizes a valid slug and rejects path-like slugs', () => {
    expect(validateSkillHubSlug('Example-skill_1')).toBe('example-skill_1')
    expect(() => validateSkillHubSlug('../outside')).toThrow('slug is invalid')
    expect(() => validateSkillHubSlug('skill/name')).toThrow('slug is invalid')
  })

  it('accepts file metadata above the preview endpoint size and rejects unsafe paths', () => {
    const valid = { path: 'references/guide.md', size: 4, sha256: 'a'.repeat(64) }
    expect(validateSkillHubFile(valid)).toEqual({ ...valid, sha256: 'a'.repeat(64) })
    for (const path of ['../SKILL.md', '/SKILL.md', 'a//b', 'a\\b', 'C:evil']) {
      expect(() => validateSkillHubFile({ ...valid, path })).toThrow('unsafe file path')
    }
    expect(validateSkillHubFile({ ...valid, size: 1024 * 1024 + 1 }).size).toBe(1024 * 1024 + 1)
    expect(() => validateSkillHubFile({ ...valid, sha256: 'bad' })).toThrow('invalid SHA-256')
  })
})

describe('verified skill replacement', () => {
  it('keeps the previous skill if staging fails', async () => {
    const root = await temporaryRoot()
    const target = join(root, 'example-skill')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), 'previous')
    await expect(replaceSkill(root, target, [
      { path: 'SKILL.md', bytes: new TextEncoder().encode('replacement') },
      { path: 'SKILL.md', bytes: new TextEncoder().encode('duplicate') },
    ])).rejects.toThrow()
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('previous')
  })

  it('does not replace the previous skill when the request is cancelled before commit', async () => {
    const root = await temporaryRoot()
    const target = join(root, 'example-skill')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), 'previous')
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(replaceSkill(root, target, [{ path: 'SKILL.md', bytes: new TextEncoder().encode('replacement') }], controller.signal)).rejects.toThrow('cancelled')
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('previous')
  })

  it('replaces a reviewed tree only after all files are staged', async () => {
    const root = await temporaryRoot()
    const target = join(root, 'example-skill')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), 'previous')
    await replaceSkill(root, target, [
      { path: 'SKILL.md', bytes: new TextEncoder().encode('new') },
      { path: 'references/help.md', bytes: new TextEncoder().encode('help') },
    ])
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('new')
    expect(await readFile(join(target, 'references/help.md'), 'utf8')).toBe('help')
  })

  it('reports a retained backup as a cleanup warning after committing the replacement', async () => {
    const root = await temporaryRoot()
    const target = join(root, 'example-skill')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), 'previous')
    const pending = await replaceSkill(root, target, [{ path: 'SKILL.md', bytes: new TextEncoder().encode('new') }], undefined, async () => { throw new Error('cleanup failed') })
    expect(pending).toMatch(/\.skillhub\/backup-/u)
    expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('new')
    expect(await readFile(join(pending!, 'SKILL.md'), 'utf8')).toBe('previous')
    expect((await readdir(root)).sort()).toEqual(['.skillhub', 'example-skill'])
    expect((await readdir(join(root, '.skillhub'))).some(path => path.startsWith('replace-'))).toBe(false)
  })
})

describe('global installed skill management', () => {
  async function withCatalog<T>(root: string, run: (catalog: SkillHubCatalog) => Promise<T>): Promise<T> {
    const ctx = new Context()
    const catalog = new SkillHubCatalog(ctx, { skillRoot: root })
    try { return await run(catalog) }
    finally { await ctx.fiber.dispose() }
  }

  it('lists only regular skill directories and decodes SkillHub folder names for display', async () => {
    const root = await temporaryRoot()
    await mkdir(join(root, '%40publisher%2Fcatalog-skill'))
    await writeFile(join(root, '%40publisher%2Fcatalog-skill', 'SKILL.md'), '# skill')
    await mkdir(join(root, 'without-manifest'))
    await mkdir(join(root, '.skillhub'))
    await writeFile(join(root, 'flat.md'), '# not a directory skill')

    await withCatalog(root, async (catalog) => {
      await expect(catalog.listInstalledSkills()).resolves.toEqual([
        { id: '%40publisher%2Fcatalog-skill', name: '@publisher/catalog-skill' },
      ])
    })
  })

  it('requires confirmation and removes only the selected direct skill directory', async () => {
    const root = await temporaryRoot()
    const target = join(root, 'installed')
    await mkdir(target)
    await writeFile(join(target, 'SKILL.md'), '# skill')
    await writeFile(join(target, 'guide.md'), 'owned skill content')
    const outside = join(root, 'outside.txt')
    await writeFile(outside, 'keep')

    await withCatalog(root, async (catalog) => {
      await expect(catalog.removeInstalledSkill('installed', false)).rejects.toThrow('Confirm skill removal')
      await expect(catalog.removeInstalledSkill('../outside.txt', true)).rejects.toThrow('id is invalid')
      await expect(catalog.removeInstalledSkill('installed', true)).resolves.toBe('installed')
    })

    await expect(readFile(outside, 'utf8')).resolves.toBe('keep')
    await expect(readFile(join(target, 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
