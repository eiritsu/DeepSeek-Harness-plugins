// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { PluginCatalogPanel } from '../src/client/PluginCatalogPanel.tsx'

afterEach(cleanup)

const spec = '@acme/dsh-example'

/** Translate a locale key with `{name}` substitution against the chosen dictionary. */
const makeTranslate = (dict: Record<string, string>) => (key: string, values?: Record<string, string | number>): string =>
  Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    dict[key] ?? key,
  )

const translate = makeTranslate(en)
const translateZh = makeTranslate(zh)

function setup(install: string = `dsh plugin --profile web add ${spec}`,
  translate: (key: string, values?: Record<string, string | number>) => string = key => key) {
  const openInstall = vi.fn()
  const close = vi.fn()
  const catalog = {
    catalog: vi.fn(async () => ({
      ok: true as const,
      value: {
        plugins: [{
          id: 'example', name: 'Example', owner: 'acme', url: 'https://github.com/acme/example', category: 'tools',
          description: { en: 'Example plugin', zh: '示例插件' },
          install, added: '2026-01-01', stars: 1, installCount: 1,
          npmDownloads7d: null, pushedAt: '', updatedAt: '',
        }],
        categories: [], total: 1, totalPages: 1, page: 1, limit: 20,
      },
    })),
  }
  const useStore = (select: (state: { open: boolean }) => unknown): unknown => select({ open: true })
  render(createElement(PluginCatalogPanel, {
    api: catalog,
    openInstall,
    language: () => 'en',
    useStore,
    actions: { close },
    t: translate,
  } as never))
  return { openInstall, close }
}

it('hands the parsed spec to the install navigation fallback without closing the catalog when pluginManager is absent', async () => {
  const { openInstall, close } = setup(undefined, translate)
  fireEvent.click(await screen.findByRole('button', { name: en.install }))
  expect(openInstall).toHaveBeenCalledOnce()
  expect(openInstall).toHaveBeenCalledWith(spec, { autoRun: true })
  expect(close).not.toHaveBeenCalled()
})

it('keeps the catalog open and reports an unusable install command', async () => {
  const { openInstall, close } = setup('dsh plugin --profile web add /absolute/path', translate)
  fireEvent.click(await screen.findByRole('button', { name: en.install }))
  expect(openInstall).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(await screen.findByRole('alert')).toBeTruthy()
})

it('uses a concise search action and labels each catalog statistic', async () => {
  setup(undefined, translate)
  expect(await screen.findByRole('button', { name: en.search })).toBeTruthy()
  expect(screen.getByRole('searchbox', { name: en.searchPlaceholder })).toBeTruthy()
  expect(screen.getByText('Stars: 1')).toBeTruthy()
  expect(screen.getByText('1 installs')).toBeTruthy()
  expect(screen.getByLabelText('Added 2026-01-01')).toBeTruthy()
})

it('runs the official installation pipeline, displays logs, and completes successfully', async () => {
  const installBundle = vi.fn(async () => ({ ok: true, value: { bundle: spec } }))
  const setBundleEnabled = vi.fn(async () => {})
  const catalog = {
    catalog: vi.fn(async () => ({
      ok: true as const,
      value: {
        plugins: [{
          id: 'example', name: 'Example', owner: 'acme', url: 'https://github.com/acme/example', category: 'tools',
          description: { en: 'Example plugin', zh: '示例插件' },
          install: `dsh plugin --profile web add ${spec}`, added: '2026-01-01', stars: 1, installCount: 1,
          npmDownloads7d: null, pushedAt: '', updatedAt: '',
        }],
        categories: [], total: 1, totalPages: 1, page: 1, limit: 20,
      },
    })),
  }
  let logSubscriber: ((chunk: { data: string }) => void) | undefined
  const onInstallLog = (cb: (chunk: { data: string }) => void) => {
    logSubscriber = cb
    return () => {}
  }
  const openInstall = vi.fn()
  const useStore = (select: (state: { open: boolean }) => unknown): unknown => select({ open: true })
  render(createElement(PluginCatalogPanel, {
    api: catalog,
    pluginManager: { installBundle, setBundleEnabled },
    openInstall,
    onInstallLog,
    language: () => 'zh',
    useStore,
    actions: { close: vi.fn() },
    t: translateZh,
  } as never))

  fireEvent.click(await screen.findByRole('button', { name: zh.install }))
  expect(openInstall).not.toHaveBeenCalled()
  expect(await screen.findByRole('heading', { name: '添加插件' })).toBeTruthy()

  logSubscriber?.({ data: 'Downloading packages...\n' })
  expect(await screen.findByText('插件安装成功！已在 Profile 中启用。')).toBeTruthy()
  expect(installBundle).toHaveBeenCalledWith(spec, expect.objectContaining({ enabled: true }))

  // Clicking "完成" closes the install dialog
  fireEvent.click(screen.getByRole('button', { name: '完成' }))
  expect(screen.queryByRole('heading', { name: '添加插件' })).toBeNull()

  // The catalog card button now reflects '已安装'
  expect(screen.getByRole('button', { name: '已安装' })).toHaveProperty('disabled', true)
})

it('displays error details and allows retry when installation fails', async () => {
  let callCount = 0
  const installBundle = vi.fn(async () => {
    callCount++
    if (callCount === 1) {
      return { ok: false, error: { message: 'Network connection failed' } }
    }
    return { ok: true, value: { bundle: spec } }
  })
  const catalog = {
    catalog: vi.fn(async () => ({
      ok: true as const,
      value: {
        plugins: [{
          id: 'example', name: 'Example', owner: 'acme', url: 'https://github.com/acme/example', category: 'tools',
          description: { en: 'Example plugin', zh: '示例插件' },
          install: `dsh plugin --profile web add ${spec}`, added: '2026-01-01', stars: 1, installCount: 1,
          npmDownloads7d: null, pushedAt: '', updatedAt: '',
        }],
        categories: [], total: 1, totalPages: 1, page: 1, limit: 20,
      },
    })),
  }
  const useStore = (select: (state: { open: boolean }) => unknown): unknown => select({ open: true })
  render(createElement(PluginCatalogPanel, {
    api: catalog,
    pluginManager: { installBundle },
    language: () => 'zh',
    useStore,
    actions: { close: vi.fn() },
    t: translateZh,
  } as never))

  fireEvent.click(await screen.findByRole('button', { name: zh.install }))
  expect(await screen.findByText('Network connection failed')).toBeTruthy()

  // Clicking "重试" triggers installBundle again
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  expect(await screen.findByText('插件安装成功！已在 Profile 中启用。')).toBeTruthy()
  expect(installBundle).toHaveBeenCalledTimes(2)
})

it('treats ChangeResult application: failed as installation failure', async () => {
  const installBundle = vi.fn(async () => ({
    ok: true,
    value: { application: 'failed', changed: false, stage: 'install', target: spec, error: { code: 'operation-error', diagnostic: 'pnpm add exited with 1' } },
  }))
  const catalog = {
    catalog: vi.fn(async () => ({
      ok: true as const,
      value: {
        plugins: [{
          id: 'example', name: 'Example', owner: 'acme', url: 'https://github.com/acme/example', category: 'tools',
          description: { en: 'Example plugin', zh: '示例插件' },
          install: `dsh plugin --profile web add ${spec}`, added: '2026-01-01', stars: 1, installCount: 1,
          npmDownloads7d: null, pushedAt: '', updatedAt: '',
        }],
        categories: [], total: 1, totalPages: 1, page: 1, limit: 20,
      },
    })),
  }
  const useStore = (select: (state: { open: boolean }) => unknown): unknown => select({ open: true })
  render(createElement(PluginCatalogPanel, {
    api: catalog,
    pluginManager: { installBundle },
    language: () => 'zh',
    useStore,
    actions: { close: vi.fn() },
    t: translateZh,
  } as never))

  fireEvent.click(await screen.findByRole('button', { name: zh.install }))
  expect(await screen.findByText('pnpm add exited with 1')).toBeTruthy()
})
