import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubConfigForm, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import type { Settings } from '../src/client/controller.ts'

async function bench(served: boolean) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'plugins.item': { kind: 'list', scope: 'root' },
      'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)

  const form = stubConfigForm<Settings>()
  const whileServed = vi.fn((_namespaces: readonly string[], register: (current: ReadonlySet<string>) => () => void) => {
    const dispose = served ? register(new Set(['tools-connections'])) : undefined
    return () => dispose?.()
  })
  ctx.provide('configForms', {
    get: vi.fn(() => form.scope),
    whileServed,
  } as never)
  new TestRemote(ctx, {
    credentials: {
      describe: vi.fn(async (refs: string[]) => ({
        ok: true as const,
        value: Object.fromEntries(refs.map(ref => [ref, { configured: false, writable: true }])),
      })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    },
  })
  return { ctx, slots, whileServed }
}

describe('Tools & connections bundle settings registration', () => {
  it('registers under the bundle detail key rather than the official plugin group', async () => {
    const { ctx, slots, whileServed } = await bench(true)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(whileServed).toHaveBeenCalledWith(['tools-connections'], expect.any(Function))
    expect(slots.entries('plugins.item')).toHaveLength(0)
    expect(slots.entries('plugins.bundle.config')).toHaveLength(1)
    expect(slots.entries('plugins.bundle.config')[0]?.options).toMatchObject({
      key: '@deepseek-ai/dsh-tools-connections',
    })

    await fiber.dispose()
    expect(slots.entries('plugins.bundle.config')).toHaveLength(0)
  })

  it('does not register a bundle detail page when its settings namespace is not served', async () => {
    const { ctx, slots } = await bench(false)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(slots.entries('plugins.item')).toHaveLength(0)
    expect(slots.entries('plugins.bundle.config')).toHaveLength(0)

    await fiber.dispose()
  })
})
