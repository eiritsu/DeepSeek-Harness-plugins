import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '../../../boot/app-boot/lib/index.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
const packageManager = /^pnpm@(\d+\.\d+\.\d+)/.exec(rootManifest.packageManager ?? '')
if (!packageManager) throw new Error('Repository packageManager must pin the pnpm version used by the artifact smoke')
const pnpmCli = join(repositoryRoot, 'node_modules/.pnpm', `pnpm@${packageManager[1]}`, 'node_modules/pnpm/bin/pnpm.cjs')
const scratch = await mkdtemp(join(tmpdir(), 'dsh-session-message-edit-resend-artifact-'))
const packageOutput = join(scratch, 'package')
const unpacked = join(scratch, 'unpacked')
let context

if (!process.env.HOME || !process.env.DSH_HOME) {
  throw new Error('Artifact smoke requires isolated HOME and DSH_HOME environment variables')
}

try {
  await mkdir(packageOutput)
  await mkdir(unpacked)
  let archive = process.env.DSH_EDIT_RESEND_TARBALL === undefined
    ? undefined
    : resolve(process.env.DSH_EDIT_RESEND_TARBALL)
  if (archive === undefined) {
    execFileSync(process.execPath, [pnpmCli, 'pack', '--pack-destination', packageOutput], { cwd: packageRoot, stdio: 'pipe' })
    const archives = (await readdir(packageOutput)).filter(file => file.endsWith('.tgz'))
    if (archives.length !== 1) throw new Error(`Expected one packed archive; found ${archives.length}`)
    archive = join(packageOutput, archives[0])
  }
  const entries = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n'))
  for (const entry of [
    'package/lib/index.js', 'package/lib/client.js', 'package/lib/typert.host.js',
    'package/lib/typert.remote-client.js', 'package/cordis.patch.yml',
  ]) if (!entries.has(entry)) throw new Error(`Packed archive is missing ${entry}`)
  if ([...entries].some(entry => entry.startsWith('package/src/'))) {
    throw new Error('Packed archive includes source files instead of the built Host and Client entries')
  }

  execFileSync('tar', ['-xzf', archive, '-C', unpacked])
  const packageDir = join(unpacked, 'package')
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  if (manifest.dsh?.client?.inject?.includes('remote.messageEditResend')) {
    throw new Error('Packed Client manifest waits for its own Remote before apply can mount it')
  }
  const forbidden = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })
    .filter(name => name.includes('session-message-edit-resend') && name !== manifest.name)
  if (forbidden.length > 0) throw new Error(`Packed bundle depends on private runtime packages: ${forbidden.join(', ')}`)
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml' || manifest.dsh?.client?.platform !== 'web') {
    throw new Error('Packed manifest does not declare both optional profile faces')
  }
  for (const [name, value] of Object.entries(manifest.exports ?? {})) {
    const file = typeof value === 'string' ? value : value.default
    if (file && !existsSync(join(packageDir, file))) throw new Error(`Export ${name} points to missing artifact ${file}`)
    if (typeof value === 'object' && value.types && !existsSync(join(packageDir, value.types))) {
      throw new Error(`Export ${name} points to missing declarations ${value.types}`)
    }
  }

  const moduleNames = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  for (const name of moduleNames) {
    const workspaceSource = join(repositoryRoot, 'node_modules', name)
    const packageSource = join(packageRoot, 'node_modules', name)
    const source = existsSync(workspaceSource) ? workspaceSource : packageSource
    if (!existsSync(source)) throw new Error(`Workspace runtime dependency is unavailable: ${name}`)
    const target = join(packageDir, 'node_modules', name)
    await mkdir(dirname(target), { recursive: true })
    await symlink(source, target, 'dir')
  }

  const profileDir = join(scratch, 'profile')
  await mkdir(join(profileDir, 'node_modules', '@deepseek-ai'), { recursive: true })
  await symlink(packageDir, join(profileDir, 'node_modules', '@deepseek-ai', manifest.name.slice('@deepseek-ai/'.length)), 'dir')
  const configPath = join(profileDir, 'cordis.yml')
  await writeFile(configPath, '[]\n')
  const binName = 'dsh-session-message-edit-resend-artifact-smoke'
  const patch = loadOverlayPatches(binName, join(packageDir, 'cordis.patch.yml'))
  context = await boot(binName, configPath, patch, host => {
    host.provide('agents', { get: () => undefined })
    host.provide('sessionProjections', { register: () => () => undefined, stateOf: () => undefined })
  })
  const row = context.loader.entries().find(entry => entry.options.name === manifest.name)
  if (row?.fiber?.state !== 2 || context.get('messageEditResend') === undefined) {
    throw new Error(`Packed Host bundle did not activate: ${String(row?.fiber?.state)}`)
  }

  const remote = (await import(pathToFileURL(join(packageDir, 'lib/typert.remote-client.js')).href)).default
  if (remote.package !== manifest.name || !remote.descriptors.some(descriptor => descriptor.service === 'messageEditResend')) {
    throw new Error('Packed Typert Remote does not match the Host service package')
  }
  const previousWindow = globalThis.window
  const handoffs = []
  try {
    globalThis.window = { __ModuleLoader__: { load: handoff => handoffs.push(handoff) } }
    await import(pathToFileURL(join(packageDir, 'lib/client.js')).href)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
  if (handoffs.length !== 1 || handoffs[0].id !== manifest.name) {
    throw new Error(`Packed Client did not register the expected Loader entry: ${JSON.stringify(handoffs.map(item => item.id))}`)
  }
  process.stdout.write(`Verified ${archive}: isolated Cordis Host activation and Client Loader handoff.\n`)
} finally {
  await context?.fiber.dispose()
  await rm(scratch, { recursive: true, force: true })
}
