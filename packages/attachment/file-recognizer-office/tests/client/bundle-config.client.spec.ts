import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { NativeFileUploadPolicies } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply, inject, OFFICE_RECOGNITION_NS } from '../../src/client/index.ts'

describe('Office recognition bundle detail configuration', () => {
  it('registers its composer policy and bundle detail page only while Host configuration is served', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('nativeFileUploadPolicies', new NativeFileUploadPolicies())
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('en')
    ctx.provide('locale', locale)
    const describeSettings = async () => ({
      ok: true as const,
      value: {
        writable: true,
        hasDocument: true,
        namespaces: [{ ns: OFFICE_RECOGNITION_NS, schema: {}, value: {}, applies: 'live' as const, secrets: [], revision: 1 }],
      },
    })
    const remote = new TestRemote(ctx, {
      settings: { describe: describeSettings },
      credentials: { describe: async () => ({ ok: true as const, value: {} }), set: async () => ({ ok: true as const, value: undefined }) },
    })
    await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
    const disposeRoot = ctx.slots.register({
      name: 'root', children: {
        'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
      },
    } as never, () => null)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    await vi.waitFor(() =>{  expect(ctx.slots.entries('plugins.bundle.config')).toHaveLength(1) })
    const entry = ctx.slots.entries('plugins.bundle.config')[0]!
    expect(entry.options).toMatchObject({ key: '@deepseek-ai/dsh-file-recognizer-office' })
    expect(ctx.nativeFileUploadPolicies.accepts(new File([], 'report.docx'))).toBe(true)
    expect(ctx.nativeFileUploadPolicies.accepts(new File([], 'notes.txt'))).toBe(false)
    expect(remote).toBeDefined()

    await fiber.dispose()
    expect(ctx.slots.entries('plugins.bundle.config')).toHaveLength(0)
    expect(ctx.nativeFileUploadPolicies.accepts(new File([], 'report.docx'))).toBe(false)
    disposeRoot()
  })
})
