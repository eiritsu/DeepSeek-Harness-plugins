// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ClientRoster, createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import type { ClientPluginModule } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
vi.mock('@deepseek-ai/dsh-community-plugin-catalog/remote', async importOriginal => await importOriginal())
import { apply, inject } from '../src/client/plugin-catalog.ts'

afterEach(() => { vi.restoreAllMocks() })

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
  name: string
  dsh: { client: { inject: string[] } }
}
const composedModule: ClientPluginModule = {
  inject,
  apply,
}
const assembled = createClientTest({ roster: ClientRoster.of([...webApp.rows, {
  name: manifest.name, inject: manifest.dsh.client.inject, immediately: false,
}]), provide: { [manifest.name]: composedModule } }, { mount: true })

assembled('registers the sidebar action in the production composition and completes in-dialog install', async ({ start, mock }) => {
  const client = await start()
  mock.unary('pluginManager/listBundles', { ok: true, value: [] })
  mock.unary('pluginManager/installBundle', { ok: true, value: { application: 'applied', changed: true, bundle: '@acme/dsh-example' } })
  mock.unary('pluginManager/setBundleEnabled', { ok: true, value: { application: 'applied', changed: true } })
  mock.unary('pluginCatalog/catalog', {
    ok: true,
    value: {
      plugins: [{
        id: 'dsh-example',
        name: 'Example',
        owner: 'acme',
        url: 'https://github.com/acme/example',
        category: 'tools',
        description: { en: 'Example plugin', zh: '示例插件' },
        install: '@acme/dsh-example',
        added: '2026-01-01',
        stars: 1,
        installCount: 1,
        npmDownloads7d: null,
        pushedAt: '',
        updatedAt: '',
      }],
      categories: [],
      total: 1,
      totalPages: 1,
      page: 1,
      limit: 20,
    },
  })
  expect(client.ctx.slots.entries('sidebar.footer.action').map(entry => entry.options.id)).toContain('plugin-catalog')
  const actionButton = document.querySelector('button[aria-label="Community Plugins"]') ?? document.querySelector('button[aria-label="社区插件"]')
  expect(actionButton).toBeTruthy()
  fireEvent.click(actionButton!)
  const closeCatalog = document.querySelector('button[aria-label="Close community plugins"]') ?? document.querySelector('button[aria-label="关闭社区插件"]')
  expect(closeCatalog).toBeTruthy()
  const installButton = await screen.findByRole('button', { name: /^(?:Install|安装)$/ })
  fireEvent.click(installButton)
  expect(await screen.findByText(/Plugin successfully installed|插件安装成功/)).toBeTruthy()
  expect(document.body.contains(closeCatalog)).toBe(true)
}, 60_000)


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
    'plugins.add.actions': { kind: 'list', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  } } as never, () => null)

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  expect(mount).toHaveBeenCalledOnce()
  expect(slots.entries('sidebar.footer.action').map(entry => entry.options.id)).toContain('plugin-catalog')
  expect(slots.entries('plugins.add.actions').map(entry => entry.options.id)).toContain('community-plugin-catalog')
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

it('loads successfully without pluginNavigation at startup and registers sidebar action and overlay', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))

  const mount = vi.fn(async () => {
    ctx.provide('remote.pluginCatalog', { catalog: vi.fn() })
    return async () => {}
  })
  ctx.provide('remote', { $mount: mount } as never)

  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
    'plugins.add.actions': { kind: 'list', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
  } } as never, () => null)

  expect(inject).toEqual(['slots', 'locale', 'remote'])
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()

  expect(mount).toHaveBeenCalledOnce()
  expect(slots.entries('sidebar.footer.action').map(entry => entry.options.id)).toContain('plugin-catalog')
  expect(slots.entries('plugins.add.actions').map(entry => entry.options.id)).toContain('community-plugin-catalog')
  expect(slots.entries('shell.overlay').map(entry => entry.options.id)).toContain('plugin-catalog')
})
