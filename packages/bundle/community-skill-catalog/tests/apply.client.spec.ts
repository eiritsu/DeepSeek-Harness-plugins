// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ClientRoster, createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import type { ClientPluginModule } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
vi.mock('@deepseek-ai/dsh-community-skill-catalog/remote', async importOriginal => await importOriginal())
import { apply, inject } from '../src/client/index.ts'

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

assembled('registers the Skills page in the production Plugins composition', async ({ start }) => {
  const client = await start()
  expect(client.ctx.slots.entries('plugins.item').map(entry => entry.options.id)).toContain('installed-skills')
}, 60_000)

it('mounts its Remote before waiting for the namespace and registering the sidebar action', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))

  const mount = vi.fn(async () => {
    ctx.provide('remote.skillHubCatalog', {})
    return async () => {}
  })
  ctx.provide('remote', { $mount: mount } as never)
  expect(inject).not.toContain('remote.skillHubCatalog')

  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'sidebar.footer.action': { kind: 'list', scope: 'root' },
    'shell.overlay': { kind: 'list', scope: 'root' },
    'plugins.item': { kind: 'list', scope: 'root' },
  } } as never, () => null)

  await ctx.plugin({ inject: [...inject], apply }).await()

  expect(mount).toHaveBeenCalledOnce()
  expect(slots.entries('sidebar.footer.action').map(entry => entry.options.id)).toContain('skill-catalog')
  expect(slots.entries('plugins.item').map(entry => entry.options.id)).toContain('installed-skills')
})
