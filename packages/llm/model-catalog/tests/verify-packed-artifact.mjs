import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRuntimeResolution } from '../../../boot/app-boot/src/profile.ts'
import { installRuntimeInterception } from '../../../boot/app-boot/src/profile-resolution/resolver.ts'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = resolve(packageDir, '../../..')
const tempDir = mkdtempSync(join(tmpdir(), 'dsh-model-catalog-packed-'))
let interception

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

try {
  execFileSync('pnpm', ['pack', '--pack-destination', tempDir], { cwd: packageDir, stdio: 'inherit' })
  const archive = join(tempDir, readdirSync(tempDir).find(name => name.endsWith('.tgz')))
  execFileSync('tar', ['-xzf', archive, '-C', tempDir])
  const packedDir = join(tempDir, 'package')
  const packedManifest = JSON.parse(readFileSync(join(packedDir, 'package.json'), 'utf8'))
  assert.ok(packedManifest.peerDependencies['@deepseek-ai/dsh-storage-domain'])
  assert.equal(packedManifest.dependencies['@deepseek-ai/dsh-storage-domain'], undefined)

  const home = join(tempDir, 'home')
  const profileDir = join(home, 'profiles', 'packed-smoke')
  const profilePluginDir = join(profileDir, 'node_modules', '@deepseek-ai')
  mkdirSync(profilePluginDir, { recursive: true })
  symlinkSync(packedDir, join(profilePluginDir, 'dsh-model-catalog'), 'dir')
  writeJson(join(profileDir, 'package.json'), {
    name: 'dsh-profile-packed-smoke',
    private: true,
    dependencies: { '@deepseek-ai/dsh-model-catalog': packedManifest.version },
  })

  const packedNodeModules = join(packedDir, 'node_modules')
  const packedScopedModules = join(packedNodeModules, '@deepseek-ai')
  mkdirSync(packedScopedModules, { recursive: true })
  for (const [source, target] of [
    [join(packageDir, 'node_modules', '@deepseek-ai', 'schemastery'), join(packedScopedModules, 'schemastery')],
    [join(packageDir, 'node_modules', 'zod'), join(packedNodeModules, 'zod')],
  ]) {
    symlinkSync(source, target, 'dir')
  }
  const nativeImport = spawnSync(process.execPath, [
    '--input-type=module', '-e', `import(${JSON.stringify(pathToFileURL(join(packedDir, 'lib', 'index.js')).href)})`,
  ], { cwd: tempDir, encoding: 'utf8' })
  assert.notEqual(nativeImport.status, 0, 'raw Node import must not resolve profile-only peers')
  assert.match(nativeImport.stderr, /ERR_MODULE_NOT_FOUND/u)
  assert.match(nativeImport.stderr, /@deepseek-ai\/dsh-storage-domain/u)

  const baseDir = join(repoDir, 'packages', 'bundle', 'base')
  const installDir = join(tempDir, 'installation', 'node_modules', '@deepseek-ai', 'dsh')
  writeJson(join(installDir, 'package.json'), {
    name: '@deepseek-ai/dsh',
    version: '0.1.7-rc.2',
    type: 'module',
    dependencies: {},
  })
  const profile = {
    name: 'packed-smoke',
    dir: profileDir,
    skippedBundles: [],
    layers: [{
      packageName: '@deepseek-ai/dsh-base',
      packageDir: baseDir,
      patchPath: join(baseDir, 'cordis.patch.yml'),
      patches: [],
    }],
    patchPath: join(profileDir, 'cordis.patch.yml'),
    patches: [],
  }
  const resolution = await createRuntimeResolution({
    installAnchor: join(installDir, 'package.json'),
    profile,
    home,
  })
  const domainEntry = resolution.entries.find(entry => entry.name === '@deepseek-ai/dsh-storage-domain')
  assert.ok(domainEntry, 'dsh-base runtime dependency graph must supply dsh-storage-domain')
  interception = installRuntimeInterception(resolution)

  const profileEntry = join(profileDir, 'entry.mjs')
  writeFileSync(profileEntry, "import * as plugin from '@deepseek-ai/dsh-model-catalog'\nexport { plugin }\n")
  const entryUrl = pathToFileURL(profileEntry).href
  const { plugin } = await import(entryUrl)
  assert.equal(plugin.name, 'model-catalog')
  assert.equal(typeof plugin.apply, 'function')
  const catalogDir = interception.packageDir('@deepseek-ai/dsh-model-catalog', entryUrl)
  assert.equal(realpathSync.native(catalogDir), realpathSync.native(packedDir))
  assert.equal(
    interception.packageDir('@deepseek-ai/dsh-storage-domain', pathToFileURL(join(catalogDir, 'lib', 'index.js')).href),
    domainEntry.packageDir,
  )
  console.log('Packed model-catalog imports through the profile resolver and shares the installation storage-domain.')
} finally {
  interception?.dispose()
  rmSync(tempDir, { recursive: true, force: true })
}
