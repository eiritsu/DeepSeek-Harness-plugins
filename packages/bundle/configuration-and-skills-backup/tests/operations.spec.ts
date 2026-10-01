import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_FORMAT, BACKUP_VERSION, createArchive, digest } from '../src/archive.ts'
import { applyImport, previewImport } from '../src/operations.ts'
import type { ConfigurationSkillsArchive } from '../src/types.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-backup-import-'))
  temporary.push(path)
  return path
}

/**
 * Present a service double as Cordis's `Context`. The archive and import
 * operations reach the host only through the services and profile facts each
 * double supplies, so booting a real plugin graph would add no coverage.
 *
 * @param double - the services and profile facts one case needs.
 * @returns the same object, read as a `Context` by the operations under test.
 */
function hostContext(double: object): Context {
  return double as never
}

describe('configuration and skills import journal', () => {
  it('maps a completely missing source root to another configured root', async () => {
    const home = await tempDirectory()
    await writeFile(join(home, 'package.json'), JSON.stringify({ name: 'dsh-backup-test', private: true, dsh: { profile: { bundles: [] } } }))
    const sourceRoot = join(await tempDirectory(), 'source-skills')
    const destinationRoot = join(await tempDirectory(), 'restored-skills')
    await mkdir(sourceRoot)
    await mkdir(destinationRoot)
    const sourceBytes = Buffer.from('Public sample skill contents.\n')
    await writeFile(join(sourceRoot, 'SKILL.md'), sourceBytes)
    const entry = (customSkillDirs: string[]) => ({ options: {
      id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem',
      config: { includeDefaultRoots: false, customSkillDirs },
    } })
    const double = {
      configEditor: { configuration: () => [] },
      pluginManager: { listBundles: vi.fn(async () => []) },
      loader: { entries: () => [entry([sourceRoot])] },
      profileContext: {
        name: 'test', dir: home, patchPath: join(home, 'cordis.patch.yml'), installAnchor: home,
        cwd: home, home, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
      },
    }
    const ctx = hostContext(double)

    const archive = await createArchive(ctx, ['skill-filesystem:custom:0'])
    await rm(sourceRoot, { recursive: true })
    const currentCtx = hostContext({
      ...double,
      loader: { entries: () => [entry([sourceRoot, destinationRoot])] },
    })
    const sourceItemId = 'file:skill-filesystem:custom:0:SKILL.md'
    const noMapping = await previewImport(currentCtx, archive)
    expect(noMapping.items).toContainEqual(expect.objectContaining({ id: sourceItemId, status: 'missing' }))

    const mapping = { 'skill-filesystem:custom:0': 'skill-filesystem:custom:1' }
    const preview = await previewImport(currentCtx, archive, mapping)
    expect(preview.items).toContainEqual(expect.objectContaining({ id: sourceItemId, status: 'ready' }))
    const result = await applyImport(currentCtx, JSON.stringify(archive), [sourceItemId], preview.archiveId, mapping)
    expect(result.items).toContainEqual(expect.objectContaining({ id: sourceItemId, status: 'applied' }))
    const restored = await readFile(join(destinationRoot, 'SKILL.md'))
    expect(digest(restored)).toBe(digest(sourceBytes))
  })

  it('allows configuration-only import without mapping unrelated skill roots', async () => {
    const home = await tempDirectory()
    const schema = z.object({ enabled: z.boolean() })
    const entry = { options: { id: 'settings:0', name: '@deepseek-ai/dsh-test-settings' }, fiber: { runtime: { Config: schema } } }
    const edit = vi.fn(async (_target: unknown, update: (current: unknown, inherited: unknown) => unknown) => update({}, {}))
    const ctx = hostContext({
      configEditor: { configuration: () => [{ entry, override: {} }], edit },
      pluginManager: { listBundles: vi.fn(async () => []) },
      loader: { entries: () => [] },
      profileContext: { home, cwd: home },
    })
    const archive: ConfigurationSkillsArchive = {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: '2026-09-27T00:00:00.000Z',
      configs: [{ id: 'settings:0', packageName: '@deepseek-ai/dsh-test-settings', config: { enabled: true }, secrets: [] }],
      bundles: [], skillRoots: [{ id: 'old:custom:0', kind: 'custom', label: 'Custom root' }],
      skillDirectories: [{ rootId: 'old:custom:0', path: 'manual' }], skillFiles: [], unsupported: [],
    }
    const { previewImport } = await import('../src/operations.ts')
    const preview = await previewImport(ctx, archive)
    const result = await applyImport(ctx, JSON.stringify(archive), ['config:settings:0'], preview.archiveId)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'config:settings:0', status: 'applied' }),
      expect.objectContaining({ id: 'directory:old:custom:0:manual', status: 'missing' }),
    ]))
    expect(edit).toHaveBeenCalledOnce()
  })

  it('does not offer built-in skill roots as import destinations', async () => {
    const home = await tempDirectory()
    const bundled = await tempDirectory()
    const ctx = hostContext({
      configEditor: { configuration: () => [] },
      pluginManager: { listBundles: vi.fn(async () => []) },
      loader: { entries: () => [{ options: {
        id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem',
        config: { includeDefaultRoots: false, bundledSkillDir: bundled },
      } }] },
      profileContext: { home, cwd: home },
    })
    const archive: ConfigurationSkillsArchive = {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: '2026-09-27T00:00:00.000Z',
      configs: [], bundles: [],
      skillRoots: [{ id: 'source:bundled:0', kind: 'bundled', label: 'Built-in skills' }],
      skillDirectories: [{ rootId: 'source:bundled:0', path: 'review' }], skillFiles: [], unsupported: [],
    }
    const { previewImport } = await import('../src/operations.ts')
    const preview = await previewImport(ctx, archive, { 'source:bundled:0': 'skill-filesystem:bundled:0' })
    expect(preview.items).toEqual([expect.objectContaining({ status: 'missing', detail: 'No destination skill root was selected.' })])
  })

  it('keeps destination secret values when restoring only non-secret configuration', async () => {
    const home = await tempDirectory()
    const schema = z.object({ network: z.object({ endpoint: z.string(), token: z.string().role('secret') }) })
    const entry = { options: { id: 'settings:0', name: '@deepseek-ai/dsh-test-settings' }, fiber: { runtime: { Config: schema } } }
    let edited: unknown
    const ctx = hostContext({
      configEditor: {
        configuration: () => [{ entry, override: { network: { token: 'destination-only-secret' } } }],
        edit: vi.fn(async (_target: unknown, update: (current: unknown, inherited: unknown) => unknown) => {
          edited = update({}, { network: { endpoint: 'default' } })
        }),
      },
      pluginManager: { listBundles: vi.fn(async () => []) },
      loader: { entries: () => [] },
      profileContext: { home, cwd: home },
    })
    const archive: ConfigurationSkillsArchive = {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: '2026-09-27T00:00:00.000Z',
      configs: [{ id: 'settings:0', packageName: '@deepseek-ai/dsh-test-settings', config: {}, secrets: [{ path: ['network', 'token'], wasConfigured: true }] }],
      bundles: [], skillRoots: [], skillDirectories: [], skillFiles: [], unsupported: [],
    }
    const archiveText = JSON.stringify(archive)
    expect(archiveText).not.toContain('destination-only-secret')
    const { previewImport } = await import('../src/operations.ts')
    const preview = await previewImport(ctx, archive)
    const result = await applyImport(ctx, archiveText, ['config:settings:0'], preview.archiveId)
    expect(result.items[0]).toMatchObject({ status: 'applied' })
    expect(edited).toEqual({ network: { endpoint: 'default', token: 'destination-only-secret' } })
  })

  it('keeps successful items when another item fails and retries the failed item independently', async () => {
    const home = await tempDirectory()
    const skills = await tempDirectory()
    const fileBytes = Buffer.from('skill body')
    const bundle = { name: '@deepseek-ai/dsh-optional-feature', version: '0.1.7' }
    const archive: ConfigurationSkillsArchive = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: '2026-09-27T00:00:00.000Z',
      configs: [],
      bundles: [bundle],
      skillRoots: [{ id: 'skill-filesystem:custom:0', kind: 'custom', label: 'Custom skill root 1' }],
      skillDirectories: [],
      skillFiles: [{ rootId: 'skill-filesystem:custom:0', path: 'guide/SKILL.md', bytes: fileBytes.length, sha256: digest(fileBytes), data: fileBytes.toString('base64') }],
      unsupported: [],
    }
    let selected = false
    const calls = { listBundles: 0, setBundleEnabled: 0 }
    const pluginManager = {
      listBundles: vi.fn(async () => {
        calls.listBundles++
        return [{ name: bundle.name, enabled: selected, version: bundle.version }]
      }),
      setBundleEnabled: vi.fn(async () => {
        calls.setBundleEnabled++
        if (calls.setBundleEnabled === 1) return { application: 'failed', changed: false, error: { code: 'operation-error' } }
        selected = true
        return { application: 'applied', changed: true }
      }),
    }
    const ctx = hostContext({
      configEditor: { configuration: () => [] },
      pluginManager,
      loader: { entries: () => [{ options: {
        id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem',
        config: { includeDefaultRoots: false, customSkillDirs: [skills] },
      } }] },
      profileContext: { home, cwd: skills },
    })
    const archiveText = JSON.stringify(archive)
    const preview = await import('../src/operations.ts').then(({ previewImport }) => previewImport(ctx, archive))
    const archiveId = preview.archiveId
    const result = await applyImport(ctx, archiveText, ['bundle:@deepseek-ai/dsh-optional-feature', 'file:skill-filesystem:custom:0:guide/SKILL.md'], archiveId)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'file:skill-filesystem:custom:0:guide/SKILL.md', status: 'applied', detail: expect.stringContaining('Verified.') as string }),
      expect.objectContaining({ id: 'bundle:@deepseek-ai/dsh-optional-feature', status: 'failed' }),
    ]))
    await expect(readFile(join(skills, 'guide', 'SKILL.md'), 'utf8')).resolves.toBe('skill body')
    const retry = await applyImport(ctx, archiveText, ['bundle:@deepseek-ai/dsh-optional-feature'], archiveId)
    expect(retry.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bundle:@deepseek-ai/dsh-optional-feature', status: 'applied' }),
      expect.objectContaining({ id: 'file:skill-filesystem:custom:0:guide/SKILL.md', status: 'identical' }),
    ]))
    const journal = JSON.parse(await readFile(join(home, 'backups/configuration-and-skills/imports', `${archiveId}.json`), 'utf8')) as {
      items: Array<{ id: string; status: string }>
    }
    expect(journal.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bundle:@deepseek-ai/dsh-optional-feature', status: 'applied' }),
      expect.objectContaining({ id: 'file:skill-filesystem:custom:0:guide/SKILL.md', status: 'identical' }),
    ]))
    expect(calls.setBundleEnabled).toBe(2)
  })

  it('rejects a symlinked profile home before creating a journal', async () => {
    if (process.platform === 'win32') return
    const outside = await tempDirectory()
    const parent = await tempDirectory()
    const linkedHome = join(parent, 'profile')
    const { symlink } = await import('node:fs/promises')
    await symlink(outside, linkedHome)
    const ctx = hostContext({
      configEditor: { configuration: () => [] },
      pluginManager: {
        listBundles: vi.fn(async () => [{ name: '@deepseek-ai/dsh-test', enabled: false }]),
        setBundleEnabled: vi.fn(async () => ({ application: 'applied', changed: true })),
      },
      loader: { entries: () => [] },
      profileContext: { home: linkedHome, cwd: linkedHome },
    })
    const archive: ConfigurationSkillsArchive = {
      format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: '2026-09-27T00:00:00.000Z',
      configs: [], bundles: [{ name: '@deepseek-ai/dsh-test' }], skillRoots: [], skillDirectories: [], skillFiles: [], unsupported: [],
    }
    const { previewImport } = await import('../src/operations.ts')
    const preview = await previewImport(ctx, archive)
    await expect(applyImport(ctx, JSON.stringify(archive), ['bundle:@deepseek-ai/dsh-test'], preview.archiveId)).rejects.toThrow(/regular directory/)
    await expect(readdir(outside)).resolves.toEqual([])
  })
})
