import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('configuration and skills backup bundle detail registration', () => {
  it('registers backup controls under this bundle package key and disposes them', async () => {
    const ctx = new Context()
    let disposeRoot: (() => void) | undefined
    try {
      await ctx.plugin(SlotRegistry).await()
      const locale = new LocaleRuntime(ctx)
      locale.setLocale('en')
      ctx.provide('locale', locale)
      disposeRoot = ctx.slots.register({
        name: 'root', children: { 'plugins.bundle.config': { kind: 'keyed', scope: 'root' } },
      } as never, () => null)

      const fiber = ctx.plugin({ name: 'configuration-backup-client-test', inject: ['slots', 'locale'], apply })
      await fiber.await()
      expect(ctx.slots.entries('plugins.bundle.config')).toHaveLength(1)
      expect(ctx.slots.entries('plugins.bundle.config')[0]?.options).toMatchObject({
        key: '@deepseek-ai/dsh-configuration-and-skills-backup',
      })

      await fiber.dispose()
      expect(ctx.slots.entries('plugins.bundle.config')).toHaveLength(0)
    } finally {
      disposeRoot?.()
      await ctx.fiber.dispose()
    }
  })
})
