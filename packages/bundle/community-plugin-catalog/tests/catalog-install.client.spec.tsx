// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { en } from '../src/client/locales.ts'
import { PluginCatalogPanel } from '../src/client/PluginCatalogPanel.tsx'

afterEach(cleanup)

const spec = '@acme/dsh-example'

/** Translate a locale key with `{name}` substitution against the English dictionary. */
const translate = (key: string, values?: Record<string, string | number>): string => Object.entries(values ?? {}).reduce(
  (text, [name, value]) => text.replace(`{${name}}`, String(value)),
  en[key as keyof typeof en] ?? key,
)

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

it('hands the parsed spec to the official install dialog and closes the catalog', async () => {
  const { openInstall, close } = setup(undefined, translate)
  fireEvent.click(await screen.findByRole('button', { name: en.install }))
  expect(openInstall).toHaveBeenCalledOnce()
  expect(openInstall).toHaveBeenCalledWith(spec)
  expect(close).toHaveBeenCalledOnce()
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
