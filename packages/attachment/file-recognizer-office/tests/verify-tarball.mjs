import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '../../../boot/app-boot/lib/index.js'
import { HostConnectionService } from '../../../client/connection/lib/index.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const destination = await mkdtemp(join(tmpdir(), 'dsh-office-package-'))

try {
  const suppliedArchive = process.env.DSH_OFFICE_TARBALL
  let archive
  if (suppliedArchive === undefined) {
    execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: packageRoot, stdio: 'pipe' })
    const archives = (await readdir(destination)).filter(file => file.endsWith('.tgz'))
    if (archives.length !== 1) throw new Error(`Expected one packed archive; found ${archives.length}`)
    const archiveName = archives[0]
    if (archiveName === undefined) throw new Error('Packed archive disappeared before inspection')
    archive = join(destination, archiveName)
  } else {
    archive = resolve(suppliedArchive)
  }
  const entries = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n'))
  for (const entry of [
    'package/lib/index.js',
    'package/lib/client.js',
    'package/cordis.patch.yml',
    'package/lib/types/index.d.ts',
    'package/lib/types/client/index.d.ts',
  ]) {
    if (!entries.has(entry)) throw new Error(`Packed archive is missing ${entry}`)
  }

  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
  if (manifest.exports?.['./client']?.default !== './lib/client.js' || manifest.dsh?.client?.platform !== 'web') {
    throw new Error('Packed package does not expose its Web Client entry')
  }
  const injectList = manifest.dsh?.client?.inject ?? []
  if (!injectList.includes('@deepseek-ai/dsh-client-ui-plugin-manager')) {
    throw new Error('Packed Client inject list does not declare ui-plugin-manager; the bundle detail page will not load.')
  }
  if (manifest.dependencies?.['@deepseek-ai/dsh-client-ui-settings-file-recognizer-office']) {
    throw new Error('Packed Host package depends on the unpublished Settings package')
  }
  const patch = execFileSync('tar', ['-xOf', archive, 'package/cordis.patch.yml'], { encoding: 'utf8' })
  if (!patch.includes("name: '@deepseek-ai/dsh-file-recognizer-office'") || patch.includes('ui-settings-file-recognizer-office')) {
    throw new Error('Packed patch does not resolve both faces through the single package')
  }

  const unpacked = join(destination, 'unpacked')
  await mkdir(unpacked)
  execFileSync('tar', ['-xzf', archive, '-C', unpacked])
  const packageDir = join(unpacked, 'package')
  await symlink(join(packageRoot, 'node_modules'), join(packageDir, 'node_modules'), 'dir')
  const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-office-tarball-loader-'))
  try {
    const profileDir = join(runtimeHome, 'profile')
    const packageLink = join(profileDir, 'node_modules', '@deepseek-ai', manifest.name.split('/')[1])
    await mkdir(dirname(packageLink), { recursive: true })
    await symlink(packageDir, packageLink, 'dir')
    await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
    const profileContext = {
      name: 'tarball-smoke', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'),
      installAnchor: join(repositoryRoot, 'package.json'), cwd: runtimeHome, home: runtimeHome,
      startedBundles: [manifest.name], overlays: [], telemetryDisabledEnv: undefined,
    }
    let context
    try {
      context = await boot('dsh-office-tarball-smoke', join(profileDir, 'cordis.yml'),
        loadOverlayPatches('dsh-office-tarball-smoke', join(packageDir, 'cordis.patch.yml')),
        host => {
          new HostConnectionService(host, [], {})
          host.provide('profileContext', profileContext)
          host.provide('attachments', { readFileStream: async function* () {} })
        })
      const entry = context.loader.entries().find(row => row.options.id === 'file-recognizer-office')
      if (entry?.options.name !== manifest.name || entry.fiber?.state !== 2) {
        throw new Error(`Tarball Loader row is not active: ${String(entry?.fiber?.state)}`)
      }
    } finally {
      await context?.fiber.dispose()
    }
  } finally {
    await rm(runtimeHome, { recursive: true, force: true })
  }
  process.stdout.write(`Verified ${archive} contains Host, Client, declarations, patch, and an active Loader entry.\n`)
} finally {
  await rm(destination, { recursive: true, force: true })
}
