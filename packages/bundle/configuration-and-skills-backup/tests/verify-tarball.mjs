import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '../../../boot/app-boot/lib/index.js'
import { HostConnectionService } from '../../../client/connection/lib/index.js'
import { bridge } from '../../../client/connection/lib/types/http-bridge.js'
import WebServer from '../../../host/webserver/lib/index.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const destination = await mkdtemp(join(tmpdir(), 'dsh-backup-package-'))

try {
  execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: packageRoot, stdio: 'pipe' })
  const archive = join(destination, (await readdir(destination)).find(file => file.endsWith('.tgz')))
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
  const packedPatch = execFileSync('tar', ['-xOf', archive, 'package/cordis.patch.yml'], { encoding: 'utf8' })
  if (manifest.exports?.['./client']?.default !== './lib/client.js'
    || !packedPatch.includes("name: '@deepseek-ai/dsh-configuration-and-skills-backup'")) {
    throw new Error('Packed backup exports or its official profile patch are incomplete.')
  }
  const unpacked = join(destination, 'unpacked')
  await mkdir(unpacked)
  execFileSync('tar', ['-xzf', archive, '-C', unpacked])
  const packageDir = join(unpacked, 'package')
  const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-backup-loader-'))
  try {
    const profileDir = join(runtimeHome, 'profile')
    const packageModules = join(packageDir, 'node_modules', '@deepseek-ai')
    const links = join(profileDir, 'node_modules', '@deepseek-ai')
    await mkdir(packageModules, { recursive: true })
    await mkdir(links, { recursive: true })
    await symlink(packageDir, join(links, 'dsh-configuration-and-skills-backup'), 'dir')
    const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
    const runtimePackages = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])
    for (const name of runtimePackages) {
      const scopedName = name.slice('@deepseek-ai/'.length)
      await symlink(join(packageRoot, 'node_modules/@deepseek-ai', scopedName), join(packageModules, scopedName), 'dir')
    }
    await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-configuration-and-skills-backup'] } },
    }))
    const patchPath = join(profileDir, 'cordis.patch.yml')
    await writeFile(patchPath, `- insert:\n    - id: configuration-and-skills-backup\n      name: '${join(packageDir, 'lib/index.js')}'\n`)
    const profileContext = {
      name: 'backup-tarball-smoke', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'),
      installAnchor: join(repositoryRoot, 'package.json'), cwd: runtimeHome, home: runtimeHome,
      startedBundles: ['@deepseek-ai/dsh-configuration-and-skills-backup'], overlays: [], telemetryDisabledEnv: undefined,
    }
    let context
    try {
      context = await boot('dsh-backup-tarball-smoke', join(profileDir, 'cordis.yml'),
        loadOverlayPatches('dsh-backup-tarball-smoke', patchPath),
        async host => {
          host.logger.exporter({ levels: { default: 4 }, export: ({ type, args }) => {
            if (type === 'error') process.stderr.write(`Loader import diagnostic: ${args.map(String).join(' ')}\n`)
          } })
          host.provide('profileContext', profileContext)
          host.provide('configEditor', { configuration: () => [] })
          host.provide('pluginManager', { listBundles: async () => [] })
          await host.plugin(WebServer, { host: '127.0.0.1', port: 0 })
          await host.plugin(owner => { new HostConnectionService(owner, [], {}) })
        })
      const row = context.loader.entries().find(entry => entry.options.id === 'configuration-and-skills-backup')
      if (row?.fiber?.state !== 2 || !row.options.name.endsWith('/lib/index.js')) {
        throw new Error(`Packed backup Loader entry is not active: id=${String(row?.options.id)} name=${String(row?.options.name)} state=${String(row?.fiber?.state)}`)
      }
      const connection = context.get('connection')
      const handler = connection.createSharedFetchHandler('/api')
      context.webServer.register({ kind: 'prefix', path: '/api', handler: (req, res) => bridge(req, res, handler) })
      const roots = await get(context.webServer.port, '/api/configuration-skills.backup?action=roots')
      if (roots.status !== 200 || JSON.stringify(JSON.parse(roots.body)) !== JSON.stringify({ roots: [] })) {
        throw new Error(`Packed roots route failed: ${roots.status} ${roots.body}`)
      }
      const exported = await get(context.webServer.port, '/api/configuration-skills.backup?action=export')
      const document = JSON.parse(exported.body)
      if (exported.status !== 200 || document.format !== 'dsh-configuration-and-skills-backup' || document.configs.length !== 0) {
        throw new Error(`Packed export route failed: ${exported.status} ${exported.body}`)
      }
    } finally {
      await context?.fiber.dispose()
    }
  } finally {
    await rm(runtimeHome, { recursive: true, force: true })
  }
  process.stdout.write(`Verified ${archive}: packed Host Loader active; node:http roots and export routes passed.\n`)
} finally {
  await rm(destination, { recursive: true, force: true })
}

function get(port, path) {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolvePromise({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end()
  })
}
