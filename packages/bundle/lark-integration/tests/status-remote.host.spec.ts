import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const root = resolve(packageDir, '../../..')
const artifact = (path: string): string => join(root, path)
const artifactUrl = (path: string): string => pathToFileURL(artifact(path)).href
const gatewayRequire = createRequire(join(root, 'packages/api/gateway/package.json'))
const appBootRequire = createRequire(join(root, 'packages/boot/app-boot/package.json'))
const requiredArtifacts = [
  'packages/bundle/lark-integration/lib/index.js',
  'packages/bundle/lark-integration/lib/typert.host.js',
  'packages/bundle/lark-integration/lib/typert.remote-client.js',
  'packages/client/connection/lib/index.js',
  'packages/client/connection/lib/client.js',
  'packages/api/gateway/lib/index.js',
  'packages/api/gateway/lib/client.js',
  'packages/api/remotes/lib/client.js',
  'packages/typert/registry/lib/index.js',
  'packages/typert/registry/lib/client.js',
  'packages/typert/loader/lib/index.js',
].every(path => existsSync(artifact(path)))

describe.skipIf(!requiredArtifacts)('Lark integration status Remote built chain', () => {
  it('loads the bundle-owned descriptor and streams the Host disabled state over HTTP and WebSocket', { timeout: 60_000 }, async () => {
    const urls = Object.fromEntries(Object.entries({
      bundle: 'packages/bundle/lark-integration/lib/index.js',
      bundleTypert: 'packages/bundle/lark-integration/lib/typert.host.js',
      bundleRemote: 'packages/bundle/lark-integration/lib/typert.remote-client.js',
      connectionHost: 'packages/client/connection/lib/index.js',
      connectionClient: 'packages/client/connection/lib/client.js',
      gatewayHost: 'packages/api/gateway/lib/index.js',
      gatewayClient: 'packages/api/gateway/lib/client.js',
      registryHost: 'packages/typert/registry/lib/index.js',
      registryClient: 'packages/typert/registry/lib/client.js',
      typertLoader: 'packages/typert/loader/lib/index.js',
      remotesClient: 'packages/api/remotes/lib/client.js',
    }).map(([key, path]) => [key, artifactUrl(path)]))
    Object.assign(urls, {
      ws: pathToFileURL(gatewayRequire.resolve('ws')).href,
      cordisLoader: pathToFileURL(appBootRequire.resolve('@deepseek-ai/cordis-plugin-loader')).href,
    })
    const script = `
      import { createServer } from 'node:http'
      import * as cordis from '@deepseek-ai/cordis'
      import * as zod from 'zod'

      const urls = ${JSON.stringify(urls)}
      const { default: NodeWebSocket } = await import(urls.ws)
      const { Context } = cordis
      const { default: TypertRegistry } = await import(urls.registryHost)
      const typertLoader = await import(urls.typertLoader)
      const connectionHost = await import(urls.connectionHost)
      const { default: TypertGateway } = await import(urls.gatewayHost)
      const { default: REMOTE } = await import(urls.bundleRemote)
      if (REMOTE.package !== '@deepseek-ai/dsh-lark-integration'
        || !['beginQuickConnect', 'completeQuickConnect', 'beginUserAuthorization', 'completeUserAuthorization', 'cancelSetupFlow']
          .every(method => REMOTE.descriptors.some(item => item.id === '@deepseek-ai/dsh-lark-integration#larkSetup/' + method))
        || !REMOTE.descriptors.some(item => item.id === '@deepseek-ai/dsh-lark-integration#larkStatus/watch')) {
        throw new Error('The Lark Client Remote must own its setup methods and larkStatus/watch')
      }

      const routes = []
      const upgrades = []
      const records = new Map()
      const values = new Map()
      const webServer = {
        port: 0,
        register(route) { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
        registerUpgrade(route) { upgrades.push(route); return () => { upgrades.splice(upgrades.indexOf(route), 1) } },
        tapIndex() { return () => {} },
      }
      const credentials = {
        readRecord(key) { return Promise.resolve(records.get(key)) },
        async modifyRecord(key, mutate) {
          const next = await mutate(records.get(key))
          if (next !== undefined) records.set(key, next)
          return next ?? records.get(key)
        },
        async resolve(ref) { const value = values.get(String(ref)); return value === undefined ? undefined : { value, source: 'test' } },
        async set(ref, value) { values.set(String(ref), value) },
        async unset(ref) { values.delete(String(ref)) },
      }
      const host = new Context()
      host.baseUrl = ${JSON.stringify(pathToFileURL(join(packageDir, 'package.json')).href)}
      host.provide('webServer', webServer)
      host.provide('credentials', credentials)
      host.provide('agentDefaultModel', { currentSelection() { return undefined } })
      host.provide('agents', {})
      host.provide('attachments', { imageLimits: { maxMessageImageBytes: 0 } })
      host.provide('sessionPersistence', {})
      host.provide('sessionQuery', {})
      host.provide('workspaceRegistry', {})
      host.provide('subprocess', {})
      host.provide('tools', { register() { return () => {} } })
      host.provide('configEditor', { configuration() { return [] }, async edit() {} })
      const { default: Loader } = await import(urls.cordisLoader)
      await host.plugin(Loader)
      await host.plugin(TypertRegistry)
      await host.plugin({ inject: connectionHost.inject, apply: connectionHost.apply })
      await host.plugin({ inject: typertLoader.inject, apply: typertLoader.apply }, {})
      await host.plugin(TypertGateway)
      const entryId = await host.loader.create({ name: '@deepseek-ai/dsh-lark-integration' })
      await host.loader.await()
      const lark = host.loader.resolve(entryId)
      if (lark.fiber?.state !== 2) throw new Error('Lark Host entry did not activate through Cordis Loader')
      if (host.larkStatus === undefined) throw new Error('bundle Host did not provide larkStatus')

      const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
        if (request.url?.startsWith('/?')) {
          if (host.connection.authorizeIndex(request, response)) {
            response.writeHead(200, { 'content-type': 'text/html' })
            response.end('<body>shell</body>')
          }
          return
        }
        const route = routes.find(candidate => candidate.path === pathname
          || (candidate.kind === 'prefix' && pathname.startsWith(candidate.path)))
        if (route === undefined) { response.writeHead(404); response.end(); return }
        void route.handler(request, response)
      })
      server.on('upgrade', (request, socket, head) => {
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
        const route = upgrades.find(candidate => candidate.path === pathname)
        if (route === undefined) { socket.destroy(); return }
        void route.handler(request, socket, head)
      })
      await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('HTTP server has no TCP address')
      const origin = 'http://127.0.0.1:' + String(address.port)
      const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
      const previousFetch = globalThis.fetch
      const previousWebSocket = globalThis.WebSocket
      try {
        globalThis.document = { baseURI: origin + '/' }
        const login = await fetch(host.connection.authenticatedUrl(origin), { redirect: 'manual' })
        const setCookie = login.headers.get('set-cookie')
        if (login.status !== 303 || setCookie === null) throw new Error('browser token exchange failed')
        const cookie = setCookie.split(';', 1)[0]
        globalThis.fetch = (input, init = {}) => {
          const headers = new Headers(init.headers)
          headers.set('cookie', cookie)
          return previousFetch(new URL(input, document.baseURI), { ...init, headers })
        }
        globalThis.WebSocket = class extends NodeWebSocket {
          constructor(url) { super(url, { headers: { cookie } }) }
        }
        const handoffs = new Map()
        globalThis.window = { __ModuleLoader__: { load(handoff) { handoffs.set(handoff.id, handoff) } } }
        globalThis.location = { hostname: '127.0.0.1', origin, search: '' }
        await import(urls.registryClient)
        await import(urls.connectionClient)
        await import(urls.gatewayClient)
        await import(urls.remotesClient)

        const instantiate = id => {
          const handoff = handoffs.get(id)
          if (handoff === undefined) throw new Error('missing Client bundle handoff ' + id)
          return handoff.factory(specifier => {
            if (specifier === '@deepseek-ai/cordis') return cordis
            if (specifier === 'zod') return zod
            throw new Error('unexpected Client external ' + specifier)
          })
        }
        const client = new Context()
        for (const id of [
          '@deepseek-ai/dsh-typert-registry', '@deepseek-ai/dsh-client-connection',
          '@deepseek-ai/dsh-api-gateway', '@deepseek-ai/dsh-api-remotes',
        ]) {
          const plugin = instantiate(id)
          await client.plugin({ inject: plugin.inject, apply: plugin.apply })
        }
        const disposeRemote = await client.remote.$mount(REMOTE)
        const stream = client.remote.$stream({
          name: 'lark-status-test',
          open: signal => client.remote.larkStatus.watch(signal),
          ended: () => new Error('Lark status stream ended'),
        })
        const frame = await Promise.race([
          stream[Symbol.asyncIterator]().next(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('status stream timed out')), 5000)),
        ])
        if (frame.done || frame.value.value?.state !== 'disabled') {
          throw new Error('expected initial disabled status, received ' + JSON.stringify(frame.value?.value))
        }
        if (host.typert.getPackage('@deepseek-ai/dsh-lark-integration', 'host') === undefined) {
          throw new Error('Typert Loader did not discover the Lark Host descriptors before stream delivery')
        }
        frame.value.accept()
        const cancelled = await client.remote.larkSetup.cancelSetupFlow()
        if (!cancelled.ok || cancelled.value.completed) {
          throw new Error('Lark setup cancellation Remote failed: ' + JSON.stringify(cancelled))
        }
        await stream.dispose()
        await disposeRemote()
        await client.fiber.dispose()
        console.log(JSON.stringify({ package: REMOTE.package, state: frame.value.value.state }))
      } finally {
        if (previousDocument === undefined) delete globalThis.document
        else Object.defineProperty(globalThis, 'document', previousDocument)
        globalThis.fetch = previousFetch
        if (previousWebSocket === undefined) delete globalThis.WebSocket
        else globalThis.WebSocket = previousWebSocket
        await new Promise((resolveClose, rejectClose) => server.close(error => {
          if (error === undefined) resolveClose()
          else rejectClose(error)
        }))
        await host.fiber.dispose()
      }
    `
    const result = await runPlainNode(script)
    expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
    expect(JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '{}')).toEqual({
      package: '@deepseek-ai/dsh-lark-integration', state: 'disabled',
    })
  })
})

function runPlainNode(script: string): Promise<{
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}> {
  return new Promise((resolveRun) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], {
      cwd: packageDir,
      encoding: 'utf8',
      timeout: 55_000,
    }, (error, stdout, stderr) => {
      resolveRun({
        exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
        stdout,
        stderr,
      })
    })
  })
}
