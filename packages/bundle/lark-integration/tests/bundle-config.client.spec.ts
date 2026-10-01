import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, LARK_CONFIG_NS } from '../src/client/index.ts'

describe('Lark integration bundle detail configuration', () => {
  it('registers under its bundle key only while Host configuration is served', async () => {
    const ctx = new Context()
    let disposeRoot: (() => void) | undefined
    try {
      await ctx.plugin(SlotRegistry).await()
      const locale = new LocaleRuntime(ctx)
      locale.setLocale('en')
      ctx.provide('locale', locale)
      const statusWatch = vi.fn(async () => (async function* () {
        yield { state: 'connected' as const }
      })())
      const remote = new TestRemote(ctx, {
        settings: { describe: async () => ({ ok: true as const, value: { writable: true, hasDocument: true,
          namespaces: [{ ns: LARK_CONFIG_NS, schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 1 }] } }) },
        credentials: {
          describe: async () => ({ ok: true as const, value: {} }),
          set: async () => ({ ok: true as const, value: undefined }),
        },
        larkStatus: { watch: statusWatch },
        larkSetup: { describePendingUserAuthorization: async () => ({ ok: true as const, value: { exists: false as const } }) },
      })
      const statusStream = {
        async *[Symbol.asyncIterator]() {
          yield { value: { state: 'connected' as const }, accept: vi.fn() }
        },
        dispose: vi.fn(async () => {}),
      }
      const mountRemote = vi.fn(async () => vi.fn(async () => {}))
      Object.assign(remote, {
        $mount: mountRemote,
        $stream: vi.fn((options: { open: (signal: AbortSignal) => unknown }) => {
          void options.open(new AbortController().signal)
          return statusStream
        }),
      })
      await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
      disposeRoot = ctx.slots.register({
        name: 'root', children: { 'plugins.bundle.config': { kind: 'keyed', scope: 'root' } },
      } as never, () => null)
      const fiber = ctx.plugin({ inject: [...inject], apply })
      await fiber.await()
      await vi.waitFor(() => { expect(ctx.slots.entries('plugins.bundle.config')).toHaveLength(1) })
      expect(ctx.slots.entries('plugins.bundle.config')[0]?.options).toMatchObject({
        key: '@deepseek-ai/dsh-lark-integration',
      })
      expect(mountRemote).toHaveBeenCalledOnce()
      expect(statusWatch).toHaveBeenCalledOnce()
      await fiber.dispose()
      expect(ctx.slots.entries('plugins.bundle.config')).toHaveLength(0)
    } finally {
      disposeRoot?.()
      await ctx.fiber.dispose()
    }
  })
})
