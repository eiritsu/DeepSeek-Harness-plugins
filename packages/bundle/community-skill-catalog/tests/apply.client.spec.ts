// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ClientRoster, createClientTest, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import type { ClientPluginModule } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
vi.mock('@deepseek-ai/dsh-community-skill-catalog/remote', async importOriginal => await importOriginal())
import { apply, inject } from '../src/client/index.ts'

afterEach(() => { vi.restoreAllMocks() })

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
  name: string
  dsh: { client: { inject: string[] } }
}
const composedModule: ClientPluginModule = { inject, apply }
const assembled = createClientTest({
  roster: ClientRoster.of([...webApp.rows, { name: manifest.name, inject: manifest.dsh.client.inject, immediately: false }]),
  provide: { [manifest.name]: composedModule },
}, { mount: true })

assembled('registers the Skills page and sidebar catalog and loads initial skills on open', async ({ start, mock }) => {
  const client = await start()
  mock.unary('skillCatalog/taxonomy', {
    ok: true,
    value: {
      categories: [{ id: 'frontend', count: 12 }],
      totalIndexed: 12,
      indexRepo: 'sickn33/agentic-awesome-skills',
      fetchedAt: Date.now(),
    },
  })
  mock.unary('skillCatalog/catalog', {
    ok: true,
    value: {
      items: [{
        id: 'github:sickn33/agentic-awesome-skills/skills/react-best-practices',
        name: 'react-best-practices',
        installDir: 'react-best-practices',
        skillId: 'react-best-practices',
        repo: 'sickn33/agentic-awesome-skills',
        author: 'vercel-labs/agent-skills',
        description: 'React best practices skill.',
        category: 'frontend',
        githubUrl: 'https://github.com/sickn33/agentic-awesome-skills/tree/main/skills/react-best-practices',
        url: 'https://skills.sh/vercel-labs/agent-skills/react-best-practices',
        source: 'github-index',
        sources: ['github-index', 'skills-sh'],
        installs: 887059,
      }],
      total: 1,
      totalIsExact: true,
      hasNext: false,
      page: 1,
      pageSize: 24,
      warnings: [{ source: 'skills-sh', code: 'rate-limited' }],
    },
  })
  mock.unary('skillCatalog/listInstalledSkills', { ok: true, value: [] })

  expect(client.ctx.slots.entries('plugins.item').map(entry => entry.options.id)).toContain('installed-skills')
  expect(client.ctx.slots.entries('sidebar.footer.action').map(entry => entry.options.id)).toContain('skill-catalog')

  const actionButton = document.querySelector('button[aria-label="Community Skill Catalog"]')
    ?? document.querySelector('button[aria-label="社区技能目录"]')
  expect(actionButton).toBeTruthy()
  fireEvent.click(actionButton!)

  expect(await screen.findByRole('button', { name: 'react-best-practices' })).toBeTruthy()
  expect(await screen.findByText(/rate limited|请求过于频繁/u)).toBeTruthy()
}, 60_000)

it('mounts its Remote before waiting for the namespace and registering slots', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))

  const mount = vi.fn(async () => {
    ctx.provide('remote.skillCatalog', {})
    return async () => {}
  })
  ctx.provide('remote', { $mount: mount } as never)
  expect(inject).not.toContain('remote.skillCatalog')

  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'plugins.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)

  await ctx.plugin({ inject: [...inject], apply }).await()

  expect(mount).toHaveBeenCalledOnce()
  expect(slots.entries('sidebar.footer.action').map(entry => entry.options.id)).toContain('skill-catalog')
  expect(slots.entries('plugins.item').map(entry => entry.options.id)).toContain('installed-skills')
})
