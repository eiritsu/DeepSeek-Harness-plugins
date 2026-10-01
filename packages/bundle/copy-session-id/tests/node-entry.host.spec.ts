import { Context, FiberState } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('copy-session-id Host entry', () => {
  it('activates the package root while the Client loader owns browser activation', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ name: '@deepseek-ai/dsh-copy-session-id', apply })
    await fiber.await()
    expect(fiber.state).toBe(FiberState.ACTIVE)
    await ctx.fiber.dispose()
  })
})
