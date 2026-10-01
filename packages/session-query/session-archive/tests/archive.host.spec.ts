import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { Config as StorageDomainConfig, apply as applyStorageDomain } from '@deepseek-ai/dsh-storage-domain'
import { Config as StorageJsonConfig, apply as applyStorageJson } from '@deepseek-ai/dsh-storage-json'
import { Zip, ZipDeflate, unzipSync, zipSync, strToU8 } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import {
  SESSION_ARCHIVE_FORMAT,
  SESSION_ARCHIVE_VERSION,
  restoreSessionArchive,
  sessionArchiveEntries,
  streamSessionArchive,
  type SessionArchiveReady,
} from '@deepseek-ai/dsh-session-archive/src/archive.ts'
import { SESSION_LOG_FILENAME, sessionLogFileEntryPath, sessionLogImageEntryPath } from '@deepseek-ai/dsh-session-archive/src/session-log.ts'
import type { SessionArchiveZipEntry } from '@deepseek-ai/dsh-session-archive/src/session-log.ts'

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-session-archive-test-'))
  roots.push(value)
  return value
}

interface MountedSessionArchive {
  readonly ctx: Context
  readonly services: SessionArchiveReady
}

async function mounted(options: { readonly workspaceRegistry?: boolean } = {}): Promise<MountedSessionArchive> {
  const home = await root()
  const ctx = new Context()
  await ctx.plugin(JsonlSessionPersistence, { root: join(home, 'sessions'), compression: 'none' })
  await ctx.plugin(LocalAttachmentStore, { dshHome: home })
  if (options.workspaceRegistry === true) {
    await ctx.plugin(Storage)
    await ctx.plugin({ name: 'storage-json', inject: ['storage'], apply: applyStorageJson, Config: StorageJsonConfig }, { root: join(home, 'domains') })
    await ctx.plugin({ name: 'storage-domain', inject: ['storage'], apply: applyStorageDomain, Config: StorageDomainConfig }, { backend: 'json' })
    await ctx.plugin(WorkspaceRegistry)
  }
  return {
    ctx,
    services: {
      sessionPersistence: ctx.get('sessionPersistence') as SessionPersistence,
      attachments: ctx.get('attachments') as AttachmentStore,
      sessions: undefined,
      workspaceRegistry: options.workspaceRegistry === true ? ctx.workspaceRegistry : undefined,
      journalRoot: join(home, 'session-archive', 'imports'),
    },
  }
}

async function zipOf(entries: ReadonlyMap<string, Uint8Array>): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  for (const [path, data] of entries) files[path] = data
  return zipSync(files, { level: 0 })
}

function duplicateZipEntry(): Uint8Array {
  const chunks: Uint8Array[] = []
  const zip = new Zip((error, chunk) => {
    if (error !== null) throw error
    chunks.push(chunk)
  })
  for (const content of ['first', 'second']) {
    const entry = new ZipDeflate('manifest.json', { level: 0 })
    zip.add(entry)
    entry.push(strToU8(content), true)
  }
  zip.end()
  return new Uint8Array(Buffer.concat(chunks))
}

function stream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(data); controller.close() } })
}

async function* oneChunk(data: Uint8Array): AsyncGenerator<Uint8Array> {
  yield data
}

function manifestFor(id: SessionId, path: string, log: string) {
  const data = Buffer.from(log)
  return JSON.stringify({
    format: SESSION_ARCHIVE_FORMAT,
    archiveVersion: SESSION_ARCHIVE_VERSION,
    sessionFormatVersion: SESSION_FORMAT_VERSION,
    sessions: [{ id, path, bytes: data.byteLength, sha256: `sha256:${createHash('sha256').update(data).digest('hex')}` }],
  })
}

const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC',
  'base64',
))

async function createSession(services: SessionArchiveReady, id: SessionId, content: unknown, cwd?: string): Promise<void> {
  const header: SessionHeader = {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: Date.now(),
    isSeeded: false,
    delegationDepth: 0,
    ...(cwd === undefined ? {} : { cwd }),
  }
  const handle = await services.sessionPersistence.create(header)
  try {
    const time = Date.now()
    await handle.append([
      { type: 'turn/start', seq: SessionSeq(0), time, data: { turn: 1 } },
      { type: 'step/start', seq: SessionSeq(1), time: time + 1, data: { turn: 1, step: 1 } },
      { type: 'system/message', seq: SessionSeq(2), time: time + 2, surfaceOp: 'append', data: {
        turn: 1, step: 1, message: { id: 'system-1', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'synthetic system prompt' }] },
      } },
      { type: 'user/message', seq: SessionSeq(3), time: time + 3, surfaceOp: 'append', data: {
        id: 'message-1', role: 'user', content, source: { kind: 'user' },
      } },
      { type: 'assistant/message', seq: SessionSeq(4), time: time + 4, surfaceOp: 'append', data: {
        turn: 1, step: 1, message: { id: 'assistant-1', role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [{ type: 'text', text: 'synthetic reply' }] }, stream: [],
      } },
      { type: 'step/end', seq: SessionSeq(5), time: time + 5, data: { turn: 1, step: 1 } },
      { type: 'turn/end', seq: SessionSeq(6), time: time + 6, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as SessionEvent[])
    await handle.flush()
  } finally {
    await handle.close()
  }
}

describe('Session archive', () => {
  afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

  it('round-trips complete Session logs and referenced immutable attachments through local providers', async () => {
    const source = await mounted()
    const png = await source.services.attachments.saveImage({ data: PNG, mediaType: 'image/png' })
    const file = await source.services.attachments.saveFileStream({ data: oneChunk(new TextEncoder().encode('archive file')), name: 'notes.txt' })
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<document/>'),
    }, { level: 0 })
    const nestedZip = await source.services.attachments.saveFileStream({ data: oneChunk(docx), name: 'nested.docx' })
    const id = SessionId(randomUUID())
    await createSession(source.services, id, [
      { type: 'image', attachment: png },
      { type: 'file', attachment: file },
      { type: 'file', attachment: nestedZip },
    ])

    const streamed = streamSessionArchive(source.services, 0, new AbortController().signal)
    const archiveBytes = new Uint8Array(await new Response(streamed).arrayBuffer())
    const archive = unzipSync(archiveBytes)
    const manifest = JSON.parse(new TextDecoder().decode(archive['manifest.json'])) as {
      format: string
      archiveVersion: number
      sessions: readonly { id: string; path: string }[]
    }
    expect(manifest).toMatchObject({ format: SESSION_ARCHIVE_FORMAT, archiveVersion: SESSION_ARCHIVE_VERSION })
    expect(Object.keys(archive)).toContain(sessionLogImageEntryPath(png))
    expect(Object.keys(archive)).toContain(sessionLogFileEntryPath(file))
    expect(Object.keys(archive)).toContain(sessionLogFileEntryPath(nestedZip))

    const target = await mounted()
    const appendBatches: number[] = []
    const persistence = target.services.sessionPersistence
    const originalCreate = persistence.create.bind(persistence)
    Object.defineProperty(persistence, 'create', {
      configurable: true,
      value: async (...args: Parameters<SessionPersistence['create']>) => {
        const handle = await originalCreate(...args)
        const append = handle.append.bind(handle)
        Object.defineProperty(handle, 'append', {
          configurable: true,
          value: async (...appendArgs: Parameters<typeof handle.append>) => {
            appendBatches.push(appendArgs[0].length)
            return append(...appendArgs)
          },
        })
        return handle
      },
    })
    const restored = await restoreSessionArchive(target.services, stream(archiveBytes), {
      maxArchiveBytes: 1024 * 1024,
      maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024,
      maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)
    const journalRoot = target.services.journalRoot
    if (journalRoot === undefined) throw new Error('Test profile has no archive journal root.')
    const journal = JSON.parse(await readFile(join(journalRoot, basename(restored.journalPath)), 'utf8')) as {
      attachments: Record<string, string>
      sessions: Record<string, string>
    }
    expect(restored.importedSessionIds).toEqual([id])
    expect(appendBatches).toEqual([7])
    expect(journal.sessions[String(id)]).toBe('imported')
    expect(Object.values(journal.attachments)).toEqual(expect.arrayContaining(['stored']))
    const read = await target.services.sessionPersistence.open(id, 'read')
    try {
      const { events } = await read.read()
      expect(events).toHaveLength(7)
      const user = events.find(event => event.type === 'user/message')
      expect((user as SessionEvent & { data: { content: unknown[] } }).data.content).toEqual([
        { type: 'image', attachment: png },
        { type: 'file', attachment: file },
        { type: 'file', attachment: nestedZip },
      ])
    } finally {
      await read.close()
    }
    expect((await target.services.attachments.readImage(png)).data).toEqual(PNG)
    const restoredFileChunks: Uint8Array[] = []
    for await (const chunk of target.services.attachments.readFileStream(file)) restoredFileChunks.push(chunk)
    expect(Buffer.concat(restoredFileChunks).toString()).toBe('archive file')
  })

  it('enforces compressed archive and per-image export limits', async () => {
    const source = await mounted()
    await expect(new Response(streamSessionArchive(source.services, 0, new AbortController().signal, {
      maxArchiveBytes: 1,
    })).arrayBuffer()).rejects.toThrow('archive exceeds the compressed-byte limit')

    const image = await source.services.attachments.saveImage({ data: PNG, mediaType: 'image/png' })
    await createSession(source.services, SessionId(randomUUID()), [{ type: 'image', attachment: image }])
    await expect(new Response(streamSessionArchive(source.services, 0, new AbortController().signal, {
      maxImageAttachmentBytes: 1,
    })).arrayBuffer()).rejects.toThrow('exceeds the archive image-size limit')
  })

  it('rejects malformed, truncated, duplicate-entry, and expanded-over-limit ZIP input', async () => {
    const target = await mounted()
    const limits = { maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 1024, maxSessionLogBytes: 1024, maxImageBytes: 1024 }
    await expect(restoreSessionArchive(target.services, stream(Uint8Array.from([1, 2, 3])), limits,
      new AbortController().signal)).rejects.toThrow(/ZIP/iu)

    const valid = zipSync({ 'manifest.json': strToU8('{}') }, { level: 0 })
    await expect(restoreSessionArchive(target.services, stream(valid.subarray(0, valid.byteLength - 10)), limits,
      new AbortController().signal)).rejects.toThrow(/truncated|incomplete/u)
    await expect(restoreSessionArchive(target.services, stream(duplicateZipEntry()), limits,
      new AbortController().signal)).rejects.toThrow(/duplicate entry/u)

    const corrupt = zipSync({ payload: strToU8('crc-check') }, { level: 0 })
    const payloadOffset = Buffer.from(corrupt).indexOf(Buffer.from('crc-check'))
    if (payloadOffset < 0) throw new Error('Test ZIP did not contain its stored payload.')
    corrupt[payloadOffset] = corrupt[payloadOffset]! ^ 1
    await expect(restoreSessionArchive(target.services, stream(corrupt), limits,
      new AbortController().signal)).rejects.toThrow(/CRC validation/u)

    const expanded = zipSync({ payload: strToU8('x'.repeat(10_000)) }, { level: 9 })
    await expect(restoreSessionArchive(target.services, stream(expanded), { ...limits, maxExpandedBytes: 100 },
      new AbortController().signal)).rejects.toThrow(/expanded-byte limit/u)
  })

  it('validates all attachment digests before creating Sessions', async () => {
    const source = await mounted()
    const id = SessionId(randomUUID())
    const fakeFile = {
      attachmentId: `sha256:${createHash('sha256').update('actual').digest('hex')}`,
      name: 'notes.txt',
      bytes: 6,
    }
    const logPath = `sessions/00000000/${SESSION_LOG_FILENAME}`
    const log = `${JSON.stringify({ type: 'session', version: 4, id, createdAt: 1, isSeeded: false, delegationDepth: 0 })}\n`
      + `${JSON.stringify({ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } })}\n`
      + `${JSON.stringify({ type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } })}\n`
      + `${JSON.stringify({ type: 'system/message', seq: 2, time: 3, surfaceOp: 'append', data: {
        turn: 1, step: 1, message: { id: 'system-1', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'synthetic system prompt' }] },
      } })}\n${JSON.stringify({
        type: 'user/message', seq: 3, time: 4,
        data: { id: 'message-1', role: 'user', content: [{ type: 'file', attachment: fakeFile }], source: { kind: 'user' } },
        surfaceOp: 'append',
      })}\n`
    const manifest = manifestFor(id, logPath, log)
    const entries = new Map<string, Uint8Array>([
      ['manifest.json', strToU8(manifest)],
      [logPath, strToU8(log)],
      [sessionLogFileEntryPath(fakeFile as never), strToU8('wrong!')],
    ])
    await expect(restoreSessionArchive(source.services, stream(await zipOf(entries)), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)).rejects.toThrow(/digest verification/u)
    const filePath = sessionLogFileEntryPath(fakeFile as never)
    const missing = new Map(entries)
    missing.delete(filePath)
    await expect(restoreSessionArchive(source.services, stream(await zipOf(missing)), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)).rejects.toThrow(/missing referenced attachment/u)
    const unreferenced = new Map(entries)
    unreferenced.set('files/unreferenced', strToU8('extra'))
    await expect(restoreSessionArchive(source.services, stream(await zipOf(unreferenced)), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)).rejects.toThrow(/unreferenced entry/u)
    expect(await source.services.sessionPersistence.stat(id)).toBeUndefined()
  })

  it('rejects Session ID collisions before importing data', async () => {
    const source = await mounted()
    const id = SessionId(randomUUID())
    await createSession(source.services, id, [])
    const entries = new Map<string, Uint8Array>()
    for await (const entry of sessionArchiveEntries(source.services)) {
      entries.set(entry.path, await entryBytes(entry))
    }
    await expect(restoreSessionArchive(source.services, stream(await zipOf(entries)), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)).rejects.toThrow(/already exists/u)
    expect((await source.services.sessionPersistence.list()).map(row => row.header.id)).toEqual([id])
  })

  it('keeps a JSONL create pending without a physical log until its first append or flush', async () => {
    const home = await root()
    const persistenceRoot = join(home, 'sessions')
    const ctx = new Context()
    await ctx.plugin(JsonlSessionPersistence, { root: persistenceRoot, compression: 'none' })
    const id = SessionId(randomUUID())
    const handle = await (ctx.get('sessionPersistence') as SessionPersistence).create({
      version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false, delegationDepth: 0,
    })
    try {
      const files = await readdir(persistenceRoot, { recursive: true }).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
        throw error
      })
      expect(files.some(file => file.endsWith(SESSION_LOG_FILENAME))).toBe(false)
    } finally {
      await handle.close()
    }
  })

  it('rejects a historical user-only surface as non-continuable before persistence writes', async () => {
    const target = await mounted()
    const id = SessionId(randomUUID())
    const path = `sessions/00000000/${SESSION_LOG_FILENAME}`
    const log = `${JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false, delegationDepth: 0 })}\n`
      + `${JSON.stringify({ type: 'user/message', seq: 0, time: 2, surfaceOp: 'append', data: {
        id: 'historical-user', role: 'user', content: [{ type: 'text', text: 'already sent' }], source: { kind: 'user' },
      } })}\n`
    const bytes = await zipOf(new Map([
      ['manifest.json', strToU8(manifestFor(id, path, log))],
      [path, strToU8(log)],
    ]))
    await expect(restoreSessionArchive(target.services, stream(bytes), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)).rejects.toThrow(/cannot be safely continued/u)
    expect(await target.services.sessionPersistence.stat(id)).toBeUndefined()
  })

  it('does not treat an unknown surface-shaped extension as an empty Session', async () => {
    const target = await mounted()
    const id = SessionId(randomUUID())
    const path = `sessions/00000000/${SESSION_LOG_FILENAME}`
    const log = `${JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false, delegationDepth: 0 })}\n`
      + `${JSON.stringify({ type: 'future/message', seq: 0, time: 2, surfaceOp: 'append', ignorable: true, data: { text: 'extension surface' } })}\n`
    const bytes = await zipOf(new Map([
      ['manifest.json', strToU8(manifestFor(id, path, log))],
      [path, strToU8(log)],
    ]))
    await expect(restoreSessionArchive(target.services, stream(bytes), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)).rejects.toThrow(/cannot be safely continued/u)
    expect(await target.services.sessionPersistence.stat(id)).toBeUndefined()
  })

  it('imports an empty pending Session without requiring a system head', async () => {
    const target = await mounted()
    const id = SessionId(randomUUID())
    const path = `sessions/00000000/${SESSION_LOG_FILENAME}`
    const log = `${JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false, delegationDepth: 0 })}\n`
    const bytes = await zipOf(new Map([
      ['manifest.json', strToU8(manifestFor(id, path, log))],
      [path, strToU8(log)],
    ]))
    const result = await restoreSessionArchive(target.services, stream(bytes), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)
    expect(result.importedSessionIds).toEqual([id])
  })

  it('refuses non-reproducible image references before writing any Session', async () => {
    const target = await mounted()
    const originalCreate = target.services.sessionPersistence.create.bind(target.services.sessionPersistence)
    let createCalls = 0
    Object.defineProperty(target.services.sessionPersistence, 'create', {
      configurable: true,
      value: (...args: Parameters<SessionPersistence['create']>) => {
        createCalls += 1
        return originalCreate(...args)
      },
    })
    const id = SessionId(randomUUID())
    const path = `sessions/00000000/${SESSION_LOG_FILENAME}`
    const image = {
      attachmentId: `sha256:${createHash('sha256').update(PNG).digest('hex')}`,
      mediaType: 'image/png', bytes: PNG.byteLength, width: 2, height: 1,
    }
    const log = `${JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id, createdAt: 1, isSeeded: false, delegationDepth: 0 })}\n`
      + `${JSON.stringify({ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } })}\n`
      + `${JSON.stringify({ type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } })}\n`
      + `${JSON.stringify({ type: 'system/message', seq: 2, time: 3, surfaceOp: 'append', data: {
        turn: 1, step: 1, message: { id: 'system-1', role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'synthetic system prompt' }] },
      } })}\n`
      + `${JSON.stringify({ type: 'user/message', seq: 3, time: 4, surfaceOp: 'append', data: {
        id: 'image-message', role: 'user', content: [{ type: 'image', attachment: image }], source: { kind: 'user' },
      } })}\n`
    const manifest = manifestFor(id, path, log)
    const bytes = await zipOf(new Map([
      ['manifest.json', strToU8(manifest)],
      [path, strToU8(log)],
      [`media/${image.attachmentId}.png`, PNG],
    ]))
    const result = await restoreSessionArchive(target.services, stream(bytes), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)
    expect(result.partial).toBe(true)
    expect(result.outcomes).toContainEqual(expect.objectContaining({ id: image.attachmentId, kind: 'image', status: 'failed' }))
    expect(result.outcomes).toContainEqual(expect.objectContaining({ id: String(id), status: 'not-started' }))
    expect(createCalls).toBe(0)
    expect(await target.services.sessionPersistence.stat(id)).toBeUndefined()
  })

  it('keeps successful Session imports and reports a later Session failure', async () => {
    const source = await mounted()
    const first = SessionId(randomUUID())
    const second = SessionId(randomUUID())
    await createSession(source.services, first, [])
    await createSession(source.services, second, [])
    const archive = new Map<string, Uint8Array>()
    for await (const entry of sessionArchiveEntries(source.services)) {
      archive.set(entry.path, await entryBytes(entry))
    }
    const target = await mounted()
    const persistence = target.services.sessionPersistence
    const originalCreate = persistence.create.bind(persistence)
    let calls = 0
    Object.defineProperty(persistence, 'create', {
      configurable: true,
      value: (...args: Parameters<SessionPersistence['create']>) => {
        calls += 1
        if (calls === 2) throw new Error('injected second Session write failure')
        return originalCreate(...args)
      },
    })
    const result = await restoreSessionArchive(target.services, stream(await zipOf(archive)), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)
    expect(result.partial).toBe(true)
    const success = result.outcomes.find(row => row.kind === 'session' && row.status === 'imported')
    const failure = result.outcomes.find(row => row.kind === 'session' && row.status === 'failed')
    expect([String(first), String(second)]).toContain(success?.id)
    expect(failure?.detail).toBe('injected second Session write failure')
    if (success === undefined || failure === undefined) throw new Error('Expected one successful and one failed Session outcome.')
    expect(await target.services.sessionPersistence.stat(SessionId(success.id))).toBeDefined()
    expect(await target.services.sessionPersistence.stat(SessionId(failure.id))).toBeUndefined()
  })

  it('verifies a journaled Session before treating a repeat import as safe', async () => {
    const source = await mounted()
    const id = SessionId(randomUUID())
    await createSession(source.services, id, [])
    const archive = new Map<string, Uint8Array>()
    for await (const entry of sessionArchiveEntries(source.services)) archive.set(entry.path, await entryBytes(entry))
    const bytes = await zipOf(archive)
    const target = await mounted()
    const limits = {
      maxArchiveBytes: 1024 * 1024,
      maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024,
      maxImageBytes: 1024 * 1024,
    }
    const [first, second] = await Promise.all([
      restoreSessionArchive(target.services, stream(bytes), limits, new AbortController().signal),
      restoreSessionArchive(target.services, stream(bytes), limits, new AbortController().signal),
    ])
    const sessionStatuses = [first, second].flatMap(result => result.outcomes
      .filter(outcome => outcome.id === String(id) && outcome.kind === 'session').map(outcome => outcome.status))
    expect(sessionStatuses.sort()).toEqual(['already-imported', 'imported'])
    expect(await target.services.sessionPersistence.list()).toHaveLength(1)
    expect(first.journalPath).toBe(second.journalPath)
    const journalRoot = target.services.journalRoot
    if (journalRoot === undefined) throw new Error('Test profile has no archive journal root.')
    const journal = JSON.parse(await readFile(join(journalRoot, basename(first.journalPath)), 'utf8')) as {
      sessions: Record<string, string>
    }
    expect(journal.sessions[String(id)]).toBe('imported')
  })

  it('attaches an imported Session to an existing matching Workspace and retries failed assignment', async () => {
    const source = await mounted()
    const cwd = await root()
    const id = SessionId(randomUUID())
    await createSession(source.services, id, [{ type: 'text', text: 'workspace restore' }], cwd)
    const archive = new Map<string, Uint8Array>()
    for await (const entry of sessionArchiveEntries(source.services)) archive.set(entry.path, await entryBytes(entry))
    const bytes = await zipOf(archive)
    const target = await mounted({ workspaceRegistry: true })

    const first = await restoreSessionArchive(target.services, stream(bytes), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)
    expect(first.partial).toBe(true)
    expect(first.outcomes).toContainEqual(expect.objectContaining({
      id: String(id), kind: 'workspace', status: 'failed', detail: expect.stringContaining('No existing Workspace') as string,
    }))
    expect(target.ctx.workspaceRegistry.list()).toHaveLength(0)
    expect(await target.services.sessionPersistence.stat(id)).toBeDefined()

    const workspace = await target.ctx.workspaceRegistry.create(cwd)
    const retried = await restoreSessionArchive(target.services, stream(bytes), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)
    expect(retried.partial).toBe(false)
    expect(retried.outcomes).toContainEqual(expect.objectContaining({
      id: String(id), kind: 'session', status: 'already-imported',
    }))
    expect(retried.outcomes).toContainEqual(expect.objectContaining({
      id: String(id), kind: 'workspace', status: 'attached',
    }))
    expect(workspace.sessionIds).toContain(id)
    const repeated = await restoreSessionArchive(target.services, stream(bytes), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)
    expect(repeated.partial).toBe(false)
    expect(repeated.outcomes).toContainEqual(expect.objectContaining({
      id: String(id), kind: 'workspace', status: 'attached',
    }))
    await target.ctx.workspaceRegistry.delete(workspace.id)
    const afterWorkspaceRemoval = await restoreSessionArchive(target.services, stream(bytes), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)
    expect(afterWorkspaceRemoval.partial).toBe(true)
    expect(afterWorkspaceRemoval.outcomes).toContainEqual(expect.objectContaining({
      id: String(id), kind: 'workspace', status: 'failed', detail: expect.stringContaining('No existing Workspace') as string,
    }))
    const replacement = await target.ctx.workspaceRegistry.create(cwd)
    const afterRecreation = await restoreSessionArchive(target.services, stream(bytes), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)
    expect(afterRecreation.partial).toBe(false)
    expect(replacement.sessionIds).toContain(id)
    const journal = JSON.parse(await readFile(join(target.services.journalRoot!, basename(retried.journalPath)), 'utf8')) as {
      workspaces: Record<string, string>
    }
    expect(journal.workspaces[String(id)]).toBe('attached')
  })

  it('reports Sessions without cwd or a resolvable directory as unassigned without creating paths', async () => {
    const source = await mounted()
    const missingDirectory = join(await root(), 'not-created')
    const withoutCwd = SessionId(randomUUID())
    const missingCwd = SessionId(randomUUID())
    await createSession(source.services, withoutCwd, [])
    await createSession(source.services, missingCwd, [], missingDirectory)
    const archive = new Map<string, Uint8Array>()
    for await (const entry of sessionArchiveEntries(source.services)) archive.set(entry.path, await entryBytes(entry))
    const target = await mounted({ workspaceRegistry: true })
    const result = await restoreSessionArchive(target.services, stream(await zipOf(archive)), {
      maxArchiveBytes: 1024 * 1024, maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024, maxImageBytes: 1024 * 1024,
    }, new AbortController().signal)
    expect(result.partial).toBe(true)
    expect(result.outcomes).toContainEqual(expect.objectContaining({
      id: String(withoutCwd), kind: 'workspace', status: 'failed', detail: expect.stringContaining('no cwd') as string,
    }))
    expect(result.outcomes).toContainEqual(expect.objectContaining({
      id: String(missingCwd), kind: 'workspace', status: 'failed', detail: expect.stringContaining('does not resolve') as string,
    }))
    await expect(readdir(missingDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(target.ctx.workspaceRegistry.list()).toHaveLength(0)
  })

  it('retries a journaled Session when its valid header uses a different JSON key order', async () => {
    const target = await mounted()
    const id = SessionId(randomUUID())
    const path = `sessions/00000000/${SESSION_LOG_FILENAME}`
    const log = `${JSON.stringify({ isSeeded: false, delegationDepth: 0, createdAt: 12, id, version: SESSION_FORMAT_VERSION, type: 'session' })}\n`
    const entries = new Map<string, Uint8Array>([
      ['manifest.json', strToU8(manifestFor(id, path, log))],
      [path, strToU8(log)],
    ])
    const bytes = await zipOf(entries)
    const limits = {
      maxArchiveBytes: 1024 * 1024,
      maxExpandedBytes: 2 * 1024 * 1024,
      maxSessionLogBytes: 1024 * 1024,
      maxImageBytes: 1024 * 1024,
    }

    const first = await restoreSessionArchive(target.services, stream(bytes), limits, new AbortController().signal)
    const second = await restoreSessionArchive(target.services, stream(bytes), limits, new AbortController().signal)

    expect(first.outcomes).toContainEqual(expect.objectContaining({ id: String(id), status: 'imported' }))
    expect(second.outcomes).toContainEqual(expect.objectContaining({ id: String(id), status: 'already-imported' }))
  })
})

async function collect(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = []
  for await (const part of chunks) parts.push(part)
  return new Uint8Array(Buffer.concat(parts))
}

async function entryBytes(entry: SessionArchiveZipEntry): Promise<Uint8Array> {
  if ('content' in entry) return strToU8(entry.content)
  if ('data' in entry) return entry.data
  return collect(entry.chunks)
}
