import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

const packageDir = new URL('../', import.meta.url)

it('ships the Host and dynamic Client as one Web bundle', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', packageDir), 'utf8')) as {
    dependencies?: Record<string, string>
    files?: string[]
    dsh?: { bundle?: { patch?: string }; client?: { inject?: string[]; platform?: string } }
  }
  expect(manifest.dependencies ?? {}).not.toHaveProperty('@deepseek-ai/dsh-skillhub-catalog')
  expect(manifest.dependencies ?? {}).not.toHaveProperty('@deepseek-ai/dsh-client-ui-skill-catalog')
  expect(manifest.files).toEqual(expect.arrayContaining(['lib/index.js', 'lib/client.js', 'cordis.patch.yml']))
  expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  expect(manifest.dsh?.client).toMatchObject({ platform: 'web' })
  expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-api-remotes')
  expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-plugin-manager')

  const patch = await readFile(new URL('cordis.patch.yml', packageDir), 'utf8')
  expect(patch).toContain("id: community-skill-catalog\n      name: '@deepseek-ai/dsh-community-skill-catalog'")
  expect(patch.match(/^    - id:/gm)).toHaveLength(1)
})

it('does not import either split feature package from the built entries or declaration', async () => {
  const [host, client, declaration] = await Promise.all([
    readFile(new URL('lib/index.js', packageDir), 'utf8'),
    readFile(new URL('lib/client.js', packageDir), 'utf8'),
    readFile(new URL('lib/types/index.d.ts', packageDir), 'utf8'),
  ])
  const splitPackages = /@deepseek-ai\/dsh-(?:skillhub-catalog|client-ui-skill-catalog)/u
  const imports = (code: string): string[] => [...code.matchAll(/(?:from\s+|require\()(['"])([^'"]+)\1/gu)].map(match => match[2]!)
  expect(imports(host)).not.toContain('@deepseek-ai/dsh-skillhub-catalog')
  expect(imports(client).some(specifier => splitPackages.test(specifier))).toBe(false)
  expect(declaration).not.toMatch(splitPackages)
  expect(client).toContain('id: "@deepseek-ai/dsh-community-skill-catalog"')
})
