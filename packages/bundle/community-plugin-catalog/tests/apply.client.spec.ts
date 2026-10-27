// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { apply, inject } from '../src/client/plugin-catalog.ts'

afterEach(() => { vi.restoreAllMocks() })

it('mounts its Remote, registers the overlay and invokes pluginNavigation.openInstall', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))

  const openInstall = vi.fn()
  ctx.provide('pluginNavigation', {
    openBundle: vi.fn(),
    openInstall,
  })

  const mount = vi.fn(async () => {
    ctx.provide('remote.pluginCatalog', {
      catalog: vi.fn(),
    })
    return async () => {}
  })
  ctx.provide('remote', { $mount: mount } as never)

  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  } } as never, () => null)

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  expect(mount).toHaveBeenCalledOnce()
  expect(slots.entries('sidebar.footer.action').map(entry => entry.options.id)).toContain('plugin-catalog')
  expect(slots.entries('shell.overlay').map(entry => entry.options.id)).toContain('plugin-catalog')

  const overlayEntry = slots.entries('shell.overlay').find(entry => entry.options.id === 'plugin-catalog')
  expect(overlayEntry).toBeDefined()
  const injected = overlayEntry!.inject!() as { openInstall: (spec: string) => void; language: () => string }
  expect(injected.openInstall).toBeTypeOf('function')

  // Verify openInstall correctly forwards to pluginNavigation.openInstall
  injected.openInstall('@acme/dsh-test-plugin')
  expect(openInstall).toHaveBeenCalledOnce()
  expect(openInstall).toHaveBeenCalledWith('@acme/dsh-test-plugin')
})
