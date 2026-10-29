import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { ImSetupService } from '../src/setup.ts'

function makeConfig(overrides: Partial<{
  weixinEnabled: boolean
  weixinBotTokenEnv: string
  enabled: boolean
}> = {}) {
  return {
    weixinEnabled: { get: () => overrides.weixinEnabled ?? false },
    weixinBotTokenEnv: { get: () => overrides.weixinBotTokenEnv ?? 'WEIXIN_BOT_TOKEN' },
    enabled: { get: () => overrides.enabled ?? false },
  } as unknown as Config
}

describe('ImSetupService WeChat authorization', () => {
  it('persists the bot token credential and enables WeChat without returning the secret', async () => {
    const values = new Map<string, string>()
    let edited: Record<string, unknown> | undefined
    const ctx = new Context()
    ctx.provide('credentials', {
      async resolve(ref: { toString(): string }) {
        const value = values.get(String(ref))
        return value === undefined ? undefined : { value, source: 'test' }
      },
      async set(ref: { toString(): string }, value: string) { values.set(String(ref), value) },
      async unset(ref: { toString(): string }) { values.delete(String(ref)) },
    })
    ctx.provide('configEditor', {
      configuration: () => [{
        entry: { options: { id: 'im', name: 'im' } },
      }],
      edit: vi.fn(async (_entry: unknown, mutate: (current: Record<string, unknown>) => Record<string, unknown>) => {
        edited = mutate({})
      }),
    })

    const setup = new ImSetupService(ctx, makeConfig())
    const result = await setup.commitWeixinAuthorization({
      token: 'bot-token-secret',
      botId: 'bot_1',
      userId: 'user_1',
    })

    expect(result).toEqual({ ok: true, botId: 'bot_1', userId: 'user_1' })
    expect(JSON.stringify(result)).not.toContain('bot-token-secret')
    expect(values.get('WEIXIN_BOT_TOKEN')).toContain('bot-token-secret')
    expect(edited).toMatchObject({
      enabled: true,
      weixinEnabled: true,
      activePlatform: 'weixin',
      weixinBotTokenEnv: 'WEIXIN_BOT_TOKEN',
    })
  })

  it('rejects an empty token without writing credentials', async () => {
    const set = vi.fn()
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined, set, unset: async () => {} })
    ctx.provide('configEditor', { configuration: () => [], edit: vi.fn() })
    const setup = new ImSetupService(ctx, makeConfig())
    const result = await setup.commitWeixinAuthorization({ token: '   ' })
    expect(result).toEqual({ ok: false, code: 'not-configured' })
    expect(set).not.toHaveBeenCalled()
  })

  it('matches entry with package name @deepseek-ai/dsh-im-integration', async () => {
    const values = new Map<string, string>()
    let edited: Record<string, unknown> | undefined
    const ctx = new Context()
    ctx.provide('credentials', {
      async resolve(ref: { toString(): string }) {
        const value = values.get(String(ref))
        return value === undefined ? undefined : { value, source: 'test' }
      },
      async set(ref: { toString(): string }, value: string) { values.set(String(ref), value) },
      async unset(ref: { toString(): string }) { values.delete(String(ref)) },
    })
    ctx.provide('configEditor', {
      configuration: () => [{
        entry: { options: { id: '@deepseek-ai/dsh-im-integration', name: '@deepseek-ai/dsh-im-integration' } },
      }],
      edit: vi.fn(async (_entry: unknown, mutate: (current: Record<string, unknown>) => Record<string, unknown>) => {
        edited = mutate({})
      }),
    })

    const setup = new ImSetupService(ctx, makeConfig())
    const result = await setup.commitWeixinAuthorization({
      token: 'bot-token-pkg',
      botId: 'bot_pkg',
    })

    expect(result).toEqual({ ok: true, botId: 'bot_pkg' })
    expect(edited).toMatchObject({
      enabled: true,
      weixinEnabled: true,
      activePlatform: 'weixin',
    })
  })
})
