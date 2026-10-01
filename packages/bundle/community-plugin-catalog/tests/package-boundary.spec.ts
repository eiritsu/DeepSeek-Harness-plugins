import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

const packageDir = new URL('../', import.meta.url)

it('ships the Host and dynamic Client in one package without custom runtime dependencies', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', packageDir), 'utf8')) as {
    dependencies?: Record<string, string>
    files?: string[]
    dsh?: { bundle?: { patch?: string }; client?: { inject?: string[]; platform?: string } }
  }
  expect(manifest.dependencies ?? {}).not.toHaveProperty('@deepseek-ai/dsh-plugin-catalog')
  expect(manifest.dependencies ?? {}).not.toHaveProperty('@deepseek-ai/dsh-client-ui-plugin-catalog')
  expect(manifest.files).toEqual(expect.arrayContaining(['lib/index.js', 'lib/client.js', 'cordis.patch.yml']))
  expect(manifest.dsh?.client).toMatchObject({ platform: 'web' })
  expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-api-remotes')
  expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-plugin-manager')
  const patch = await readFile(new URL('cordis.patch.yml', packageDir), 'utf8')
  expect(patch.match(/^    - id:/gm)).toHaveLength(1)
})

it('contains the two built runtime entries without imports from the split catalog packages', async () => {
  const [host, client, declaration] = await Promise.all([
    readFile(new URL('lib/index.js', packageDir), 'utf8'),
    readFile(new URL('lib/client.js', packageDir), 'utf8'),
    readFile(new URL('lib/types/index.d.ts', packageDir), 'utf8'),
  ])
  expect(host).not.toMatch(/(?:from\s*|require\s*\()(['"])@deepseek-ai\/dsh-plugin-catalog(?:\/|\1)/u)
  expect(client).not.toMatch(/(?:from\s*|require\s*\()(['"])@deepseek-ai\/dsh-(?:plugin-catalog|client-ui-plugin-catalog)(?:\/|\1)/u)
  expect(declaration).not.toMatch(/@deepseek-ai\/dsh-(?:plugin-catalog|client-ui-plugin-catalog)/u)
  expect(client).toContain('id: "@deepseek-ai/dsh-community-plugin-catalog"')
})
