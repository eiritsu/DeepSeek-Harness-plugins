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
  expect(css.match(/\.title\s*\{([^}]*)\}/u)?.[1]).toContain('font-size: 18px;')
  expect(css.match(/\.confirmDialog\s*\{([^}]*)\}/u)?.[1]).toContain('font-size: 13px;')
})

it('defines dual-source pill and segmented filter chrome cleanly', () => {
  expect(css).toContain('.segmentedGroup')
  expect(css).toContain('.categories')
  expect(css).toContain('.list')
  expect(css).toContain('.badgeDual')
  expect(css).toContain('.badgeInstalled')
})
