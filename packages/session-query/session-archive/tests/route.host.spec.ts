import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { bridge } from '@deepseek-ai/dsh-client-connection/src/http-bridge.ts'
import type { AddressInfo } from 'node:net'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, inject } from '../src/index.ts'
import { SESSION_ARCHIVE_PATH, SESSION_ARCHIVE_SQLITE_IMPORT_PATH, SESSION_ARCHIVE_SQLITE_LIST_PATH } from '../src/routes.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Session archive Fetch route', () => {
  it('serves GET, HEAD, and POST through the official node:http bridge', async () => {
    expect(inject).toEqual(['connection', 'profileContext', 'sessionPersistence', 'attachments', 'sessions'])
    const home = await mkdtemp(join(tmpdir(), 'dsh-session-archive-route-'))
    temporary.push(home)
    const ctx = new Context()
    const server = createServer((req, res) => {
      void bridge(req, res, (ctx.get('connection') as HostConnectionService).createSharedFetchHandler('/api'))
    })
    try {
      ctx.provide('profileContext', { home, cwd: home } as never)
      ctx.provide('sessions', { get: () => undefined, flush: async () => true } as never)
      await ctx.plugin((owner) => { new HostConnectionService(owner, [], {} as BrowserAuth) })
      await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions'), compression: 'none' })
      await ctx.plugin(LocalAttachmentStore, { dshHome: home })
      const fiber = ctx.plugin({ inject: [...inject], apply })
      await fiber
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      const port = (server.address() as AddressInfo).port

      const get = await send(port, 'GET')
      expect(get.status).toBe(200)
      expect(get.headers['content-type']).toBe('application/zip')
      expect(get.body.subarray(0, 2).toString()).toBe('PK')

      const head = await send(port, 'HEAD')
      expect(head.status).toBe(200)
      expect(head.body.byteLength).toBe(0)

      const post = await send(port, 'POST', 'not a ZIP')
      expect(post.status).toBe(400)
      expect(JSON.parse(post.body.toString('utf8'))).toMatchObject({ error: expect.any(String) as string })

      const backupDirectory = join(home, 'legacy-backups')
      await mkdir(backupDirectory)
      await writeFile(join(backupDirectory, 'session.sqlite'), 'synthetic')
      await writeFile(join(backupDirectory, 'notes.txt'), 'not a database')
      await symlink(join(backupDirectory, 'session.sqlite'), join(backupDirectory, 'linked.sqlite'))
      await mkdir(join(backupDirectory, 'folder.sqlite'))
      const listing = await send(port, 'POST', JSON.stringify({ directory: backupDirectory }), SESSION_ARCHIVE_SQLITE_LIST_PATH)
      expect(listing.status).toBe(200)
      expect(JSON.parse(listing.body.toString('utf8'))).toEqual({
        files: [{ name: 'session.sqlite', path: join(await realpath(backupDirectory), 'session.sqlite'), bytes: 9 }],
      })

      const relative = await send(port, 'POST', JSON.stringify({ directory: 'relative/path' }), SESSION_ARCHIVE_SQLITE_LIST_PATH)
      expect(relative.status).toBe(400)
      expect(JSON.parse(relative.body.toString('utf8'))).toMatchObject({ error: expect.any(String) as string })

      const sqliteDirectory = join(home, 'legacy-source')
      const attachmentRoot = join(home, 'legacy-attachments')
      await mkdir(sqliteDirectory)
      await mkdir(attachmentRoot)
      const backupPath = join(sqliteDirectory, 'legacy.sqlite')
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
        .run('legacy-empty', JSON.stringify({ version: 3, id: 'legacy-empty', createdAt: 1, isSeeded: false, delegationDepth: 0 }), '2026-01-01T00:00:00.000Z', 0, 0, 1)
      database.close()
      const sourceBefore = await readFile(backupPath)
      const migrated = await send(port, 'POST', JSON.stringify({ backupPath, attachmentRoot }), SESSION_ARCHIVE_SQLITE_IMPORT_PATH)
      expect(migrated.status, migrated.body.toString('utf8')).toBe(200)
      expect(JSON.parse(migrated.body.toString('utf8'))).toMatchObject({
        importedSessions: 1, importedSessionIds: ['legacy-empty'], sourceFormat: 'desktop-sqlite-v2',
      })
      const sourceAfter = await readFile(backupPath)
      expect(sourceAfter).toEqual(sourceBefore)
    } finally {
      await new Promise<void>(resolve => server.close(() =>{  resolve() }))
      await ctx.fiber.dispose()
    }
  })
})

function send(port: number, method: 'GET' | 'HEAD' | 'POST', body?: string, path = SESSION_ARCHIVE_PATH): Promise<{
  readonly status: number
  readonly headers: Readonly<Record<string, string | string[] | undefined>>
  readonly body: Buffer
}> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      response.on('end', () =>{  resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }) })
    })
    req.once('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}
