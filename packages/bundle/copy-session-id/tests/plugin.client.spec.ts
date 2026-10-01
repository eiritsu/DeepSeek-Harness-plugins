import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CopySessionIdAction } from '../src/client/CopySessionIdAction.tsx'
import { apply, inject } from '../src/client/index.ts'

describe('ui-copy-session-id Client plugin', () => {
  it('registers one header utility in the official Session slot and disposes it with the plugin', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const registerLocale = vi.fn(() => () => {})
    ctx.provide('locale', { register: registerLocale } as never)
    ctx.slots.register({
      name: 'root',
      children: {
        'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
      },
    } as never, () => null)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(inject).toEqual(['slots', 'locale'])
    expect(registerLocale).toHaveBeenCalledOnce()
    expect(ctx.slots.entries('conversation.session.header.utilities')).toMatchObject([{
      options: { id: 'copy-session-id', order: 100 },
      locale: 'copySessionId',
      component: CopySessionIdAction,
    }])

    await fiber.dispose()
    expect(ctx.slots.entries('conversation.session.header.utilities')).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
