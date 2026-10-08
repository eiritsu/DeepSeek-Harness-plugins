import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/PluginCatalogPage.module.css', import.meta.url)), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'u'))?.[1] ?? ''
}

it('scopes dialog typography and control sizing to the catalog', () => {
  expect(rule('.dialog')).toContain('font-size: 13px;')
  expect(rule('.panel')).toContain('font-size: 13px;')
  expect(rule('.panel')).toContain('box-sizing: border-box;')
  expect(css.match(/\.panel button\s*\{([^}]*)\}/u)?.[1]).toContain('height: 32px;')
  expect(rule('.title')).toContain('font-size: 18px;')
})

it('bounds categories and keeps result rows compact without flex growth', () => {
  expect(rule('.categories')).toContain('max-height: 72px;')
  expect(rule('.categories')).toContain('overflow-y: auto;')
  expect(rule('.row')).toContain('box-sizing: border-box;')
  expect(rule('.row')).toContain('min-height: 72px;')
  expect(rule('.row')).not.toContain('flex:')
  expect(rule('.pagination')).toContain('flex-wrap: wrap;')
  expect(css).toContain('@media (max-width: 640px)')
})
