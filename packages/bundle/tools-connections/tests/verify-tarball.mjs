import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { boot, loadOverlayPatches } from '../../../boot/app-boot/lib/index.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const destination = await mkdtemp(join(tmpdir(), 'dsh-tools-connections-package-'))

function assertImportClosure(source, manifest) {
  const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])
  const imports = [...source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1])
  for (const specifier of imports) {
    if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
    const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    if (!declared.has(name)) throw new Error(`Runtime import ${name} is not declared in the packed manifest`)
  }
}

try {
  execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: packageRoot, stdio: 'pipe' })
  const archives = (await readdir(destination)).filter(file => file.endsWith('.tgz'))
  if (archives.length !== 1 || archives[0] === undefined) throw new Error(`Expected one packed archive; found ${archives.length}`)
  const archive = join(destination, archives[0])
  const entries = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n'))
  for (const entry of ['package/lib/index.js', 'package/lib/client.js', 'package/cordis.patch.yml', 'package/lib/types/index.d.ts']) {
    if (!entries.has(entry)) throw new Error(`Packed archive is missing ${entry}`)
  }
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
  const entryCode = execFileSync('tar', ['-xOf', archive, 'package/lib/index.js'], { encoding: 'utf8' })
  assertImportClosure(entryCode, manifest)

  const unpacked = join(destination, 'unpacked')
  await mkdir(unpacked)
  execFileSync('tar', ['-xzf', archive, '-C', unpacked])
  const packageDir = join(unpacked, 'package')
  const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-tools-connections-loader-'))
  const profileDir = join(runtimeHome, 'profile')
  await mkdir(join(packageDir, 'node_modules'), { recursive: true })
  const profilePackage = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-tools-connections')
  await mkdir(dirname(profilePackage), { recursive: true })
  await symlink(packageDir, profilePackage, 'dir')
  const runtimeDependencies = [...new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])].sort()
  for (const dependency of runtimeDependencies) {
    const installed = join(packageRoot, 'node_modules', dependency)
    const bundled = join(packageDir, 'node_modules', dependency)
    await mkdir(dirname(bundled), { recursive: true })
    await symlink(installed, bundled, 'dir')
    if (dependency === '@deepseek-ai/dsh-web') {
      const profileDependency = join(profileDir, 'node_modules', dependency)
      await mkdir(dirname(profileDependency), { recursive: true })
      await symlink(installed, profileDependency, 'dir')
    }
  }

  let apiRequest
  const apiServer = createServer(async (request, response) => {
    apiRequest = { method: request.method, path: request.url, token: request.headers['x-subscription-token'] }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ web: { results: [{ title: 'Smoke result', url: 'https://example.test', description: 'Local provider response' }] } }))
  })
  apiServer.listen(0, '127.0.0.1')
  await once(apiServer, 'listening')
  const address = apiServer.address()
  if (address === null || typeof address === 'string') throw new Error('Brave mock did not bind a TCP port')

  let context
  const registeredTools = []
  try {
    await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
    const overlayPath = join(profileDir, 'cordis.patch.yml')
    await writeFile(overlayPath, [
      '- insert:',
      "    - id: web\n      name: '@deepseek-ai/dsh-web'\n      config:\n        searchProvider: brave",
      '- id: tools-connections',
      '  config:',
      '    braveEnabled: true',
      '    braveApiKeyRef: BRAVE_SMOKE_KEY',
      `    braveBaseURL: 'http://127.0.0.1:${address.port}'`,
      '    maxResults: 3',
      '    firecrawlEnabled: true',
      '',
    ].join('\n'))
    const profileContext = {
      name: 'tools-connections-tarball-smoke', dir: profileDir, patchPath: overlayPath,
      installAnchor: join(repositoryRoot, 'package.json'), cwd: runtimeHome, home: runtimeHome,
      startedBundles: [manifest.name], overlays: [], telemetryDisabledEnv: undefined,
    }
    context = await boot('tools-connections-tarball-smoke', join(profileDir, 'cordis.yml'), [
      ...loadOverlayPatches('tools-connections-tarball-smoke', join(packageDir, 'cordis.patch.yml')),
      ...loadOverlayPatches('tools-connections-tarball-smoke', overlayPath),
    ], host => {
      host.provide('profileContext', profileContext)
      host.provide('credentials', { resolve: async ref => ref === 'BRAVE_SMOKE_KEY' ? { value: 'synthetic-brave-key', source: 'test' } : undefined })
      host.provide('tools', {
        register: (tool) => {
          registeredTools.push(tool.name)
          return () => { registeredTools.splice(registeredTools.indexOf(tool.name), 1) }
        },
      })
    })
    const row = context.loader.entries().find(entry => entry.options.id === 'tools-connections')
    if (row?.options.name !== manifest.name || row.fiber?.state !== 2) throw new Error('Packed Host bundle did not become active in the Loader')
    if (!registeredTools.includes('firecrawl_extract')) throw new Error('Packed Host bundle did not register its Firecrawl extraction tool')
    const result = await context.web.search({ query: 'loader smoke' })
    if (apiRequest?.method !== 'GET' || !apiRequest.path?.includes('q=loader+smoke')
      || apiRequest.token !== 'synthetic-brave-key' || result.sources[0]?.title !== 'Smoke result') {
      throw new Error('The packed bundle did not send the expected Brave request or map its response')
    }
    await row.fiber.dispose()
    if (registeredTools.includes('firecrawl_extract')) throw new Error('Disposing the bundle left the Firecrawl tool registered')
    await context.web.search({ query: 'after dispose' }).then(
      () => { throw new Error('Disposing the bundle left Brave registered') },
      error => { if (!String(error).includes('provider "brave" is not registered')) throw error },
    )
  } finally {
    await context?.fiber.dispose()
    if (apiServer.listening) {
      const closed = once(apiServer, 'close')
      apiServer.close()
      await closed
    }
    await rm(runtimeHome, { recursive: true, force: true })
  }
  process.stdout.write(`Verified ${archive}: both client and host artifacts are packed; the packed Host loaded through Cordis Loader, registered its Firecrawl tool, and served web.search through Brave.\n`)
} finally {
  await rm(destination, { recursive: true, force: true })
}
