import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { connect, type AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { Duplex } from 'node:stream'
import * as tls from 'node:tls'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { parseSkillHubIdentity, SkillHubCatalog } from '../src/host/skillhub-catalog.ts'
import { testCa, testCert, testKey } from './tls-fixture.ts'

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup }))

let proxy: HttpServer | undefined
let origin: HttpsServer | undefined
let proxyUrl: string
let endpoint: string
let disposeProxy: (() => Promise<void>) | undefined
let originalCertificates: string[] | undefined
let connectTargets: string[]
let originPaths: string[]
const sockets = new Set<Duplex>()
let responseForPath: (path: string) => { status: number; body: unknown }
let heldArchive: { readonly path: string; readonly started: Deferred<void>; readonly closed: Deferred<void> } | undefined

interface Deferred<T> { readonly promise: Promise<T>; resolve(value: T): void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function own(socket: Duplex): void {
  sockets.add(socket)
  socket.once('close', () => sockets.delete(socket))
}

function listen(server: HttpServer | HttpsServer): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server.address() as AddressInfo)
    })
  })
}

function close(server: HttpServer | HttpsServer | undefined): Promise<void> {
  if (server === undefined || !server.listening) return Promise.resolve()
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function environment(noProxy?: string): { get(name: string): { value: string } | undefined } {
  return {
    get(name) {
      if (name === 'HTTPS_PROXY') return { value: proxyUrl }
      if (name === 'NO_PROXY' && noProxy !== undefined) return { value: noProxy }
      return undefined
    },
  }
}

async function installPolicy(noProxy?: string): Promise<void> {
  disposeProxy = await installProxyFromEnvironment(environment(noProxy), () => undefined)
}

async function installLiveProxy(proxyUrl: string): Promise<void> {
  vi.stubEnv('HTTPS_PROXY', proxyUrl)
  disposeProxy = await installProxyFromEnvironment({
    get: name => name === 'HTTPS_PROXY' ? { value: process.env.HTTPS_PROXY! } : undefined,
  }, () => undefined)
}

async function teardown(): Promise<void> {
  let failure: unknown
  const dispose = disposeProxy
  disposeProxy = undefined
  try { await dispose?.() }
  catch (error: unknown) { failure = error }
  for (const socket of sockets) socket.destroy()
  const closed = await Promise.allSettled([close(proxy), close(origin)])
  for (const result of closed) {
    if (result.status === 'rejected' && failure === undefined) failure = result.reason
  }
  proxy = undefined
  origin = undefined
  const certificates = originalCertificates
  originalCertificates = undefined
  try {
    if (certificates !== undefined) tls.setDefaultCACertificates(certificates)
  } catch (error: unknown) {
    failure ??= error
  } finally {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    sockets.clear()
  }
  if (failure !== undefined) throw failure
}

beforeEach(async () => {
  connectTargets = []
  originPaths = []
  responseForPath = () => ({ status: 200, body: { skills: [], total: 0 } })
  heldArchive = undefined
  sockets.clear()
  lookup.mockReset().mockResolvedValue([{ address: '198.18.1.24', family: 4 }])
  try {
    originalCertificates = tls.getCACertificates('default')
    tls.setDefaultCACertificates([...originalCertificates, testCa])

    origin = createHttpsServer({ key: testKey, cert: testCert }, (request, response) => {
      originPaths.push(request.url ?? '')
      if (heldArchive !== undefined && request.url === heldArchive.path) {
        response.writeHead(200, { 'content-type': 'application/zip' })
        response.write(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
        heldArchive.started.resolve(undefined)
        response.once('close', () => { heldArchive?.closed.resolve(undefined) })
        return
      }
      const result = responseForPath(request.url ?? '')
      if (result.body instanceof Uint8Array) {
        response.writeHead(result.status, { 'content-type': 'application/zip', 'content-length': String(result.body.byteLength) })
        response.end(result.body)
      } else {
        response.writeHead(result.status, { 'content-type': 'application/json' })
        response.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body))
      }
    })
    origin.on('connection', (socket) => { own(socket) })
    const originAddress = await listen(origin)

    proxy = createHttpServer()
    proxy.on('connection', (socket) => { own(socket) })
    proxy.on('connect', (request, client, head) => {
      own(client)
      connectTargets.push(request.url ?? '')
      const upstream = connect(originAddress.port, '127.0.0.1')
      own(upstream)
      client.on('error', () => upstream.destroy())
      upstream.on('error', () => {
        if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
      })
      upstream.once('connect', () => {
        if (client.destroyed) { upstream.destroy(); return }
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length > 0) upstream.write(head)
        upstream.pipe(client)
        client.pipe(upstream)
      })
    })
    const proxyAddress = await listen(proxy)
    proxyUrl = `http://127.0.0.1:${proxyAddress.port}`
    endpoint = 'https://api.skillhub.test'
  } catch (error: unknown) {
    try { await teardown() }
    catch (cleanupError: unknown) { throw new AggregateError([error, cleanupError], 'SkillHub egress fixture startup and cleanup both failed.') }
    throw error
  }
})

afterEach(teardown)

describe('SkillHub outbound routing', () => {
  it('parses a canonical namespace-qualified identity', () => {
    expect(parseSkillHubIdentity('@alice/demo')).toEqual({
      canonicalName: '@alice/demo', namespace: 'alice', skillSlug: 'demo',
    })
  })

  it('sends HTTPS through the installed proxy without resolving the origin locally', async () => {
    await installPolicy()

    const page = await new SkillHubCatalog(new Context(), { endpoint }).catalog()

    expect(page).toEqual({ items: [], total: 0 })
    expect(connectTargets).toEqual(['api.skillhub.test:443'])
    expect(originPaths).toEqual(['/api/skills?page=1&pageSize=24&sortBy=score&order=desc'])
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects a special-use fake-DNS answer when no proxy policy is installed', async () => {
    await expect(new SkillHubCatalog(new Context(), { endpoint }).catalog())
      .rejects.toThrow('did not resolve exclusively to public addresses')

    expect(lookup).toHaveBeenCalledOnce()
    expect(connectTargets).toEqual([])
    expect(originPaths).toEqual([])
  })

  it('keeps NO_PROXY direct and rejects the same special-use fake-DNS answer', async () => {
    await installPolicy('api.skillhub.test')

    await expect(new SkillHubCatalog(new Context(), { endpoint }).catalog())
      .rejects.toThrow('did not resolve exclusively to public addresses')

    expect(lookup).toHaveBeenCalledOnce()
    expect(connectTargets).toEqual([])
    expect(originPaths).toEqual([])
  })

  it('blocks a duplicate slug before requesting its slug-only detail or files', async () => {
    await installPolicy()
    const identityPath = '/api/skills?slug=dev-expert&page=1&pageSize=100&sortBy=score&order=desc'
    responseForPath = path => path === identityPath ? {
      status: 200,
      body: { total: 2, skills: [
        { namespace: { canonicalName: '@first/dev-expert' }, slug: 'dev-expert', name: 'First', version: '1.0' },
        { namespace: { canonicalName: '@second/dev-expert' }, slug: 'dev-expert', name: 'Second', version: '2.0' },
      ] },
    } : { status: 404, body: {} }

    const skillRoot = await mkdtemp(join(tmpdir(), 'skillhub-ambiguous-test-'))
    try {
      const service = new SkillHubCatalog(new Context(), { endpoint, skillRoot })
      await expect(service.detail('@second/dev-expert'))
        .rejects.toMatchObject({ code: 'skillhub/identity-ambiguous' })
      await expect(service.installSkill('@second/dev-expert', '1.17.0', true))
        .rejects.toMatchObject({ code: 'skillhub/identity-ambiguous' })

      expect(originPaths).toEqual([identityPath, identityPath])
    } finally { await rm(skillRoot, { recursive: true, force: true }) }
  })

  it('rejects a detail that declares a different canonical publisher', async () => {
    await installPolicy()
    const identityPath = '/api/skills?slug=sample-skill&page=1&pageSize=100&sortBy=score&order=desc'
    responseForPath = (path) => {
      if (path === identityPath) return {
        status: 200,
        body: { total: 1, skills: [{ namespace: { canonicalName: '@selected/sample-skill' }, slug: 'sample-skill', name: 'Sample', version: '1.0' }] },
      }
      if (path === '/api/v1/skills/sample-skill') return {
        status: 200,
        body: {
          skill: { namespace: { canonicalName: '@other/sample-skill' }, slug: 'sample-skill', displayName: 'Wrong publisher' },
          latestVersion: { version: '1.0' },
        },
      }
      return { status: 404, body: {} }
    }

    await expect(new SkillHubCatalog(new Context(), { endpoint }).detail('@selected/sample-skill'))
      .rejects.toMatchObject({ code: 'skillhub/identity-changed' })

    expect(originPaths).toEqual([identityPath, '/api/v1/skills/sample-skill'])
  })

  it('installs an exact-version ZIP with a file larger than 1 MiB under its canonical identity path', async () => {
    await installPolicy()
    const identityPath = '/api/skills?slug=sample-skill&page=1&pageSize=100&sortBy=score&order=desc'
    const listing = { total: 1, skills: [{ namespace: { canonicalName: '@selected/sample-skill' }, slug: 'sample-skill', name: 'Sample', version: '1.0' }] }
    const detail = { skill: { namespace: { canonicalName: '@selected/sample-skill' }, slug: 'sample-skill', displayName: 'Sample' }, latestVersion: { version: '1.0' } }
    const skill = new TextEncoder().encode('# Sample\n')
    const large = new Uint8Array(1024 * 1024 + 1).fill(65)
    const metadata = new TextEncoder().encode(JSON.stringify({ ownerId: '420620', publishedAt: 1785936194603, slug: 'sample-skill', version: '1.0' }))
    const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
    const archive = zipSync({ 'SKILL.md': skill, 'references/large.bin': large, '_meta.json': metadata })
    const files = [
      { path: 'SKILL.md', size: skill.byteLength, sha256: digest(skill) },
      { path: 'references/large.bin', size: large.byteLength, sha256: digest(large) },
    ]
    responseForPath = (path) => {
      if (path === identityPath) return { status: 200, body: listing }
      if (path === '/api/v1/skills/sample-skill') return { status: 200, body: detail }
      if (path === '/api/v1/skills/sample-skill/files?version=1.0') return {
        status: 200,
        body: { version: '1.0', files },
      }
      if (path === '/api/v1/download?slug=sample-skill&version=1.0') return { status: 200, body: archive }
      return { status: 404, body: {} }
    }

    const skillRoot = await mkdtemp(join(tmpdir(), 'skillhub-canonical-test-'))
    const ctx = new Context()
    try {
      const service = new SkillHubCatalog(ctx, { endpoint, skillRoot })
      await expect(service.installSkill('@selected/sample-skill', 'not a version', true)).rejects.toThrow('version is invalid')
      const result = await service.installSkill('@selected/sample-skill', '1.0', true)

      expect(result.canonicalName).toBe('@selected/sample-skill')
      expect(result.path).toBe(join(skillRoot, '%40selected%2Fsample-skill'))
      expect(result.files).toBe(2)
      expect(await readFile(join(result.path, 'references/large.bin'))).toEqual(Buffer.from(large))
      expect(originPaths).toContain('/api/v1/download?slug=sample-skill&version=1.0')
      expect(originPaths.some(path => path.includes('/api/v1/skills/sample-skill/file?'))).toBe(false)
      expect((await readdir(skillRoot)).sort()).toEqual(['%40selected%2Fsample-skill', '.skillhub'])
    } finally {
      await ctx.fiber.dispose()
      await rm(skillRoot, { recursive: true, force: true })
    }
  })

  it('waits for a streaming ZIP install to stop and clean staging when its Host fiber is disposed', async () => {
    await installPolicy()
    const identityPath = '/api/skills?slug=sample-skill&page=1&pageSize=100&sortBy=score&order=desc'
    const listing = { total: 1, skills: [{ namespace: { canonicalName: '@selected/sample-skill' }, slug: 'sample-skill', name: 'Sample', version: '1.0' }] }
    const detail = { skill: { namespace: { canonicalName: '@selected/sample-skill' }, slug: 'sample-skill', displayName: 'Sample' }, latestVersion: { version: '1.0' } }
    responseForPath = (path) => {
      if (path === identityPath) return { status: 200, body: listing }
      if (path === '/api/v1/skills/sample-skill') return { status: 200, body: detail }
      if (path === '/api/v1/skills/sample-skill/files?version=1.0') return {
        status: 200,
        body: { version: '1.0', files: [{ path: 'SKILL.md', size: 1, sha256: createHash('sha256').update('#').digest('hex') }] },
      }
      return { status: 404, body: {} }
    }
    const archivePath = '/api/v1/download?slug=sample-skill&version=1.0'
    const started: Deferred<void> = deferred()
    const closed: Deferred<void> = deferred()
    heldArchive = { path: archivePath, started, closed }
    const skillRoot = await mkdtemp(join(tmpdir(), 'skillhub-dispose-test-'))
    const ctx = new Context()
    try {
      const service = new SkillHubCatalog(ctx, { endpoint, skillRoot })
      const install = service.installSkill('@selected/sample-skill', '1.0', true)
      const rejected = expect(install).rejects.toThrow()
      await started.promise
      await ctx.fiber.dispose()
      await rejected
      await closed.promise
      expect(await readdir(join(skillRoot, '.skillhub'))).toEqual([])
      expect((await readdir(skillRoot)).sort()).toEqual(['.skillhub'])
    } finally {
      await ctx.fiber.dispose()
      heldArchive = undefined
      await rm(skillRoot, { recursive: true, force: true })
    }
  })

  it('preserves an existing skill after invalid ZIP, unsafe or unlisted paths, hash mismatch, and budget rejection', async () => {
    await installPolicy()
    const identityPath = '/api/skills?slug=sample-skill&page=1&pageSize=100&sortBy=score&order=desc'
    const listing = { total: 1, skills: [{ namespace: { canonicalName: '@selected/sample-skill' }, slug: 'sample-skill', name: 'Sample', version: '1.0' }] }
    const detail = { skill: { namespace: { canonicalName: '@selected/sample-skill' }, slug: 'sample-skill', displayName: 'Sample' }, latestVersion: { version: '1.0' } }
    const skill = new TextEncoder().encode('# replacement')
    const metadata = new TextEncoder().encode(JSON.stringify({ slug: 'sample-skill', version: '1.0' }))
    const release = { 'SKILL.md': skill, '_meta.json': metadata }
    let archive = new Uint8Array([0x50, 0x4b, 0x01])
    let hash = '0'.repeat(64)
    responseForPath = (path) => {
      if (path === identityPath) return { status: 200, body: listing }
      if (path === '/api/v1/skills/sample-skill') return { status: 200, body: detail }
      if (path === '/api/v1/skills/sample-skill/files?version=1.0') return {
        status: 200,
        body: { version: '1.0', files: [{ path: 'SKILL.md', size: skill.byteLength, sha256: hash }] },
      }
      if (path === '/api/v1/download?slug=sample-skill&version=1.0') return { status: 200, body: archive }
      return { status: 404, body: {} }
    }
    const skillRoot = await mkdtemp(join(tmpdir(), 'skillhub-invalid-archive-test-'))
    const target = join(skillRoot, '%40selected%2Fsample-skill')
    const ctx = new Context()
    try {
      await mkdir(target, { recursive: true })
      await writeFile(join(target, 'SKILL.md'), 'previous')
      const service = new SkillHubCatalog(ctx, { endpoint, skillRoot })
      await expect(service.installSkill('@selected/sample-skill', '1.0', true)).rejects.toThrow(/zip|central directory/iu)
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('previous')
      expect(await readdir(join(skillRoot, '.skillhub'))).toEqual([])

      archive = zipSync(release)
      await expect(service.installSkill('@selected/sample-skill', '1.0', true)).rejects.toThrow('integrity check failed')
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('previous')
      expect(await readdir(join(skillRoot, '.skillhub'))).toEqual([])

      hash = createHash('sha256').update(skill).digest('hex')
      const outsidePath = join(dirname(skillRoot), `${basename(skillRoot)}-outside.txt`)
      archive = zipSync({ 'SKILL.md': skill, '../outside.txt': new Uint8Array([1]) })
      await expect(service.installSkill('@selected/sample-skill', '1.0', true)).rejects.toThrow('../outside.txt')
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('previous')
      await expect(readFile(outsidePath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readdir(join(skillRoot, '.skillhub'))).toEqual([])

      archive = zipSync({ ...release, 'unlisted.txt': new Uint8Array([2]) })
      await expect(service.installSkill('@selected/sample-skill', '1.0', true)).rejects.toThrow('unlisted file')
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('previous')
      expect(await readdir(join(skillRoot, '.skillhub'))).toEqual([])

      const limitedCtx = new Context()
      try {
        const limited = new SkillHubCatalog(limitedCtx, { endpoint, skillRoot, maxArchiveBytes: 1 })
        await expect(limited.installSkill('@selected/sample-skill', '1.0', true)).rejects.toMatchObject({
          code: 'skillhub/install-limit', details: { budget: 'archive', limit: 1 },
        })
      } finally { await limitedCtx.fiber.dispose() }
      expect(await readFile(join(target, 'SKILL.md'), 'utf8')).toBe('previous')
      expect(await readdir(join(skillRoot, '.skillhub'))).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      await rm(skillRoot, { recursive: true, force: true })
    }
  })

  it.skipIf(process.env.DSH_SKILLHUB_PUBLIC_PROXY_TEST !== '1')('reads one public catalog page through the explicitly configured proxy', async () => {
    const configuredProxy = process.env.DSH_SKILLHUB_PUBLIC_PROXY_URL
    if (configuredProxy === undefined) throw new Error('Set DSH_SKILLHUB_PUBLIC_PROXY_URL to an explicitly selected proxy for this opt-in test.')
    const proxyAddress = new URL(configuredProxy)
    if (!['http:', 'https:'].includes(proxyAddress.protocol) || proxyAddress.username !== '' || proxyAddress.password !== '') {
      throw new Error('The opt-in test requires a credential-free HTTP(S) proxy URL.')
    }
    await installLiveProxy(configuredProxy)

    const page = await new SkillHubCatalog(new Context(), {}).catalog(undefined, undefined, undefined, undefined, 'score', 1, 1)

    expect(page.items.length).toBeLessThanOrEqual(1)
    expect(page.total).toBeGreaterThanOrEqual(page.items.length)
    expect(lookup).not.toHaveBeenCalled()
  })
})
