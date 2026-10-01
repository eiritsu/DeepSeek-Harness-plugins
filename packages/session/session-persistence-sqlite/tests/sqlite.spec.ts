import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import SqliteSessionPersistence, { SCHEMA_VERSION } from '../src/index.ts'
import { runPersistenceContract } from '../../session-persistence/tests/contract.ts'

const contexts: Context[] = []
const directories: string[] = []

async function createPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-session-sqlite-'))
  directories.push(directory)
  return join(directory, 'sessions.sqlite')
}

async function mount(path: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SqliteSessionPersistence, { path })
  return ctx
}

afterEach(async () => {
  const results = await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length > 0) {
    throw new AggregateError(failures.map(result => result.reason instanceof Error ? result.reason : new Error(String(result.reason))))
  }
})

runPersistenceContract('sqlite', async () => {
  const path = await createPath()
  const instance = async (): Promise<{ persistence: SessionPersistence; dispose: () => Promise<void> }> => {
    const ctx = await mount(path)
    return { persistence: ctx.sessionPersistence, dispose: async () => { await ctx.fiber.dispose() } }
  }
  const primary = await instance()
  return { ...primary, reopen: instance }
})

describe('SQLite session persistence', () => {
  it('initializes only an empty unversioned database and stamps the current schema', async () => {
    const path = await createPath()
    const ctx = await mount(path)
    const database = new DatabaseSync(path, { readOnly: true })
    try {
      expect(SCHEMA_VERSION).toBe(1)
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION })
    } finally {
      database.close()
      await ctx.fiber.dispose()
    }
  })

  it('rejects a future schema before serving Sessions', async () => {
    const path = await createPath()
    const database = new DatabaseSync(path)
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    database.close()
    const ctx = new Context()
    contexts.push(ctx)
    await expect(ctx.plugin(SqliteSessionPersistence, { path })).rejects.toThrow(/unsupported SQLite schema version/)
  })

  it('rejects a nonempty unversioned database', async () => {
    const path = await createPath()
    const database = new DatabaseSync(path)
    database.exec('CREATE TABLE legacy_session_data (value TEXT)')
    database.close()
    const ctx = new Context()
    contexts.push(ctx)
    await expect(ctx.plugin(SqliteSessionPersistence, { path })).rejects.toThrow(/unversioned SQLite database is not empty/)
  })

})
