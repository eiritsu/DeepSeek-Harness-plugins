import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LarkStatus } from '../src/host/lark/status.ts'

describe('Lark connection status Remote', () => {
  it('streams the initial and latest non-sensitive states until aborted', async () => {
    const status = new LarkStatus(new Context())
    const abort = new AbortController()
    const stream = status.watch(abort.signal)[Symbol.asyncIterator]()

    await expect(stream.next()).resolves.toMatchObject({ value: { state: 'disabled' }, done: false })
    status.publish({ state: 'connecting' })
    await expect(stream.next()).resolves.toMatchObject({ value: { state: 'connecting' }, done: false })
    status.publish({ state: 'error', reason: 'missing-credential' })
    await expect(stream.next()).resolves.toMatchObject({
      value: { state: 'error', reason: 'missing-credential' }, done: false,
    })
    expect(JSON.stringify({ state: 'error', reason: 'missing-credential' })).not.toContain('secret')

    abort.abort()
    await expect(stream.next()).resolves.toMatchObject({ done: true })
  })
})
