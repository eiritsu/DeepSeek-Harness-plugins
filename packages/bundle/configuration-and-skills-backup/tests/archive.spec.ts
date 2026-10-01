import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { PluginPackages } from '@deepseek-ai/dsh-app-boot'
import z from '@deepseek-ai/schemastery'
import { createArchive, redactConfig } from '../src/archive.ts'
import { BACKUP_FORMAT, BACKUP_VERSION, digest, MAX_ARCHIVE_BYTES, parseArchive, scanRoot, validateArchivePath, writeSkillFile } from '../src/archive.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'dsh-config-backup-'))
  roots.push(path)
  return path
}

function archiveWith(skillFiles: unknown[] = []) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: '2026-09-27T00:00:00.000Z',
    configs: [],
    bundles: [],
    skillRoots: [{ id: 'skill-filesystem:dsh-user:0', kind: 'dsh-user', label: 'Harness user skills' }],
    skillDirectories: [],
    skillFiles,
    unsupported: [],
  }
}

function file(path: string, data: string) {
  const bytes = Buffer.from(data)
  return { rootId: 'skill-filesystem:dsh-user:0', path, bytes: bytes.byteLength, sha256: digest(bytes), data: bytes.toString('base64') }
}

describe('configuration and skill archive validation', () => {
  it('archives the callable Config schema exposed by a live Cordis Loader entry', async () => {
    const dir = await tempRoot()
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-backup-fixture', private: true, dsh: { profile: { bundles: [] } } }))
    const ctx = new Context()
    const schema = z.object({ endpoint: z.string(), apiKey: z.string().role('secret') })
    const module = { name: 'backup-schema-fixture', Config: schema, apply() {} }
    await ctx.plugin(PluginPackages)
    await ctx.plugin(Loader)
    vi.spyOn(ctx.loader, 'import').mockResolvedValue(module)
    const id = await ctx.loader.create({ name: 'backup-schema-fixture' })
    await ctx.loader.await()
    try {
      const entry = ctx.loader.resolve(id)
      expect(typeof entry.fiber?.runtime?.Config).toBe('function')
      const archive = await createArchive({
        configEditor: { configuration: () => [
          { entry, override: { endpoint: 'https://example.test', apiKey: 'must-not-export' } },
          { entry: { options: { id: 'empty-no-schema' }, fiber: { runtime: {} } }, override: {} },
          { entry: { options: { id: 'valued-no-schema' }, fiber: { runtime: {} } }, override: { legacy: 'keep-visible' } },
        ] },
        loader: ctx.loader,
        pluginManager: { listBundles: async () => [] },
        profileContext: {
          name: 'test', dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: dir,
          cwd: dir, home: dir, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
        },
      } as never, [])
      expect(archive.configs).toEqual([expect.objectContaining({
        id,
        packageName: 'backup-schema-fixture',
        config: { endpoint: 'https://example.test' },
        secrets: [{ path: ['apiKey'], wasConfigured: true }],
      })])
      expect(JSON.stringify(archive)).not.toContain('must-not-export')
      expect(archive.unsupported).toEqual([{ kind: 'unknown-schema', id: 'valued-no-schema', reason: 'Active Config schema is unavailable.' }])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each(['../escape', '/absolute', 'a/../b', 'a\\b', 'a//b', 'a/./b', 'C:/drive', 'CON/secret.md', 'trailing./file'])('rejects unsafe archive path %s', (path) => {
    expect(() => validateArchivePath(path)).toThrow(/not relative|unsafe segment/)
  })

  it('rejects an archive document above its byte limit before parsing', () => {
    expect(() => parseArchive('{}', { maxArchiveBytes: 1 })).toThrow('upload limit')
    expect(MAX_ARCHIVE_BYTES).toBeGreaterThan(0)
  })

  it('rejects duplicate paths, file-directory collisions, and invalid hashes', () => {
    const duplicate = [file('skill/SKILL.md', 'body'), file('skill/SKILL.md', 'body')]
    expect(() => parseArchive(JSON.stringify(archiveWith(duplicate)))).toThrow(/duplicate skill path/)
    const collision = [file('skill', 'file'), file('skill/SKILL.md', 'body')]
    expect(() => parseArchive(JSON.stringify(archiveWith(collision)))).toThrow(/file\/directory path collision/)
    const directoryCollision = { ...archiveWith([file('skill', 'file')]), skillDirectories: [{ rootId: 'skill-filesystem:dsh-user:0', path: 'skill/nested' }] }
    expect(() => parseArchive(JSON.stringify(directoryCollision))).toThrow(/file\/directory path collision/)
    const invalid = file('skill/SKILL.md', 'body')
    invalid.sha256 = '0'.repeat(64)
    expect(() => parseArchive(JSON.stringify(archiveWith([invalid])))).toThrow(/integrity check failed/)
  })

  it('enforces expanded-byte and entry limits', () => {
    const rows = [file('one/SKILL.md', 'one'), file('two/SKILL.md', 'two')]
    expect(() => parseArchive(JSON.stringify(archiveWith(rows)), { maxSkillBytes: 5 })).toThrow(/expanded skill limit/)
    expect(() => parseArchive(JSON.stringify(archiveWith(rows)), { maxFiles: 1 })).toThrow(/too many skill files/)
  })

  it('redacts schema-declared secrets, retains references, and rejects unknown fields', () => {
    const schema = z.object({
      endpoint: z.string(),
      apiKeyEnv: z.string(),
      apiKey: z.string().role('secret'),
      nested: z.object({ token: z.string().role('secret') }),
    })
    const result = redactConfig(schema, {
      endpoint: 'https://example.test',
      apiKeyEnv: 'SERVICE_TOKEN',
      apiKey: 'do-not-archive',
      nested: { token: 'also-secret' },
    })
    expect(JSON.stringify(result)).not.toContain('do-not-archive')
    expect(JSON.stringify(result)).not.toContain('also-secret')
    expect(result.config).toEqual({ endpoint: 'https://example.test', apiKeyEnv: 'SERVICE_TOKEN', nested: {} })
    expect(result.secrets).toEqual([
      { path: ['apiKey'], wasConfigured: true },
      { path: ['nested', 'token'], wasConfigured: true },
    ])
    expect(() => redactConfig(schema, { endpoint: 'ok', injectedSecret: 'not declared' })).toThrow(/does not declare/)
  })

  it('walks declared arrays and tuples when checking secret fields', () => {
    const schema = z.object({
      headers: z.array(z.object({ name: z.string(), token: z.string().role('secret') })),
      retry: z.tuple([z.string(), z.number()]),
    })
    const result = redactConfig(schema, { headers: [{ name: 'Authorization', token: 'private' }], retry: ['fast', 2] })
    expect(result.config).toEqual({ headers: [{ name: 'Authorization' }], retry: ['fast', 2] })
    expect(result.secrets).toEqual([{ path: ['headers', '0', 'token'], wasConfigured: true }])
    expect(() => redactConfig(z.object({ headers: z.any() }), { headers: [{ token: 'unclassified' }] })).toThrow(/does not declare array values/)
  })

  it('rejects undeclared top-level archive data instead of silently dropping it', () => {
    expect(() => parseArchive(JSON.stringify({ ...archiveWith(), credentials: { token: 'secret' } }))).toThrow(/format or version/)
  })
})

describe('physical skill roots', () => {
  it('archives regular files and atomically replaces a selected destination file', async () => {
    const root = await tempRoot()
    await mkdir(join(root, 'demo'))
    await writeFile(join(root, 'demo', 'SKILL.md'), '# Demo')
    const [entry] = await scanRoot(root)
    expect(entry).toMatchObject({ path: 'demo/SKILL.md', bytes: 6, sha256: digest(Buffer.from('# Demo')) })

    await writeSkillFile(root, 'demo/SKILL.md', Buffer.from('# Updated'))
    await expect(readFile(join(root, 'demo', 'SKILL.md'), 'utf8')).resolves.toBe('# Updated')
    const priorFiles = await (await import('node:fs/promises')).readdir(join(root, 'demo'))
    const backupName = priorFiles.find(name => name.endsWith('.previous'))
    expect(backupName).toBeDefined()
    await expect(readFile(join(root, 'demo', backupName!), 'utf8')).resolves.toBe('# Demo')
    await expect(writeSkillFile(root, '../escape', Buffer.from('bad'))).rejects.toThrow(/unsafe segment/)
  })

  it('rejects symbolic-link roots and entries without following their targets', async () => {
    if (process.platform === 'win32') return
    const root = await tempRoot()
    const outside = await tempRoot()
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(outside, join(root, 'linked'))
    await expect(scanRoot(root)).rejects.toThrow(/symbolic link/)
    await expect(writeSkillFile(root, 'linked/restore.txt', Buffer.from('no'))).rejects.toThrow(/unsafe parent/)

    const alias = join(root, 'root-link')
    await symlink(outside, alias)
    await expect(scanRoot(alias)).rejects.toThrow(/regular directory/)
  })
})
