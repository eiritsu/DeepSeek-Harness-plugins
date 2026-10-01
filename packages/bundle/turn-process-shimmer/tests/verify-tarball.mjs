import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '../../../boot/app-boot/lib/index.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const destination = await mkdtemp(join(tmpdir(), 'dsh-shimmer-package-'))

function assertImportClosure(source, manifest) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  const imports = [...source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)].map(match => match[1])
  for (const specifier of imports) {
    if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
    const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    if (!declared.has(packageName)) throw new Error(`Runtime import ${packageName} is not declared in the packed manifest`)
  }
}

try {
  const suppliedArchive = process.env.DSH_SHIMMER_TARBALL
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
  for (const entry of ['package/lib/index.js', 'package/lib/client.js', 'package/cordis.patch.yml', 'package/lib/types/client/index.d.ts']) {
    if (!entries.has(entry)) throw new Error(`Packed archive is missing ${entry}`)
  }
  if ([...entries].some(entry => entry.includes('node_modules/@deepseek-ai/dsh-client-ui-turn-process-shimmer'))) {
    throw new Error('Packed archive contains a private feature dependency instead of its own Client artifact')
  }
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
  if (manifest.dependencies?.['@deepseek-ai/dsh-client-ui-turn-process-shimmer']
    || manifest.peerDependencies?.['@deepseek-ai/dsh-client-ui-turn-process-shimmer']
    || manifest.dsh?.client?.platform !== 'web') {
    throw new Error('Packed bundle still depends on the private Client package or lacks its own Client declaration')
  }
  const client = execFileSync('tar', ['-xOf', archive, 'package/lib/client.js'], { encoding: 'utf8' })
  const host = execFileSync('tar', ['-xOf', archive, 'package/lib/index.js'], { encoding: 'utf8' })
  assertImportClosure(`${host}\n${client}`, manifest)
  if (!client.includes('id: "@deepseek-ai/dsh-turn-process-shimmer"')) {
    throw new Error('Packed Client artifact does not identify the independent bundle package')
  }
  const patch = execFileSync('tar', ['-xOf', archive, 'package/cordis.patch.yml'], { encoding: 'utf8' })
  if (!patch.includes("name: '@deepseek-ai/dsh-turn-process-shimmer'")) throw new Error('Packed patch does not target its own package')

  const unpacked = join(destination, 'unpacked')
  await mkdir(unpacked)
  execFileSync('tar', ['-xzf', archive, '-C', unpacked])
  const packageDir = join(unpacked, 'package')
  const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-shimmer-tarball-loader-'))
  try {
    const profileDir = join(runtimeHome, 'profile')
    const packageLink = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-turn-process-shimmer')
    await mkdir(dirname(packageLink), { recursive: true })
    await symlink(packageDir, packageLink, 'dir')
    await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
    const profileContext = {
      name: 'shimmer-tarball-smoke', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'),
      installAnchor: join(repositoryRoot, 'package.json'), cwd: runtimeHome, home: runtimeHome,
      startedBundles: [manifest.name], overlays: [], telemetryDisabledEnv: undefined,
    }
    let context
    try {
      context = await boot('dsh-shimmer-tarball-smoke', join(profileDir, 'cordis.yml'),
        loadOverlayPatches('dsh-shimmer-tarball-smoke', join(packageDir, 'cordis.patch.yml')),
        host => { host.provide('profileContext', profileContext) })
      const entry = context.loader.entries().find(row => row.options.id === 'ui-turn-process-shimmer')
      if (entry?.options.name !== manifest.name || entry.fiber?.state !== 2) {
        throw new Error(`Tarball Loader row is not active: ${String(entry?.fiber?.state)}`)
      }
    } finally {
      await context?.fiber.dispose()
    }
  } finally {
    await rm(runtimeHome, { recursive: true, force: true })
  }
  process.stdout.write(`Verified ${archive} contains its own Host and Client artifacts and an active Loader entry.\n`)
} finally {
  await rm(destination, { recursive: true, force: true })
}
