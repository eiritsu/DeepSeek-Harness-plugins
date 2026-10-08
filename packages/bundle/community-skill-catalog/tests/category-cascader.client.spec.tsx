// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { en } from '../src/client/locales.ts'
import { CategoryCascader } from '../src/client/CategoryCascader.tsx'
import type { CategoryCascaderProps, CategoryOption } from '../src/client/CategoryCascader.tsx'

afterEach(cleanup)

/** Every localized label the picker takes; selection state stays with each test. */
const labels = {
  label: en.category,
  allLabel: en.allCategories,
  otherGroupLabel: en.otherCategories,
  searchLabel: en.searchCategories,
  noResultsLabel: en.noFilterOptions,
  domainsLabel: en.categoryDomains,
  categoriesLabel: en.categoryOptions,
  backLabel: en.backToDomains,
} satisfies Omit<CategoryCascaderProps, 'value' | 'options' | 'onChange'>

const allLabel = `${en.category}: ${en.allCategories}`

/** A controlled picker: commits feed the value back so the trigger shows the chosen name. */
function CategoryHarness({ options, onChange = vi.fn() }: {
  readonly options: readonly CategoryOption[]
  readonly onChange?: (slug: string) => void
}) {
  const [value, setValue] = useState('')
  return <CategoryCascader {...labels} value={value} options={options} onChange={(slug) => { setValue(slug); onChange(slug) }} />
}

/** Open the picker from its trigger. */
function openPicker(name = allLabel): void {
  fireEvent.click(screen.getByRole('combobox', { name }))
}

describe('CategoryCascader', () => {
  const development: readonly CategoryOption[] = [
    { slug: 'architecture', name: 'Architecture patterns', group: 'Development' },
    { slug: 'backend', name: 'Backend development', group: 'Development' },
    { slug: 'cms', name: 'CMS', group: 'Development' },
    { slug: 'analytics', name: 'Analytics', group: 'Data' },
  ]

  it('lists domains first, then subcategory names without repeating the domain', () => {
    render(<CategoryHarness options={development} />)
    openPicker()
    const domains = screen.getByRole('listbox', { name: en.categoryDomains })
    expect(within(domains).getAllByRole('option').map(option => option.textContent)).toEqual(['Development', 'Data'])

    fireEvent.click(within(domains).getByRole('option', { name: 'Development' }))
    expect(screen.queryByText('Development')).toBeNull()

    const subcategories = within(screen.getByRole('listbox', { name: en.categoryOptions })).getAllByRole('option')
    expect(subcategories.map(option => option.textContent)).toEqual(['Architecture patterns', 'Backend development', 'CMS'])
    for (const option of subcategories) expect(option.getAttribute('aria-label')).toBe(option.textContent)
  })

  it('groups options with no source domain under the localized fallback', () => {
    const mixed: readonly CategoryOption[] = [
      { slug: 'architecture', name: 'Architecture patterns', group: 'Development' },
      { slug: 'misc', name: 'Miscellaneous' },
    ]
    render(<CategoryHarness options={mixed} />)
    openPicker()
    const domains = within(screen.getByRole('listbox', { name: en.categoryDomains })).getAllByRole('option')
    expect(domains.map(option => option.textContent)).toEqual(['Development', en.otherCategories])

    fireEvent.click(screen.getByRole('option', { name: en.otherCategories }))
    expect(within(screen.getByRole('listbox', { name: en.categoryOptions })).getByRole('option', { name: 'Miscellaneous' })).toBeTruthy()
  })

  it('drills in, back out, commits the selected slug, and closes on escape', () => {
    const onChange = vi.fn()
    render(<CategoryHarness options={development} onChange={onChange} />)
    openPicker()
    const search = screen.getByRole('searchbox', { name: en.searchCategories })

    fireEvent.keyDown(search, { key: 'Tab' })
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.getByRole('listbox', { name: en.categoryOptions })).toBeTruthy()
    fireEvent.keyDown(search, { key: 'ArrowLeft' })
    expect(screen.getByRole('listbox', { name: en.categoryDomains })).toBeTruthy()

    fireEvent.keyDown(search, { key: 'ArrowRight' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('backend')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('combobox', { name: `${en.category}: Backend development` })).toBeTruthy()

    onChange.mockClear()
    openPicker(`${en.category}: Backend development`)
    fireEvent.keyDown(screen.getByRole('searchbox', { name: en.searchCategories }), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('keeps the source domain on search-match rows, where several domains mix', () => {
    const searchable: readonly CategoryOption[] = [
      { slug: 'arch', name: 'Architecture patterns', group: 'Development' },
      { slug: 'analytics', name: 'Analytics', group: 'Data' },
      { slug: 'misc', name: 'Miscellaneous' },
    ]
    const onChange = vi.fn()
    render(<CategoryHarness options={searchable} onChange={onChange} />)
    openPicker()
    fireEvent.change(screen.getByRole('searchbox', { name: en.searchCategories }), { target: { value: 'a' } })
    expect(screen.getByRole('option', { name: 'Architecture patterns, Development' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Analytics, Data' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Miscellaneous' })).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('searchbox', { name: en.searchCategories }), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('arch')
  })

  it('marks the committed option, clears the selection, and returns from a group', () => {
    const onChange = vi.fn()
    render(<CategoryCascader {...labels} value="backend" options={development} onChange={onChange} />)
    openPicker(`${en.category}: Backend development`)
    fireEvent.click(screen.getByRole('option', { name: 'Development' }))
    const backend = screen.getByRole('option', { name: 'Backend development' })
    expect(backend.getAttribute('aria-selected')).toBe('true')
    fireEvent.mouseDown(backend)

    const back = screen.getByRole('button', { name: en.backToDomains })
    fireEvent.mouseDown(back)
    fireEvent.click(back)
    expect(screen.getByRole('listbox', { name: en.categoryDomains })).toBeTruthy()

    const clear = screen.getByRole('button', { name: en.allCategories })
    fireEvent.mouseDown(clear)
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('closes when focus leaves the picker and stays open on focus within it', () => {
    render(<div>
      <CategoryHarness options={development} />
      <button type="button">outside</button>
    </div>)
    openPicker()
    const search = screen.getByRole('searchbox', { name: en.searchCategories })
    fireEvent.blur(search, { relatedTarget: screen.getByRole('combobox') })
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.blur(search, { relatedTarget: screen.getByRole('button', { name: 'outside' }) })
    expect(screen.queryByRole('listbox')).toBeNull()

    openPicker()
    fireEvent.blur(screen.getByRole('searchbox', { name: en.searchCategories }))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('renders a replacement Host taxonomy and empties a vanished group', () => {
    const onChange = vi.fn()
    const first: readonly CategoryOption[] = [{ slug: 'alpha', name: 'Alpha category', group: 'Domain one' }]
    const second: readonly CategoryOption[] = [
      { slug: 'beta', name: 'Beta category', group: 'Domain two' },
      { slug: 'gamma', name: 'Gamma category', group: 'Domain two' },
    ]
    const view = render(<CategoryCascader {...labels} value="" options={first} onChange={onChange} />)
    openPicker()
    expect(screen.getByRole('option', { name: 'Domain one' })).toBeTruthy()

    view.rerender(<CategoryCascader {...labels} value="" options={second} onChange={onChange} />)
    expect(screen.queryByRole('option', { name: 'Domain one' })).toBeNull()
    expect(screen.getByRole('option', { name: 'Domain two' })).toBeTruthy()

    fireEvent.click(screen.getByRole('option', { name: 'Domain two' }))
    expect(within(screen.getByRole('listbox', { name: en.categoryOptions })).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Beta category', 'Gamma category'])

    view.rerender(<CategoryCascader {...labels} value="" options={first} onChange={onChange} />)
    expect(screen.getByRole('status').textContent).toBe(en.noFilterOptions)
  })
})
