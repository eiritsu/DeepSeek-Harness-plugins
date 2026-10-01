import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SkillCatalogPage.module.css', import.meta.url)), 'utf8')

it('keeps the expanded action shrinkable and the collapsed control at 36px', () => {
  const expanded = css.match(/\.action,\s*\.actionRail\s*\{([^}]*)\}/)?.[1] ?? ''
  const rail = css.match(/\.actionRail\s*\{\s*flex:\s*none;([^}]*)\}/)?.[1] ?? ''
  expect(expanded).toContain('flex: 1 1 0;')
  expect(expanded).toContain('width: auto;')
  expect(expanded).toContain('box-sizing: border-box;')
  expect(expanded).not.toContain('width: calc(100% + 4px)')
  expect(rail).toContain('width: 36px;')
  expect(rail).toContain('height: 36px;')
})
