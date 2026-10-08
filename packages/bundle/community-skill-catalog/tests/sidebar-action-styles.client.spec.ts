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

it('marks cancellation with the theme error color', () => {
  const cancel = css.match(/\.cancelButton\s*\{([^}]*)\}/)?.[1] ?? ''
  expect(cancel).toContain('border-color: var(--dsw-alias-state-error-primary)')
  expect(cancel).toContain('color: var(--dsw-alias-state-error-primary)')
})

it('sets catalog and confirmation typography inside their own overlays', () => {
  expect(css.match(/\.dialog\s*\{([^}]*)\}/u)?.[1]).toContain('font-size: 13px;')
  expect(css.match(/\.panel\s*\{([^}]*)\}/u)?.[1]).toContain('font-size: 13px;')
  expect(css.match(/\.panel button,.confirmDialog button\s*\{([^}]*)\}/u)?.[1]).toContain('height: 32px;')
  expect(css.match(/\.title\s*\{([^}]*)\}/u)?.[1]).toContain('font-size: 18px;')
  expect(css.match(/\.confirmDialog\s*\{([^}]*)\}/u)?.[1]).toContain('font-size: 13px;')
})

it('keeps the occupation menu field-anchored, viewport-bounded, and portal-ready', () => {
  const menu = css.match(/\.occupationMenu\s*\{([^}]*)\}/u)?.[1] ?? ''
  expect(menu).toContain('position: fixed;')
  expect(menu).toContain('z-index: 1100;')
  expect(menu).toContain('width: min(640px, calc(100vw - 24px));')
  expect(menu).toContain('max-height: min(360px, calc(100vh - 24px));')
  expect(menu).toContain('font-size: 13px;')
  expect(menu).toContain('container-name: occupation-picker;')
})

it('gives the occupation name the free width and keeps its SOC code and count on one line', () => {
  const row = css.match(/\.occupationRow\s*\{([^}]*)\}/u)?.[1] ?? ''
  const name = css.match(/\.occupationRowName\s*\{([^}]*)\}/u)?.[1] ?? ''
  const code = css.match(/\.occupationRowCode\s*\{([^}]*)\}/u)?.[1] ?? ''
  const count = css.match(/\.occupationRowCount\s*\{([^}]*)\}/u)?.[1] ?? ''
  expect(row).toContain('grid-template-columns: auto minmax(0, 1fr) auto auto;')
  expect(row).toContain('min-height: 34px;')
  expect(name).toContain('-webkit-line-clamp: 2;')
  expect(code).toContain('white-space: nowrap;')
  expect(code).toContain('font: 12px')
  expect(count).toContain('font-size: 12px;')
  expect(css).toContain('@container occupation-picker (max-width: 520px)')
})

it('hides an undrilled occupation column and keeps its header controls', () => {
  expect(css).toContain('.occupationColumn[hidden] { display: none; }')
  const header = css.match(/\.occupationColumnHeader\s*\{([^}]*)\}/u)?.[1] ?? ''
  const button = css.match(/\.occupationHeaderButton\s*\{([^}]*)\}/u)?.[1] ?? ''
  expect(header).toContain('display: flex;')
  expect(button).toContain('width: 28px;')
  expect(button).toContain('height: 28px;')
})
