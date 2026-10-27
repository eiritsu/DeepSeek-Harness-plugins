import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, IM_CONFIG_NS } from '../src/client/index.ts'

describe('IM integration bundle detail configuration', () => {
  it('registers under its bundle key only while Host configuration is served', async () => {
    const ctx = new Context()
    let disposeRoot: (() => void) | undefined
    try {
      await ctx.plugin(SlotRegistry).await()
      const locale = new LocaleRuntime(ctx)
      locale.setLocale('en')
      ctx.provide('locale', locale)

      new TestRemote(ctx, {
        settings: {
          describe: async () => ({
            ok: true as const,
            value: {
              writable: true,
              hasDocument: true,
              namespaces: [{
                ns: IM_CONFIG_NS,
                schema: {},
                value: {},
                applies: 'live' as const,
                secrets: [],
                revision: 1,
              }],
            },
          }),
        },
      })

      await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
      disposeRoot = ctx.slots.register({
        name: 'root',
        children: { 'plugins.bundle.config': { kind: 'keyed', scope: 'root' } },
      } as never, () => null)

      const fiber = ctx.plugin({ inject: [...inject], apply })
      await fiber.await()

      await vi.waitFor(() => {
        expect(ctx.slots.entries('plugins.bundle.config')).toHaveLength(1)
      })

      expect(ctx.slots.entries('plugins.bundle.config')[0]?.options).toMatchObject({
        key: '@deepseek-ai/dsh-im-integration',
      })

      await fiber.dispose()
      expect(ctx.slots.entries('plugins.bundle.config')).toHaveLength(0)
    } finally {
      disposeRoot?.()
    }
  })
})
