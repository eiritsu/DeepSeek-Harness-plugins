import { describe, expect, it } from 'vitest'
import { deriveOccurrences, toTask } from '../src/tasks.ts'
import type { ScheduleCatalogEntry, ScheduleRecord } from '@deepseek-ai/dsh-schedule/client'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ScheduleId } from '@deepseek-ai/dsh-schedule'

/**
 * Build a daily catalog entry.
 * @param id - Task identity.
 * @param scheduledAt - The committed next occurrence.
 * @param status - Stored lifecycle.
 * @returns the catalog entry the Host Schedule service would return.
 */
function daily(id: string, scheduledAt: string, status: 'active' | 'inactive' = 'active'): ScheduleCatalogEntry {
  return {
    id: ScheduleId(id),
    kind: 'daily',
    title: `Task ${id}`,
    prompt: 'Do the thing',
    time: '09:00:00.000',
    timeZone: 'UTC',
    scheduledAt,
    sessionId: SessionId('s-1'),
    status,
  }
}

/**
 * Build a one-shot catalog entry.
 * @param id - Task identity.
 * @param scheduledAt - The committed instant.
 * @param status - Stored lifecycle.
 * @returns the catalog entry the Host Schedule service would return.
 */
function once(id: string, scheduledAt: string, status: 'active' | 'inactive' = 'active'): ScheduleCatalogEntry {
  return {
    id: ScheduleId(id),
    kind: 'at',
    title: `Task ${id}`,
    prompt: 'Do the thing',
    scheduledAt,
    sessionId: SessionId('s-1'),
    status,
  }
}

/** An October window. */
const FROM = Date.parse('2026-10-01T00:00:00.000Z')
const TO = Date.parse('2026-11-01T00:00:00.000Z')

describe('deriveOccurrences', () => {
  it('carries the stored lifecycle onto every occurrence', () => {
    const active = deriveOccurrences([once('a', '2026-10-05T09:00:00.000Z')], FROM, TO, { perTask: 10, total: 10 })
    expect(active.occurrences[0]?.status).toBe('active')
    const ended = deriveOccurrences([once('b', '2026-10-05T09:00:00.000Z', 'inactive')], FROM, TO, { perTask: 10, total: 10 })
    // An ended task is delivered, not pending, so it must not read as armed.
    expect(ended.occurrences[0]?.status).toBe('inactive')
  })

  it('gives an ended recurring task only the occurrence it kept', () => {
    const derived = deriveOccurrences([daily('c', '2026-10-05T09:00:00.000Z', 'inactive')], FROM, TO, { perTask: 10, total: 10 })
    expect(derived.occurrences.map(item => item.startsAt)).toEqual(['2026-10-05T09:00:00.000Z'])
    expect(derived.occurrences.every(item => !item.recurring)).toBe(true)
  })

  it('keeps deriving later tasks after one hits its own ceiling', () => {
    const dense = deriveOccurrences([daily('dense', '2026-10-01T09:00:00.000Z')], FROM, TO, { perTask: 2, total: 1_000 })
    expect(dense.occurrences).toHaveLength(2)
    expect(dense.truncated).toBe(true)

    const mixed = deriveOccurrences(
      [daily('dense', '2026-10-01T09:00:00.000Z'), once('other', '2026-10-20T09:00:00.000Z')],
      FROM,
      TO,
      { perTask: 2, total: 1_000 },
    )
    // The ordinary task behind the capped one is still shown.
    expect(mixed.occurrences.map(item => item.taskId)).toEqual(['dense', 'dense', 'other'])
    expect(mixed.truncated).toBe(true)
  })

  it('stops only at the snapshot-wide ceiling', () => {
    const derived = deriveOccurrences(
      [once('a', '2026-10-05T09:00:00.000Z'), once('b', '2026-10-06T09:00:00.000Z'), once('c', '2026-10-07T09:00:00.000Z')],
      FROM,
      TO,
      { perTask: 10, total: 2 },
    )
    expect(derived.occurrences).toHaveLength(2)
    expect(derived.truncated).toBe(true)
  })

  it('reaches a rule anchored far in the past without walking its history', () => {
    const derived = deriveOccurrences([daily('long', '2018-01-01T09:00:00.000Z')], FROM, TO, { perTask: 5, total: 1_000 })
    expect(derived.occurrences[0]?.startsAt).toBe('2026-10-01T09:00:00.000Z')
    expect(derived.occurrences).toHaveLength(5)
    expect(derived.truncated).toBe(true)
  })

  it('reports a task whose stored record fails a recurrence precondition', () => {
    const broken = { ...once('broken', 'not-a-date') } as unknown as ScheduleCatalogEntry
    const derived = deriveOccurrences([broken], FROM, TO, { perTask: 10, total: 10 })
    expect(derived.occurrences).toEqual([])
    expect(derived.errors.has(broken.id)).toBe(true)
  })
})

describe('toTask', () => {
  it('keeps the bare record separate from the catalog members', () => {
    const entry = once('a', '2026-10-05T09:00:00.000Z')
    const task = toTask(entry)
    expect(task.sessionId).toBe('s-1')
    expect(task.status).toBe('active')
    // The bare record is what a Client hands back as a compare-and-update
    // value, so it carries none of the catalog's own members.
    expect(task.record).toEqual({
      id: entry.id,
      kind: 'at',
      title: entry.title,
      prompt: entry.prompt,
      scheduledAt: entry.scheduledAt,
    } satisfies Partial<ScheduleRecord>)
  })

  it('attaches the reason a task produced no occurrence', () => {
    expect(toTask(once('a', '2026-10-05T09:00:00.000Z'), 'unreadable rule')).toMatchObject({ occurrenceError: 'unreadable rule' })
  })
})
