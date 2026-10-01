import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const command = fileURLToPath(new URL('../tools/migrate-legacy-config.mjs', import.meta.url))

describe('legacy configuration archive converter', () => {
  it('writes a backup-import archive and separate private credentials without source values in the report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-legacy-converter-'))
    try {
      const inputs = join(root, 'inputs')
      const output = join(root, 'converted')
      await mkdir(inputs, { mode: 0o700 })
      const patch = join(inputs, 'cordis.patch.yml')
      const settings = join(inputs, 'settings.yaml')
      const credentials = join(inputs, 'credentials.yaml')
      await writeFile(patch, '- id: ui-theme\n  name: ui-theme\n  config:\n    preference: dark\n')
      await writeFile(settings, 'ui-theme:\n  preference: light\nui-chat:\n  transcriptView: normal\n')
      await writeFile(credentials, 'version: 1\nrefs:\n  SYNTHETIC_CREDENTIAL: synthetic-secret-value\n')

      const result = spawnSync(process.execPath, [command,
        '--patch', patch, '--settings', settings, '--credentials', credentials, '--output-dir', output], {
        cwd: packageRoot,
        encoding: 'utf8',
      })
      assert.equal(result.status, 0, result.stderr)

      const archiveText = await readFile(join(output, 'dsh-configuration-and-skills-backup-v1.json'), 'utf8')
      const archive = JSON.parse(archiveText)
      assert.equal(archive.format, 'dsh-configuration-and-skills-backup')
      assert.equal(archive.version, 1)
      assert.deepEqual(archive.configs.map(row => [row.id, row.packageName, row.config]), [
        ['ui-theme', '@deepseek-ai/dsh-client-ui-theme', { preference: 'dark' }],
        ['ui-chat', '@deepseek-ai/dsh-client-ui-chat', { transcriptView: 'standard' }],
      ])
      assert.ok(!archiveText.includes('synthetic-secret-value'))
      const report = await readFile(join(output, 'migration-report.json'), 'utf8')
      assert.ok(!report.includes('synthetic-secret-value'))
      assert.ok(!report.includes('preference: light'))
      const credentialText = await readFile(join(output, 'credentials-to-review.yaml'), 'utf8')
      assert.ok(credentialText.includes('synthetic-secret-value'))

      const outputInfo = await stat(output)
      const credentialsInfo = await stat(join(output, 'credentials-to-review.yaml'))
      assert.equal(outputInfo.mode & 0o777, 0o700)
      assert.equal(credentialsInfo.mode & 0o777, 0o600)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
