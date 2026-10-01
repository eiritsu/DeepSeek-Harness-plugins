import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, initProfile, loadOverlayPatches, readProfileManifest } from '../../../boot/app-boot/lib/index.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const destination = await mkdtemp(join(tmpdir(), 'dsh-desktop-profile-migration-package-'))

try {
  const supplied = process.env.DSH_MIGRATION_TARBALL
  let archive
  if (supplied === undefined) {
    execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: packageRoot, stdio: 'pipe' })
    const archives = (await readdir(destination)).filter(file => file.endsWith('.tgz'))
    if (archives.length !== 1) throw new Error(`Expected one packed archive; found ${archives.length}`)
    archive = join(destination, archives[0])
  } else archive = resolve(supplied)

  const entries = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n'))
  for (const entry of [
    'package/lib/index.js', 'package/lib/client.js', 'package/lib/typert.host.js',
    'package/lib/typert.remote-client.js', 'package/cordis.patch.yml',
  ]) if (!entries.has(entry)) throw new Error(`Packed archive is missing ${entry}`)

  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
  const privatePackages = ['@deepseek-ai/dsh-desktop-profile-migration', '@deepseek-ai/dsh-client-ui-desktop-profile-migration']
  for (const name of privatePackages) {
    if (manifest.dependencies?.[name] || manifest.peerDependencies?.[name]) throw new Error(`Packed manifest retains private dependency ${name}`)
  }
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml' || manifest.dsh?.client?.platform !== 'web') {
    throw new Error('Packed manifest does not declare both optional profile faces')
  }

  const unpacked = join(destination, 'unpacked')
  await mkdir(unpacked)
  execFileSync('tar', ['-xzf', archive, '-C', unpacked])
  const packageDir = join(unpacked, 'package')
  const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-desktop-profile-migration-loader-'))
  try {
    const profileDir = join(runtimeHome, 'profile')
    const packageLink = join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-desktop-profile-migration-bundle')
    await mkdir(dirname(packageLink), { recursive: true })
    await symlink(packageDir, packageLink, 'dir')

    const packageModules = join(packageDir, 'node_modules', '@deepseek-ai')
    await mkdir(packageModules, { recursive: true })
    await symlink(join(packageRoot, 'node_modules', 'zod'), join(packageDir, 'node_modules', 'zod'), 'dir')
    for (const name of ['cordis', 'dsh-app-boot', 'dsh-atomic-write', 'dsh-typert-protocol', 'schemastery']) {
      const installed = join(packageRoot, 'node_modules', '@deepseek-ai', name)
      await symlink(installed, join(packageModules, name), 'dir')
    }

    const previous = ['base', 'web-app', '@deepseek-ai/dsh-experimental-desktop-app']
    initProfile(profileDir, previous)
    const manifestBefore = await readFile(join(profileDir, 'package.json'), 'utf8')
    await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
    const profileContext = {
      name: 'desktop', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'),
      installAnchor: join(repositoryRoot, 'package.json'), cwd: runtimeHome, home: runtimeHome,
      startedBundles: [manifest.name], overlays: [], telemetryDisabledEnv: undefined,
    }
    let context
    try {
      context = await boot('dsh-desktop-profile-migration-tarball', join(profileDir, 'cordis.yml'),
        loadOverlayPatches('dsh-desktop-profile-migration-tarball', join(packageDir, 'cordis.patch.yml')),
        host => host.provide('profileContext', profileContext))
      const row = context.loader.entries().find(entry => entry.options.id === 'desktop-profile-migration')
      if (row?.options.name !== manifest.name || row.fiber?.state !== 2) {
        throw new Error(`Migration bundle Loader row is not active: ${String(row?.fiber?.state)}`)
      }
      const migration = context.get('desktopProfileMigration')
      const state = await migration.read()
      if (!state.eligible || state.complete || JSON.stringify(state.selected) !== JSON.stringify(previous)) {
        throw new Error(`Migration did not preserve the existing profile selection: ${JSON.stringify(state)}`)
      }
      if (await readFile(join(profileDir, 'package.json'), 'utf8') !== manifestBefore) {
        throw new Error('Reading the migration offer changed the profile manifest')
      }
      if (state.candidates.length === 0) throw new Error('Migration did not offer unselected optional bundles')
    } finally {
      await context?.fiber.dispose()
    }
    if (readProfileManifest('dsh-migration-smoke', profileDir).dsh?.profile?.bundles?.join('\n') !== previous.join('\n')) {
      throw new Error('The profile selection changed during the read-only Loader smoke')
    }
  } finally {
    await rm(runtimeHome, { recursive: true, force: true })
  }
  process.stdout.write(`Verified ${archive}: self-contained Host/Client bundle; isolated Loader retained existing profile selections.\n`)
} finally {
  await rm(destination, { recursive: true, force: true })
}
