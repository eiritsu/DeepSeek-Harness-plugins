import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pnpmInvocation } from '../../../../scripts/pnpm-invocation.ts'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = resolve(packageRoot, '../../..')
const built = ['lib/index.js', 'lib/client.js'].every(path => existsSync(join(packageRoot, path)))
const packedArtifactRequested = process.env.DSH_LARK_PACKED_ARTIFACT === '1'

if (packedArtifactRequested && !built) {
  throw new Error('Lark packed-artifact test requires built Host and Client lib entries')
}

/** Resolve one manifest export target against the files the archive actually contains.
 *
 * A target containing `*` names a set of files rather than one entry, so it is satisfied when at
 * least one packed entry fills it; `*` does not cross a directory separator. Every other target is
 * a single path that must exist, which keeps a renamed, moved, or dropped export failing.
 * @param entries - every path in the packed archive, each prefixed with `package/`.
 * @param target - the export target exactly as the manifest writes it.
 * @returns whether the package ships the files that target names.
 */
function exportTargetPresent(entries: ReadonlySet<string>, target: string): boolean {
  const path = `package/${target.replace(/^\.\//, '')}`
  if (!path.includes('*')) return entries.has(path)
  const pattern = new RegExp(`^${path.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`)
  for (const entry of entries) {
    if (pattern.test(entry)) return true
  }
  return false
}

describe.skipIf(!packedArtifactRequested)('Lark integration packed runtime', () => {
  it('loads the Host and Client entries from the packed bundle without custom runtime packages', { timeout: 60_000 }, () => {
    const destination = mkdtempSync(join(tmpdir(), 'dsh-lark-integration-pack-'))
    try {
      const invocation = pnpmInvocation(['pack', '--pack-destination', destination])
      execFileSync(invocation.command, invocation.args, { cwd: packageRoot, stdio: 'pipe', timeout: 30_000 })
      const archives = readdirSync(destination).filter(name => name.endsWith('.tgz'))
      expect(archives).toHaveLength(1)
      const archive = join(destination, archives[0]!)
      const entries = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n'))
      for (const entry of [
        'package/lib/index.js', 'package/lib/client.js', 'package/cordis.patch.yml',
        'package/lib/types/index.d.ts', 'package/lib/types/types.d.ts', 'package/lib/types/types.js',
        'package/lib/typert.host.js', 'package/lib/typert.host.d.ts',
        'package/lib/typert.remote-client.js', 'package/lib/typert.remote-client.d.ts',
        'package/vendor/larksuite-cli/checksums.txt', 'package/vendor/larksuite-cli/scripts/run.cjs',
        'package/vendor/larksuite-cli/scripts/install.cjs',
      ]) {
        expect(entries.has(entry), `missing ${entry}`).toBe(true)
      }

      const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' })) as {
        readonly exports?: Record<string, string | { readonly types?: string; readonly default?: string }>
        readonly dsh?: { readonly client?: {
          readonly platform?: string
          readonly inject?: readonly string[]
          readonly external?: readonly string[]
        } }
        readonly dependencies?: Record<string, string>
        readonly peerDependencies?: Record<string, string>
      }
      const exports = manifest.exports ?? {}
      expect(exports['.']).toEqual({ types: './lib/types/index.d.ts', default: './lib/index.js' })
      expect(manifest.exports?.['./client']).toBe('./lib/client.js')
      expect(exports['./types']).toEqual({ types: './lib/types/types.d.ts', default: './lib/types/types.js' })
      expect(exports['./typert']).toEqual({ types: './lib/typert.host.d.ts', default: './lib/typert.host.js' })
      expect(exports['./remote']).toEqual({ types: './lib/typert.remote-client.d.ts', default: './lib/typert.remote-client.js' })
      for (const value of Object.values(exports)) {
        const targets = typeof value === 'string' ? [value] : Object.values(value)
        for (const target of targets) {
          expect(exportTargetPresent(entries, target), `missing export target ${target}`).toBe(true)
        }
      }
      expect(manifest.dsh?.client?.platform).toBe('web')
      const runtimeDependencies = { ...manifest.dependencies, ...manifest.peerDependencies }
      expect(Object.keys(runtimeDependencies)).not.toContain('@deepseek-ai/dsh-lark-integration')
      expect(Object.keys(runtimeDependencies)).not.toContain('@deepseek-ai/dsh-client-ui-lark')
      expect(Object.values(runtimeDependencies).every(version => !version.startsWith('workspace:'))).toBe(true)

      const consumer = join(destination, 'consumer')
      const packageDirectory = join(consumer, 'package')
      mkdirSync(consumer)
      execFileSync('tar', ['-xzf', archive, '-C', consumer], { stdio: 'pipe' })
      symlinkSync(join(repositoryRoot, 'node_modules'), join(consumer, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
      symlinkSync(join(packageRoot, 'node_modules'), join(packageDirectory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
      const script = `
        const host = await import('./package/lib/index.js')
        if (host.name !== 'lark' || typeof host.apply !== 'function' || !host.inject.includes('subprocess')
          || !host.inject.includes('tools')) {
          throw new Error('packed Host plugin entry is incomplete')
        }
        const clientEntries = new Map()
        globalThis.window = { __ModuleLoader__: { load(value) { clientEntries.set(value.id, value) } } }
        const { createRequire } = await import('node:module')
        const { pathToFileURL } = await import('node:url')
        const hostRequire = createRequire(new URL('./package/package.json', import.meta.url))
        const cordis = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href)
        const gatewayClientPath = hostRequire.resolve('@deepseek-ai/dsh-api-gateway/client')
        await import(pathToFileURL(gatewayClientPath).href)
        const gatewayEntry = clientEntries.get('@deepseek-ai/dsh-api-gateway')
        if (typeof gatewayEntry?.factory !== 'function') {
          throw new Error('official gateway Client bundle did not register its module-table entry')
        }
        const gatewayClient = gatewayEntry.factory(specifier => {
          if (specifier === '@deepseek-ai/cordis') return cordis
          throw new Error('official gateway Client requested unexpected external ' + specifier)
        })
        if (typeof gatewayClient.RemoteStreamCarrierError !== 'function') {
          throw new Error('official gateway Client bundle does not export RemoteStreamCarrierError')
        }
        await import('./package/lib/client.js')
        const larkClientEntry = clientEntries.get('@deepseek-ai/dsh-lark-integration')
        if (typeof larkClientEntry?.factory !== 'function') {
          throw new Error('packed Client entry did not register with ModuleLoader')
        }
        const platformModules = new Set([
          'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
          '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
          '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
        ])
        const clientExternal = new Set([
          ...platformModules,
          ...(${JSON.stringify(manifest.dsh?.client?.inject ?? [])}),
          ...(${JSON.stringify(manifest.dsh?.client?.external ?? [])}),
        ])
        // Factory evaluation must not request anything outside the real loader table.
        const client = larkClientEntry.factory(specifier => {
          if (!clientExternal.has(specifier)) throw new Error('Client requested undeclared module-table external ' + specifier)
          if (specifier === '@deepseek-ai/dsh-api-gateway/client') return gatewayClient
          return {}
        })
        if (typeof client.apply !== 'function') throw new Error('packed Client factory did not return apply')
        const { TYPERT } = await import('./package/lib/typert.host.js')
        const { default: REMOTE } = await import('./package/lib/typert.remote-client.js')
        if (TYPERT.package !== '@deepseek-ai/dsh-lark-integration' || REMOTE.package !== TYPERT.package) {
          throw new Error('packed Host and Client Remote descriptors use different package identities')
        }
        const appBootRequire = createRequire(${JSON.stringify(join(repositoryRoot, 'packages/boot/app-boot/package.json'))})
        const { Context } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/cordis')).href)
        const { default: TypertRegistry } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-typert-registry')).href)
        const baseBundleRequire = createRequire(${JSON.stringify(join(repositoryRoot, 'packages/bundle/base/package.json'))})
        const typertLoader = await import(pathToFileURL(baseBundleRequire.resolve('@deepseek-ai/dsh-typert-loader')).href)
        const { default: Loader } = await import(pathToFileURL(appBootRequire.resolve('@deepseek-ai/cordis-plugin-loader')).href)
        const ctx = new Context()
        ctx.baseUrl = new URL('./package/', import.meta.url).href
        await ctx.plugin(TypertRegistry)
        await ctx.plugin(Loader)
        for (const [name, service] of Object.entries({
          agentDefaultModel: {}, agents: {}, attachments: {},
          credentials: { async resolve() { return undefined } },
          configEditor: { configuration() { return [] }, async edit() {} },
          sessionPersistence: {}, sessionQuery: {}, workspaceRegistry: {}, subprocess: {},
          tools: { register() { throw new Error('disabled Lark CLI must not register a tool') } },
        })) ctx.provide(name, service)
        const entryId = await ctx.loader.create({ name: '@deepseek-ai/dsh-lark-integration', config: {} })
        await ctx.loader.await()
        await ctx.plugin({ inject: typertLoader.inject, apply: typertLoader.apply }, {})
        const entry = ctx.loader.resolve(entryId)
        if (!entry.fiber || entry.fiber.state !== 2) {
          throw new Error('packed Host plugin did not activate from its default Cordis config')
        }
        if (entry.fiber.config.enabled?.get() !== false || entry.fiber.config.cliEnabled?.get() !== false) {
          throw new Error('packed Host schema defaults must keep Lark and its CLI disabled')
        }
        if (ctx.typert.getPackage('@deepseek-ai/dsh-lark-integration', 'host') === undefined
          || ctx.typert.local.get('larkStatus/watch') === undefined) {
          throw new Error('packed Host bundle did not register the existing Lark status contribution')
        }
        await entry.update({ disabled: true })
        await ctx.loader.await()
        if (ctx.typert.getPackage('@deepseek-ai/dsh-lark-integration', 'host') !== undefined) {
          throw new Error('packed Host bundle left the Lark status contribution registered after disable')
        }
        await entry.update({ disabled: false })
        await ctx.loader.await()
        if (ctx.typert.getPackage('@deepseek-ai/dsh-lark-integration', 'host') === undefined) {
          throw new Error('packed Host bundle did not re-register the Lark status contribution after re-enable')
        }
        await ctx.fiber.dispose()
        console.log('packed Host and Client entries loaded')
      `
      const bootstrap = join(consumer, 'bootstrap.mjs')
      writeFileSync(bootstrap, script)
      const output = execFileSync(process.execPath, [bootstrap], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      })
      expect(output.trim()).toBe('packed Host and Client entries loaded')
      expect(existsSync(join(packageDirectory, 'vendor/larksuite-cli/checksums.txt'))).toBe(true)
    } finally {
      rmSync(destination, { recursive: true, force: true })
    }
  })
})
