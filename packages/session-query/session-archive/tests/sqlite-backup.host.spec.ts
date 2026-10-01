import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { SessionArchiveReady } from '../src/archive.ts'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { convertDesktopSqliteBackupToArchive, restoreSessionArchive } from '../src/index.ts'
import { SESSION_LOG_FILENAME } from '../src/session-log.ts'

const roots: string[] = []
const contexts: Context[] = []
const fileBytes = Buffer.from('synthetic legacy file attachment')
const fileId = `sha256:${createHash('sha256').update(fileBytes).digest('hex')}`
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')
const imageId = `sha256:${createHash('sha256').update(imageBytes).digest('hex')}`

class ResumeAdapter extends LlmAdapter {
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'resumed synthetic reply' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'resumed synthetic reply' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

function turnRows(id: string, offset: number, includeAttachments = false) {
  const system = {
    type: 'system/message', seq: offset + 2, time: offset + 3, surfaceOp: 'append',
    data: { turn: 1, step: 1, message: { id: `${id}-system`, role: 'system', source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' }, content: [{ type: 'text', text: 'synthetic system prompt' }] } },
  }
  const content = includeAttachments
    ? [
      { type: 'image', attachment: { attachmentId: imageId, mediaType: 'image/png', bytes: imageBytes.byteLength, width: 1, height: 1 } },
      { type: 'file', attachment: { attachmentId: fileId, bytes: fileBytes.byteLength, name: 'notes.txt' } },
    ]
    : [{ type: 'text', text: 'synthetic child input' }]
  return [
    { type: 'turn/start', seq: offset, time: offset + 1, data: { turn: 1 } },
    { type: 'step/start', seq: offset + 1, time: offset + 2, data: { turn: 1, step: 1 } },
    system,
    { type: 'user/message', seq: offset + 3, time: offset + 4, surfaceOp: 'append', data: { id: `${id}-user`, role: 'user', source: { kind: 'user' }, content } },
    { type: 'assistant/message', seq: offset + 4, time: offset + 5, surfaceOp: 'append', data: {
      turn: 1, step: 1, message: { id: `${id}-assistant`, role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [{ type: 'text', text: 'synthetic reply' }] }, stream: [],
    } },
    { type: 'step/end', seq: offset + 5, time: offset + 6, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: offset + 6, time: offset + 7, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
}

async function fixture(): Promise<{ readonly root: string; readonly database: string; readonly attachments: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sqlite-backup-test-'))
  roots.push(root)
  const database = join(root, 'selected-backup.sqlite')
  const attachments = join(root, 'selected-attachments')
  const objectDir = join(attachments, 'file-objects', fileId.slice(7, 9))
  await mkdir(objectDir, { recursive: true })
  await writeFile(join(objectDir, fileId.slice(7)), fileBytes)
  const imageDir = join(attachments, 'objects', imageId.slice(7, 9))
  await mkdir(imageDir, { recursive: true })
  await writeFile(join(imageDir, imageId.slice(7)), imageBytes)
  const db = new DatabaseSync(database)
  db.exec(`
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
  const insertSession = db.prepare('INSERT INTO dsh_session_metadata (id, header_json, updated_at, inherited_event_count, event_count, revision) VALUES (?, ?, ?, ?, ?, ?)')
  const insertEvent = db.prepare('INSERT INTO dsh_session_events (session_id, seq, event_json) VALUES (?, ?, ?)')
  const parent = { version: 3, id: 'parent', createdAt: 10, isSeeded: false, delegationDepth: 0 }
  const child = { version: 3, id: 'child', createdAt: 20, isSeeded: false, parentSession: 'parent', origin: 'subagent', delegationDepth: 1 }
  const parentRows = turnRows('parent', 0, true)
  const childRows = [
    { type: 'subagent/descriptor', seq: 0, time: 20, data: { version: 3, mode: 'one-shot', provider: 'fork' } },
    ...turnRows('child', 1),
  ]
  insertSession.run('parent', JSON.stringify(parent), '10', 0, parentRows.length, 1)
  insertSession.run('child', JSON.stringify(child), '20', 0, childRows.length, 1)
  for (const [id, rows] of [['parent', parentRows], ['child', childRows]] as const) {
    for (const event of rows) insertEvent.run(id, event.seq, JSON.stringify(event))
  }
  db.close()
  return { root, database, attachments }
}

async function sourceDigest(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

afterEach(async () => {
  try {
    for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  } finally {
    await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  }
})

describe('offline Desktop SQLite backup conversion', () => {
  // Generated through the frozen v0.1.21 provider's public persistence API; one synthetic completed turn, no user data.
  it('converts a schema-2/version-3 database produced by the frozen SQLite provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-frozen-sqlite-fixture-'))
    roots.push(root)
    const database = join(root, 'frozen.sqlite')
    const attachments = join(root, 'attachments')
    await copyFile(new URL('./fixtures/frozen-desktop-schema2-session-v3.sqlite', import.meta.url), database)
    await mkdir(attachments)
    const archive = await convertDesktopSqliteBackupToArchive(database, attachments)
    const entries = unzipSync(archive)
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as { sessions: Array<{ id: string; path: string }> }
    expect(manifest.sessions.map(session => session.id)).toEqual(['legacy-provider-session'])
    const rows = strFromU8(entries[manifest.sessions[0]!.path]!).trim().split('\n').map(line => JSON.parse(line) as { type: string; version?: number })
    expect(rows[0]).toMatchObject({ type: 'session', version: SESSION_FORMAT_VERSION })
    expect(rows.some(row => row.type === 'system/message')).toBe(true)

    const targetHome = join(root, 'target')
    await mkdir(targetHome)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: join(targetHome, 'sessions'), compression: 'none' })
    await ctx.plugin(LocalAttachmentStore, { dshHome: targetHome })
    const ready: SessionArchiveReady = {
      sessionPersistence: ctx.get('sessionPersistence') as SessionPersistence,
      attachments: ctx.get('attachments') as AttachmentStore,
      sessions: undefined, workspaceRegistry: undefined, journalRoot: join(targetHome, 'session-archive', 'imports'),
    }
    const result = await restoreSessionArchive(ready, new ReadableStream({
      start(controller) { controller.enqueue(archive); controller.close() },
    }), {
      maxArchiveBytes: 256 * 1024 * 1024, maxExpandedBytes: 1024 * 1024 * 1024,
      maxSessionLogBytes: 128 * 1024 * 1024, maxImageBytes: 16 * 1024 * 1024,
    }, new AbortController().signal)
    expect(result.importedSessions).toBe(1)
    await ctx.fiber.dispose()
    const reopened = new Context()
    contexts.push(reopened)
    await reopened.plugin(JsonlSessionPersistence, { root: join(targetHome, 'sessions'), compression: 'none' })
    const handle = await reopened.sessionPersistence.open(SessionId('legacy-provider-session'), 'read')
    try {
      expect((await handle.read()).events.some(event => event.type === 'system/message')).toBe(true)
    } finally {
      await handle.close()
    }
    await mountAgentLoopTestDependencies(reopened)
    reopened.llm.registerAdapter(['mock'], new ResumeAdapter())
    await mountAgentLoopTestHarness(reopened)
    const resumed = await reopened.agents.resume({
      resumeSessionId: SessionId('legacy-provider-session'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const idle = waitForIdle(reopened, resumed.agent)
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue the provider-generated fixture' }], source: { kind: 'user' } }))
    await idle
    await resumed.dispose()
    await reopened.fiber.dispose()
    const cold = new Context()
    contexts.push(cold)
    await cold.plugin(JsonlSessionPersistence, { root: join(targetHome, 'sessions'), compression: 'none' })
    const coldHandle = await cold.sessionPersistence.open(SessionId('legacy-provider-session'), 'read')
    try {
      const events = (await coldHandle.read()).events
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
      expect(events.some(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'text' && block.text === 'resumed synthetic reply'))).toBe(true)
    } finally {
      await coldHandle.close()
    }
  })

  it('accepts a pending frozen-provider Session with no surface events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-frozen-empty-sqlite-fixture-'))
    roots.push(root)
    const database = join(root, 'empty.sqlite')
    const attachments = join(root, 'attachments')
    await copyFile(new URL('./fixtures/frozen-desktop-schema2-session-v3.sqlite', import.meta.url), database)
    await mkdir(attachments)
    const db = new DatabaseSync(database)
    db.exec('DELETE FROM dsh_session_events; UPDATE dsh_session_metadata SET event_count = 0')
    db.close()
    const archive = unzipSync(await convertDesktopSqliteBackupToArchive(database, attachments))
    const manifest = JSON.parse(strFromU8(archive['manifest.json']!)) as { sessions: Array<{ id: string; path: string }> }
    const lines = strFromU8(archive[manifest.sessions[0]!.path]!).trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'session', id: 'legacy-provider-session' })
  })

  it('uses official V3 child facts and emits a complete archive-v1 parent/child transfer', async () => {
    const source = await fixture()
    const before = await sourceDigest(source.database)
    const archive = await convertDesktopSqliteBackupToArchive(source.database, source.attachments)
    const entries = unzipSync(archive)
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as { sessionFormatVersion: number; sessions: Array<{ id: string; path: string }> }
    expect(manifest.sessionFormatVersion).toBe(4)
    expect(manifest.sessions.map(item => item.id)).toEqual(['child', 'parent'])
    const logs = manifest.sessions.map(item => strFromU8(entries[item.path]!).trim().split('\n').map(line => JSON.parse(line) as Record<string, unknown>))
    expect(logs[0]?.[0]).toMatchObject({ type: 'session', version: 4, parentSession: 'parent', origin: 'subagent' })
    expect(logs[0]?.some(row => row.type === 'system/message')).toBe(true)
    expect(logs[0]?.some(row => row.type === 'subagent/catalog')).toBe(false)
    expect(logs[1]?.some(row => row.type === 'subagent/catalog')).toBe(true)
    expect(logs[1]?.find(row => row.type === 'system/message')?.seq).toBe(2)
    expect(logs[1]?.some(row => row.type === 'assistant/message')).toBe(true)
    expect(Object.keys(entries)).toContain(`files/${fileId.slice(7, 9)}/${fileId.slice(7)}/notes.txt`)
    expect(Object.keys(entries)).toContain(`media/${imageId}.png`)
    expect(entries[SESSION_LOG_FILENAME]).toBeUndefined()
    expect(await sourceDigest(source.database)).toBe(before)

    const targetHome = join(source.root, 'isolated-target')
    await mkdir(targetHome)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(JsonlSessionPersistence, { root: join(targetHome, 'sessions'), compression: 'none' })
    await ctx.plugin(LocalAttachmentStore, { dshHome: targetHome })
    const ready: SessionArchiveReady = {
      sessionPersistence: ctx.get('sessionPersistence') as SessionPersistence,
      attachments: ctx.get('attachments') as AttachmentStore,
      sessions: undefined,
      workspaceRegistry: undefined,
      journalRoot: join(targetHome, 'session-archive', 'imports'),
    }
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(archive); controller.close() } })
    const imported = await restoreSessionArchive(ready, body, {
      maxArchiveBytes: 256 * 1024 * 1024, maxExpandedBytes: 1024 * 1024 * 1024,
      maxSessionLogBytes: 128 * 1024 * 1024, maxImageBytes: 16 * 1024 * 1024,
    }, new AbortController().signal)
    expect(imported.importedSessionIds.map(String).sort()).toEqual(['child', 'parent'])
    expect(imported.importedSessions).toBe(2)
    expect(imported.outcomes.filter(outcome => outcome.kind === 'session' && outcome.status === 'imported')).toHaveLength(2)
    await ctx.fiber.dispose()
    const coldCtx = new Context()
    contexts.push(coldCtx)
    await coldCtx.plugin(JsonlSessionPersistence, { root: join(targetHome, 'sessions'), compression: 'none' })
    await coldCtx.plugin(LocalAttachmentStore, { dshHome: targetHome })
    for (const id of ['parent', 'child']) {
      const reopened = await coldCtx.sessionPersistence.open(SessionId(id), 'read')
      try {
        const restored = await reopened.read()
        expect(restored.events.some(event => event.type === 'turn/end')).toBe(true)
        expect(restored.events.some(event => event.type === 'system/message')).toBe(true)
      } finally {
        await reopened.close()
      }
    }
    await mountAgentLoopTestDependencies(coldCtx)
    coldCtx.llm.registerAdapter(['mock'], new ResumeAdapter())
    await mountAgentLoopTestHarness(coldCtx)
    const resumed = await coldCtx.agents.resume({
      resumeSessionId: SessionId('parent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const idle = waitForIdle(coldCtx, resumed.agent)
    resumed.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue the restored conversation' }], source: { kind: 'user' } }))
    await idle
    await resumed.dispose()
    await coldCtx.fiber.dispose()
    const restartedCtx = new Context()
    contexts.push(restartedCtx)
    await restartedCtx.plugin(JsonlSessionPersistence, { root: join(targetHome, 'sessions'), compression: 'none' })
    const coldRead = await restartedCtx.sessionPersistence.open(SessionId('parent'), 'read')
    try {
      const events = (await coldRead.read()).events
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(2)
      expect(events.filter(event => event.type === 'turn/end')).toHaveLength(2)
      expect(events.some(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'text' && block.text === 'resumed synthetic reply'))).toBe(true)
    } finally {
      await coldRead.close()
    }
  })

  it('fails closed for unsupported schema, damaged JSON, missing attachments, and limits without changing the source', async () => {
    const source = await fixture()
    const before = await sourceDigest(source.database)
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments, { maxSourceBytes: 1 })).rejects.toThrow('source-size limit')
    const unsupportedPath = join(source.root, 'unsupported.sqlite')
    await copyFile(source.database, unsupportedPath)
    const unsupported = new DatabaseSync(unsupportedPath)
    unsupported.exec('PRAGMA user_version = 3')
    unsupported.close()
    await expect(convertDesktopSqliteBackupToArchive(unsupportedPath, source.attachments)).rejects.toThrow('schema version 3')
    const damagedPath = join(source.root, 'damaged.sqlite')
    await copyFile(source.database, damagedPath)
    const damaged = new DatabaseSync(damagedPath)
    damaged.prepare("UPDATE dsh_session_events SET event_json = '{' WHERE session_id = 'parent'").run()
    damaged.close()
    await expect(convertDesktopSqliteBackupToArchive(damagedPath, source.attachments)).rejects.toThrow('not valid JSON')
    expect(await sourceDigest(source.database)).toBe(before)
  })

  it('rejects a missing explicit attachment object and leaves the selected database unchanged', async () => {
    const source = await fixture()
    const before = await sourceDigest(source.database)
    await rm(join(source.attachments, 'file-objects', fileId.slice(7, 9), fileId.slice(7)))
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments)).rejects.toThrow('attachment object')
    expect(await sourceDigest(source.database)).toBe(before)
  })

  it('rejects a child whose direct parent is absent', async () => {
    const source = await fixture()
    const db = new DatabaseSync(source.database)
    db.prepare("DELETE FROM dsh_session_metadata WHERE id = 'parent'").run()
    db.close()
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments)).rejects.toThrow('missing direct parent')
  })

  it('rejects non-dense row sequence numbers', async () => {
    const source = await fixture()
    const db = new DatabaseSync(source.database)
    db.prepare("UPDATE dsh_session_events SET seq = 99 WHERE session_id = 'parent' AND seq = 3").run()
    db.close()
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments)).rejects.toThrow('dense and sequence-matched')
  })

  it('refuses a V3-valid but non-continuable user-only history without changing the source', async () => {
    const source = await fixture()
    const database = new DatabaseSync(source.database)
    const rows = database.prepare("SELECT event_json FROM dsh_session_events WHERE session_id = 'parent' ORDER BY seq").all() as Array<{ event_json: string }>
    database.prepare("DELETE FROM dsh_session_events WHERE session_id = 'parent'").run()
    let sequence = 0
    for (const row of rows) {
      const event = JSON.parse(row.event_json) as { type: string; seq: number }
      if (event.type === 'system/message') continue
      event.seq = sequence
      database.prepare('INSERT INTO dsh_session_events(session_id, seq, event_json) VALUES (?, ?, ?)').run('parent', sequence, JSON.stringify(event))
      sequence += 1
    }
    database.prepare('UPDATE dsh_session_metadata SET event_count = ? WHERE id = ?').run(sequence, 'parent')
    database.close()
    const before = await sourceDigest(source.database)
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments)).rejects.toThrow(/cannot be safely continued/u)
    expect(await sourceDigest(source.database)).toBe(before)
  })

  it.each(['-wal', '-shm'] as const)('rejects a source with a %s sidecar', async (suffix) => {
    const source = await fixture()
    await writeFile(`${source.database}${suffix}`, '')
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments)).rejects.toThrow('sidecar')
  })

  it('enforces input JSON byte bounds before reading rows, including the exact boundary', async () => {
    const source = await fixture()
    const db = new DatabaseSync(source.database, { readOnly: true })
    const { bytes } = db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(length(CAST(header_json AS BLOB))), 0) FROM dsh_session_metadata)
        + (SELECT COALESCE(SUM(length(CAST(event_json AS BLOB))), 0) FROM dsh_session_events) AS bytes
    `).get() as { bytes: number }
    db.close()
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments, { maxInputJsonBytes: bytes }))
      .resolves.toBeInstanceOf(Uint8Array)
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments, { maxInputJsonBytes: bytes - 1 }))
      .rejects.toThrow('input-JSON byte limit')
  })

  it('enforces configurable Session, event, expanded, log, image, and compressed archive limits', async () => {
    const source = await fixture()
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments, { maxSessionCount: 1 }))
      .rejects.toThrow('Session-count limit')
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments, { maxEventCount: 1 }))
      .rejects.toThrow('event-count limit')
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments, { maxExpandedBytes: 1 }))
      .rejects.toThrow('expanded-byte limit')
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments, { maxSessionLogBytes: 1 }))
      .rejects.toThrow('log-size limit')
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments, { maxImageAttachmentBytes: 1 }))
      .rejects.toThrow('byte limit')
    await expect(convertDesktopSqliteBackupToArchive(source.database, source.attachments, { maxArchiveBytes: 1 }))
      .rejects.toThrow('compressed-byte limit')
  })
})
