import { execFileSync } from 'node:child_process'
import { createServer, request } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { Config as StorageDomainConfig, apply as applyStorageDomain } from '@deepseek-ai/dsh-storage-domain'
import { Config as StorageJsonConfig, apply as applyStorageJson } from '@deepseek-ai/dsh-storage-json'
import { boot, loadOverlayPatches } from '../../../boot/app-boot/lib/index.js'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { strToU8, zipSync } from 'fflate'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const workspaceModules = join(packageRoot, 'node_modules')
const destination = await mkdtemp(join(tmpdir(), 'dsh-session-archive-pack-'))
const { bridge } = await import(pathToFileURL(join(repositoryRoot, 'packages/client/connection/lib/types/http-bridge.js')).href)
const sessionArchivePath = '/api/session.archive'
const sqliteListPath = '/api/session.archive/sqlite-backups'
const sqliteImportPath = '/api/session.archive/sqlite-import'

function assertImportClosure(source, manifest) {
  const declared = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
  for (const match of source.matchAll(/(?:from\s*|import\s*)["']([^"']+)["']/g)) {
    const specifier = match[1]
    if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
    const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
    if (!declared.has(packageName)) throw new Error(`Runtime import ${packageName} is not declared in the packed manifest`)
  }
}

try {
  const suppliedArchive = process.env.DSH_SESSION_ARCHIVE_TARBALL
  let archive
  if (suppliedArchive === undefined) {
    execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: packageRoot, stdio: 'pipe' })
    const archives = (await readdir(destination)).filter(file => file.endsWith('.tgz'))
    if (archives.length !== 1) throw new Error(`Expected one packed archive; found ${archives.length}`)
    archive = join(destination, archives[0])
  } else archive = resolve(suppliedArchive)

  const entries = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n'))
  for (const entry of ['package/lib/index.js', 'package/lib/client.js', 'package/cordis.patch.yml']) {
    if (!entries.has(entry)) throw new Error(`Packed archive is missing ${entry}`)
  }
  if ([...entries].some(entry => entry.includes('node_modules/'))) throw new Error('Packed archive must not contain installed workspace packages')
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
  if (manifest.dependencies?.['@deepseek-ai/dsh-session-log-export']
    || manifest.peerDependencies?.['@deepseek-ai/dsh-session-log-export']) {
    throw new Error('Packed archive still depends on the Session log export package')
  }
  const hostCode = execFileSync('tar', ['-xOf', archive, 'package/lib/index.js'], { encoding: 'utf8' })
  assertImportClosure(hostCode, manifest)
  if (hostCode.includes('@deepseek-ai/dsh-session-log-export') || hostCode.includes('restoreCapabilities')
    || hostCode.includes('restoreImage') || hostCode.includes('sessionPersistence.delete')) {
    throw new Error('Packed Host artifact retains an unsupported restore dependency')
  }
  const patch = execFileSync('tar', ['-xOf', archive, 'package/cordis.patch.yml'], { encoding: 'utf8' })
  if (!patch.includes("name: '@deepseek-ai/dsh-session-archive'")) throw new Error('Packed patch does not target its own package')

  const unpacked = join(destination, 'unpacked')
  await mkdir(unpacked)
  execFileSync('tar', ['-xzf', archive, '-C', unpacked])
  const packageDir = join(unpacked, 'package')
  const runtimeHome = await mkdtemp(join(tmpdir(), 'dsh-session-archive-loader-'))
  let appContext
  let sourceContext
  const server = createServer((req, res) => {
    void bridge(req, res, appContext.get('connection').createSharedFetchHandler('/api'))
  })
  try {
    const profileDir = join(runtimeHome, 'profile')
    const profileModules = join(profileDir, 'node_modules', '@deepseek-ai')
    const packageModules = join(packageDir, 'node_modules')
    await mkdir(profileModules, { recursive: true })
    await mkdir(join(packageModules, '@deepseek-ai'), { recursive: true })
    await symlink(packageDir, join(profileModules, 'dsh-session-archive'), 'dir')
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (!dependency.startsWith('@deepseek-ai/')) continue
      const installed = join(workspaceModules, dependency)
      await symlink(installed, join(packageModules, dependency), 'dir')
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (dependency.startsWith('@deepseek-ai/')) continue
      const installed = join(workspaceModules, dependency)
      const link = join(packageModules, dependency)
      await mkdir(dirname(link), { recursive: true })
      await symlink(installed, link, 'dir')
    }
    await writeFile(join(profileDir, 'cordis.yml'), '[]\n')
    const profileContext = {
      name: 'session-archive-tarball-smoke', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'),
      installAnchor: join(repositoryRoot, 'package.json'), cwd: runtimeHome, home: runtimeHome,
      startedBundles: [manifest.name], overlays: [], telemetryDisabledEnv: undefined,
    }
    let context
    try {
      context = await boot('dsh-session-archive-tarball-smoke', join(profileDir, 'cordis.yml'),
        loadOverlayPatches('dsh-session-archive-tarball-smoke', join(packageDir, 'cordis.patch.yml')),
        async host => {
          host.provide('profileContext', profileContext)
          host.provide('sessions', { get: () => undefined, list: () => [], flush: async () => true })
          await host.plugin(owner => { new HostConnectionService(owner, [], {}) })
          await host.plugin(JsonlSessionPersistence, { root: join(runtimeHome, 'sessions'), compression: 'none' })
          await host.plugin(LocalAttachmentStore, { dshHome: runtimeHome })
          await host.plugin(Storage)
          await host.plugin({ name: 'storage-json', inject: ['storage'], apply: applyStorageJson, Config: StorageJsonConfig }, { root: join(runtimeHome, 'domains') })
          await host.plugin({ name: 'storage-domain', inject: ['storage'], apply: applyStorageDomain, Config: StorageDomainConfig }, { backend: 'json' })
          await host.plugin(WorkspaceRegistry)
        })
      appContext = context
      const entry = context.loader.entries().find(row => row.options.id === 'session-archive')
      if (entry?.options.name !== manifest.name || entry.fiber?.state !== 2) {
        throw new Error(`Tarball Loader row is not active: ${String(entry?.fiber?.state)}`)
      }
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Tarball smoke HTTP server has no TCP address.')
      const port = address.port
      const head = await requestRoute(port, 'HEAD')
      if (head.status !== 200 || head.body.length !== 0) throw new Error(`Packed archive HEAD returned ${head.status}`)
      const get = await requestRoute(port, 'GET')
      if (get.status !== 200 || get.body.subarray(0, 2).toString() !== 'PK') {
        throw new Error(`Packed archive GET did not return a ZIP: HTTP ${get.status}`)
      }
      const post = await requestRoute(port, 'POST', 'not a ZIP')
      if (post.status !== 400 || JSON.parse(post.body.toString('utf8')).error === undefined) {
        throw new Error(`Packed archive POST did not reach route validation: HTTP ${post.status}`)
      }

      const workspacePath = join(runtimeHome, 'existing-workspace')
      await mkdir(workspacePath)
      const workspace = await appContext.workspaceRegistry.create(workspacePath)
      sourceContext = new Context()
      const sourceHome = join(runtimeHome, 'source')
      await sourceContext.plugin(JsonlSessionPersistence, { root: join(sourceHome, 'sessions'), compression: 'none' })
      await sourceContext.plugin(LocalAttachmentStore, { dshHome: sourceHome })
      const docx = zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'word/document.xml': strToU8('<document>archive smoke</document>'),
      }, { level: 0 })
      const file = await sourceContext.attachments.saveFileStream({ data: oneChunk(docx), name: 'smoke.docx' })
      const sessionId = SessionId('830b1e3b-e9e6-480c-9006-bd86bd3fa885')
      const header = {
        version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: Date.now(), isSeeded: false,
        delegationDepth: 0, cwd: workspacePath,
      }
      const handle = await sourceContext.sessionPersistence.create(header)
      const time = Date.now()
      await handle.append([
        { type: 'turn/start', seq: SessionSeq(0), time, data: { turn: 1 } },
        { type: 'step/start', seq: SessionSeq(1), time: time + 1, data: { turn: 1, step: 1 } },
        { type: 'system/message', seq: SessionSeq(2), time: time + 2, surfaceOp: 'append', data: {
          turn: 1, step: 1, message: { id: 'system-1', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'archive smoke system prompt' }] },
        } },
        { type: 'user/message', seq: SessionSeq(3), time: time + 3, surfaceOp: 'append', data: {
          id: 'archive-loader-smoke', role: 'user',
          content: [{ type: 'text', text: 'loader restore' }, { type: 'file', attachment: file }],
          source: { kind: 'user' },
        } },
        { type: 'assistant/message', seq: SessionSeq(4), time: time + 4, surfaceOp: 'append', data: {
          turn: 1, step: 1, message: { id: 'assistant-1', role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [{ type: 'text', text: 'archive smoke reply' }] }, stream: [],
        } },
        { type: 'step/end', seq: SessionSeq(5), time: time + 5, data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: SessionSeq(6), time: time + 6, data: { turn: 1, reason: { kind: 'completed' } } },
      ])
      await handle.flush()
      await handle.close()
      const archiveApi = await import(pathToFileURL(join(packageDir, 'lib/index.js')).href)
      const archiveBytes = Buffer.from(await new Response(archiveApi.streamSessionArchive({
        sessionPersistence: sourceContext.sessionPersistence,
        attachments: sourceContext.attachments,
        sessions: undefined,
        workspaceRegistry: undefined,
        journalRoot: join(sourceHome, 'session-archive', 'imports'),
      }, 0, new AbortController().signal)).arrayBuffer())
      const imported = await requestRoute(port, 'POST', archiveBytes)
      if (imported.status !== 200) throw new Error(`Packed archive restore returned HTTP ${imported.status}: ${imported.body.toString('utf8')}`)
      const importResult = JSON.parse(imported.body.toString('utf8'))
      if (importResult.partial !== false || !workspace.sessionIds.includes(sessionId)) {
        throw new Error(`Packed archive restore did not attach the Session to the existing Workspace: ${imported.body.toString('utf8')}`)
      }

      const backupDirectory = join(runtimeHome, 'legacy-backups')
      const attachmentRoot = join(runtimeHome, 'legacy-attachments')
      await mkdir(backupDirectory)
      await mkdir(attachmentRoot)
      const backupPath = join(backupDirectory, 'legacy.sqlite')
      const database = new DatabaseSync(backupPath)
      database.exec(`
        PRAGMA user_version = 2;
        CREATE TABLE dsh_session_metadata (
          id TEXT PRIMARY KEY, header_json TEXT NOT NULL, updated_at TEXT NOT NULL,
          inherited_event_count INTEGER NOT NULL DEFAULT 0, event_count INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL DEFAULT 1
        ) STRICT;
        CREATE TABLE dsh_session_events (
          session_id TEXT NOT NULL REFERENCES dsh_session_metadata(id) ON DELETE CASCADE,
          seq INTEGER NOT NULL, event_json TEXT NOT NULL, PRIMARY KEY(session_id, seq)
        ) STRICT;
        CREATE TABLE dsh_session_store_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      `)
      database.prepare('INSERT INTO dsh_session_metadata (id, header_json, updated_at, inherited_event_count, event_count, revision) VALUES (?, ?, ?, ?, ?, ?)')
        .run('legacy-tarball-smoke', JSON.stringify({ version: 3, id: 'legacy-tarball-smoke', createdAt: 1, isSeeded: false, delegationDepth: 0 }), '2026-01-01T00:00:00.000Z', 0, 0, 1)
      database.close()
      const sqliteListing = await requestRoute(port, 'POST', JSON.stringify({ directory: backupDirectory }), sqliteListPath)
      if (sqliteListing.status !== 200 || !JSON.parse(sqliteListing.body.toString('utf8')).files.some(file => file.name === 'legacy.sqlite')) {
        throw new Error(`Packed SQLite listing failed: HTTP ${sqliteListing.status}: ${sqliteListing.body.toString('utf8')}`)
      }
      const sqliteImport = await requestRoute(port, 'POST', JSON.stringify({ backupPath, attachmentRoot }), sqliteImportPath)
      if (sqliteImport.status !== 200) throw new Error(`Packed SQLite import failed: HTTP ${sqliteImport.status}: ${sqliteImport.body.toString('utf8')}`)
      const sqliteResult = JSON.parse(sqliteImport.body.toString('utf8'))
      if (sqliteResult.sourceFormat !== 'desktop-sqlite-v2' || sqliteResult.importedSessionIds?.[0] !== 'legacy-tarball-smoke') {
        throw new Error(`Packed SQLite route returned an unexpected result: ${sqliteImport.body.toString('utf8')}`)
      }
    } finally {
      if (server.listening) await new Promise(resolve => server.close(() => resolve()))
      await sourceContext?.fiber.dispose()
      await context?.fiber.dispose()
    }
  } finally {
    await rm(runtimeHome, { recursive: true, force: true })
  }
  process.stdout.write(`Verified ${archive} through the official Loader and real node:http bridge (GET, HEAD, POST).\n`)
} finally {
  await rm(destination, { recursive: true, force: true })
}

async function* oneChunk(data) {
  yield data
}

function requestRoute(port, method, body, path = sessionArchivePath) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }))
    })
    req.once('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}
