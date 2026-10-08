// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SkillsMpTaxonomy } from '@deepseek-ai/dsh-community-skill-catalog/types'
import { en } from '../src/client/locales.ts'
import { OccupationCascader } from '../src/client/OccupationCascader.tsx'
import css from '../src/client/SkillCatalogPage.module.css'

const taxonomy: SkillsMpTaxonomy = {
  categories: [],
  occupations: [
    { slug: 'marketing-managers', name: 'Marketing Managers', level: 1 },
    { slug: 'management-occupations', name: 'Management Occupations', level: 1, code: '11-0000', skillCount: 2 },
    { slug: 'software-developers', name: 'Software Developers', level: 1, code: '15-1252', skillCount: 2 },
    { slug: 'top-executives', name: 'Top Executives', parentId: 'management-occupations', level: 2, code: '11-1000', skillCount: 2 },
    { slug: 'computer-occupations', name: 'Computer Occupations', parentId: 'software-developers', level: 2, code: '15-1200', skillCount: 2 },
    { slug: 'chief-executives-111011', name: 'Chief Executives', parentId: 'top-executives', level: 3 },
    { slug: 'general-operations-managers-111021', name: 'General and Operations Managers', parentId: 'chief-executives-111011', level: 4, code: '11-1021', skillCount: 0 },
    { slug: 'chief-executives-111011-2', name: 'Chief Executive Officers', parentId: 'chief-executives-111011', level: 4, code: '11-1011', skillCount: 2 },
    { slug: 'web-developers', name: 'Web Developers', parentId: 'computer-occupations', level: 4, code: '15-1254', skillCount: 1 },
    { slug: 'database-administrators', name: 'Database Administrators', parentId: 'computer-occupations', level: 4, code: '15-1244', skillCount: 1 },
  ],
}

const labels = {
  selectGroup: (name: string) => en.selectOccupationGroup.replace('{name}', name),
  collapseGroup: (name: string) => en.collapseOccupationGroup.replace('{name}', name),
  expandGroup: (name: string) => en.expandOccupationGroup.replace('{name}', name),
}

/** A drilled group whose header carries no SOC code. */
const uncodedGroup: SkillsMpTaxonomy = {
  categories: [],
  occupations: [
    { slug: 'major-one', name: 'Major One', level: 1, code: '10-0000' },
    { slug: 'group-no-code', name: 'Group Without Code', parentId: 'major-one', level: 2 },
    { slug: 'group-leaf', name: 'Group Leaf', parentId: 'group-no-code', level: 4 },
  ],
}

/** Several uncoded majors beside one coded one, so source order has to survive the code partition. */
const mixedCodeMajors: SkillsMpTaxonomy = {
  categories: [],
  occupations: [
    { slug: 'zulu-uncoded', name: 'Zulu Uncoded', level: 1 },
    { slug: 'coded-major', name: 'Coded Major', level: 1, code: '33-0000' },
    { slug: 'alpha-uncoded', name: 'Alpha Uncoded', level: 1 },
    { slug: 'mike-uncoded', name: 'Mike Uncoded', level: 1 },
  ],
}

/** A leaf whose parent link points nowhere, so the ancestor walk stops early. */
const danglingParent: SkillsMpTaxonomy = {
  categories: [],
  occupations: [
    { slug: 'orphan-role', name: 'Orphan Role', parentId: 'missing-parent', level: 4, code: '99-0001' },
    { slug: 'root-major', name: 'Root Major', level: 1, code: '10-0000' },
  ],
}

/** Repeated numeric codes force the comparator's all-segments-equal return. */
const duplicateCodes: SkillsMpTaxonomy = {
  categories: [],
  occupations: [
    { slug: 'dup-a', name: 'Dup A', level: 1, code: '20-0000' },
    { slug: 'dup-b', name: 'Dup B', level: 1, code: '10-0000' },
    { slug: 'dup-c', name: 'Dup C', level: 1, code: '20-0000' },
  ],
}

/** Non-numeric codes fall back to text order and expose the equal-text comparison. */
const letterCodes: SkillsMpTaxonomy = {
  categories: [],
  occupations: [
    { slug: 'code-x', name: 'Code X', level: 1, code: 'X' },
    { slug: 'code-y', name: 'Code Y', level: 1, code: 'Y' },
    { slug: 'code-x2', name: 'Code X Two', level: 1, code: 'X' },
  ],
}

/** Render the field with a committed value and a change spy. */
function renderField(value = '', nodes: SkillsMpTaxonomy = taxonomy) {
  const onChange = vi.fn()
  const view = render(<OccupationCascader
    label={en.occupation}
    value={value}
    taxonomy={nodes}
    allLabel={en.allOccupations}
    pickerTitle={en.occupationPickerTitle}
    pickerDescription={en.occupationPickerDescription}
    searchLabel={en.searchOccupations}
    noResultsLabel={en.noFilterOptions}
    majorGroupsLabel={en.occupationMajorGroups}
    selectGroupLabel={labels.selectGroup}
    collapseGroupLabel={labels.collapseGroup}
    expandGroupLabel={labels.expandGroup}
    clearSelectionLabel={en.allOccupations}
    closeLabel={en.close}
    onChange={onChange}
  />)
  return {
    ...view,
    onChange,
    trigger: () => screen.getByRole('button', { name: new RegExp(`^${en.occupation}:`, 'u') }),
    names: (listbox: HTMLElement) => within(listbox).getAllByRole('option').map(option => option.getAttribute('aria-label')),
  }
}

afterEach(cleanup)

describe('occupation menu', () => {
  it('opens from the field and orders each level by its source SOC code', () => {
    const { trigger, names } = renderField()
    expect(screen.queryByRole('listbox', { name: en.occupationMajorGroups })).toBeNull()
    fireEvent.click(trigger())
    expect(names(screen.getByRole('listbox', { name: en.occupationMajorGroups }))).toEqual([
      'Management Occupations, 11-0000',
      'Software Developers, 15-1252',
      'Marketing Managers',
    ])
  })

  it('drills major → occupation group → occupation and commits the leaf slug', () => {
    const { onChange, trigger, names } = renderField()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('option', { name: 'Software Developers, 15-1252' }))
    const minors = screen.getByRole('listbox', { name: 'Software Developers' })
    expect(names(minors)).toEqual(['Computer Occupations, 15-1200'])
    fireEvent.click(within(minors).getByRole('option', { name: 'Computer Occupations, 15-1200' }))
    const leaves = screen.getByRole('listbox', { name: 'Computer Occupations' })
    expect(names(leaves)).toEqual(['Database Administrators, 15-1244', 'Web Developers, 15-1254'])
    fireEvent.click(within(leaves).getByRole('option', { name: 'Web Developers, 15-1254' }))
    expect(onChange).toHaveBeenCalledWith('web-developers')
    expect(screen.queryByRole('listbox', { name: 'Computer Occupations' })).toBeNull()
  })

  it('shows the committed path in the field and reopens on the group that holds it', () => {
    const { trigger } = renderField('web-developers')
    expect(trigger().textContent).toContain('Software Developers › Computer Occupations › Web Developers')
    fireEvent.click(trigger())
    expect(screen.getByRole('listbox', { name: 'Computer Occupations' })).toBeTruthy()
    expect(screen.getByRole('listbox', { name: en.occupationMajorGroups })).toBeTruthy()
  })

  it('leaves one level from a column header and commits a whole group without drilling', () => {
    const { onChange, trigger } = renderField()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('option', { name: 'Management Occupations, 11-0000' }))
    fireEvent.click(screen.getByRole('option', { name: 'Top Executives, 11-1000' }))
    expect(screen.getByRole('listbox', { name: 'Top Executives' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: labels.collapseGroup('Top Executives') }))
    expect(screen.getByRole('listbox', { name: 'Management Occupations' })).toBeTruthy()
    expect(screen.queryByRole('listbox', { name: 'Top Executives' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: labels.selectGroup('Management Occupations') }))
    expect(onChange).toHaveBeenCalledWith('management-occupations')
  })

  it('lists every occupation of a group with its count, zero included, and no intermediate level', () => {
    const { trigger, names } = renderField()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('option', { name: 'Management Occupations, 11-0000' }))
    fireEvent.click(screen.getByRole('option', { name: 'Top Executives, 11-1000' }))
    const leaves = screen.getByRole('listbox', { name: 'Top Executives' })
    expect(names(leaves)).toEqual([
      'Chief Executive Officers, 11-1011',
      'General and Operations Managers, 11-1021',
    ])
    expect(within(leaves).getByRole('option', { name: 'General and Operations Managers, 11-1021' }).textContent).toContain('0')
    expect(screen.queryAllByRole('option', { name: 'Chief Executives' })).toHaveLength(0)
  })

  it('searches the whole catalog locally and commits the highlighted hit', () => {
    const { onChange, trigger } = renderField()
    fireEvent.click(trigger())
    const search = screen.getByRole<HTMLInputElement>('combobox', { name: en.searchOccupations })
    fireEvent.change(search, { target: { value: 'database' } })
    expect(screen.getAllByRole('option', { name: /Database Administrators/u })).toHaveLength(1)
    expect(screen.getByText('Software Developers › Computer Occupations')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'web-developers' } })
    expect(screen.queryByRole('option', { name: /web-developers/u })).toBeNull()
    fireEvent.change(search, { target: { value: 'Chief Executives' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe(en.noFilterOptions)
    fireEvent.change(search, { target: { value: 'Database' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('database-administrators')
  })

  it('walks the levels with the keyboard and restores the field focus on Escape', async () => {
    const { onChange, trigger } = renderField()
    fireEvent.click(trigger())
    const search = screen.getByRole<HTMLInputElement>('combobox', { name: en.searchOccupations })
    expect(document.activeElement).toBe(search)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowRight' })
    expect(screen.getByRole('listbox', { name: 'Software Developers' })).toBeTruthy()
    fireEvent.keyDown(search, { key: 'Enter' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('web-developers')
    fireEvent.click(trigger())
    const reopened = screen.getByRole<HTMLInputElement>('combobox', { name: en.searchOccupations })
    fireEvent.keyDown(reopened, { key: 'ArrowDown' })
    fireEvent.keyDown(reopened, { key: 'ArrowRight' })
    expect(screen.queryByRole('listbox', { name: 'Computer Occupations' })).toBeNull()
    fireEvent.keyDown(reopened, { key: 'ArrowLeft' })
    expect(screen.getByRole('listbox', { name: en.occupationMajorGroups })).toBeTruthy()
    fireEvent.keyDown(reopened, { key: 'Escape' })
    await waitFor(() => { expect(document.activeElement).toBe(trigger()) })
    expect(screen.queryByRole('listbox', { name: en.occupationMajorGroups })).toBeNull()
  })

  it('adds no dialog of its own and keeps Escape away from the catalog dialog behind it', () => {
    const catalogEscape = vi.fn()
    const { trigger } = renderField()
    fireEvent.click(trigger())
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0)
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(0)
    const search = screen.getByRole<HTMLInputElement>('combobox', { name: en.searchOccupations })
    const escaped = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.addEventListener('keydown', catalogEscape)
    search.dispatchEvent(escaped)
    document.removeEventListener('keydown', catalogEscape)
    expect(escaped.defaultPrevented).toBe(true)
    expect(catalogEscape).not.toHaveBeenCalled()
  })

  it('stays open while Host taxonomy reloads and closes on an outside pointer', async () => {
    const { trigger, rerender } = renderField()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('option', { name: 'Software Developers, 15-1252' }))
    rerender(<OccupationCascader
      label={en.occupation}
      value=""
      taxonomy={{ ...taxonomy, occupations: [...taxonomy.occupations] }}
      allLabel={en.allOccupations}
      pickerTitle={en.occupationPickerTitle}
      pickerDescription={en.occupationPickerDescription}
      searchLabel={en.searchOccupations}
      noResultsLabel={en.noFilterOptions}
      majorGroupsLabel={en.occupationMajorGroups}
      selectGroupLabel={labels.selectGroup}
      collapseGroupLabel={labels.collapseGroup}
      expandGroupLabel={labels.expandGroup}
      clearSelectionLabel={en.allOccupations}
      closeLabel={en.close}
      onChange={vi.fn()}
    />)
    expect(screen.getByRole('listbox', { name: 'Software Developers' })).toBeTruthy()
    fireEvent.pointerDown(document.body)
    await waitFor(() => { expect(screen.queryByRole('listbox', { name: 'Software Developers' })).toBeNull() })
  })

  it('clears the committed occupation from the menu', () => {
    const { onChange, trigger } = renderField('web-developers')
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('button', { name: en.allOccupations }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('settles the highlighted level with Tab and leaves with Shift+Tab or an empty level', async () => {
    const { trigger } = renderField()
    fireEvent.click(trigger())
    const search = screen.getByRole<HTMLInputElement>('combobox', { name: en.searchOccupations })
    fireEvent.keyDown(search, { key: 'Tab' })
    expect(screen.getByRole('listbox', { name: 'Management Occupations' })).toBeTruthy()
    fireEvent.keyDown(search, { key: 'Tab', shiftKey: true })
    await waitFor(() => { expect(screen.queryByRole('listbox', { name: 'Management Occupations' })).toBeNull() })
    await waitFor(() => { expect(document.activeElement).toBe(trigger()) })

    fireEvent.click(trigger())
    const reopened = screen.getByRole<HTMLInputElement>('combobox', { name: en.searchOccupations })
    fireEvent.change(reopened, { target: { value: 'no-such-occupation' } })
    fireEvent.keyDown(reopened, { key: 'Tab' })
    expect(screen.getByRole('status').textContent).toBe(en.noFilterOptions)
  })

  it('wraps with ArrowUp and ignores arrow and Enter keys on an empty result set', () => {
    const { trigger } = renderField()
    fireEvent.click(trigger())
    const search = screen.getByRole<HTMLInputElement>('combobox', { name: en.searchOccupations })
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.getByRole('listbox', { name: 'Marketing Managers' })).toBeTruthy()

    fireEvent.change(search, { target: { value: 'no-such-occupation' } })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(screen.getByRole('status').textContent).toBe(en.noFilterOptions)
  })

  it('ignores Enter while an IME composition is in progress, then commits the hit', () => {
    const { onChange, trigger } = renderField()
    fireEvent.click(trigger())
    const search = screen.getByRole<HTMLInputElement>('combobox', { name: en.searchOccupations })
    fireEvent.change(search, { target: { value: 'Database' } })
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('database-administrators')
  })

  it('keeps row mouse presses from moving focus while committing the leaf', () => {
    const { onChange, trigger } = renderField()
    fireEvent.click(trigger())
    const major = screen.getByRole('option', { name: 'Software Developers, 15-1252' })
    fireEvent.mouseDown(major)
    fireEvent.click(major)
    const minor = screen.getByRole('option', { name: 'Computer Occupations, 15-1200' })
    fireEvent.mouseDown(minor)
    fireEvent.click(minor)
    const leaf = screen.getByRole('option', { name: 'Web Developers, 15-1254' })
    fireEvent.mouseDown(leaf)
    fireEvent.click(leaf)
    expect(onChange).toHaveBeenCalledWith('web-developers')
  })

  it('drills from the expand control and leaves or commits from a group header', () => {
    const { onChange, trigger } = renderField()
    fireEvent.click(trigger())
    const expand = screen.getByRole('button', { name: labels.expandGroup('Management Occupations') })
    fireEvent.mouseDown(expand)
    fireEvent.click(expand)
    expect(screen.getByRole('listbox', { name: 'Management Occupations' })).toBeTruthy()

    const collapse = screen.getByRole('button', { name: labels.collapseGroup('Management Occupations') })
    fireEvent.mouseDown(collapse)
    fireEvent.click(collapse)
    expect(screen.getByRole('listbox', { name: en.occupationMajorGroups })).toBeTruthy()

    fireEvent.click(screen.getByRole('option', { name: 'Management Occupations, 11-0000' }))
    const commitGroup = screen.getByRole('button', { name: labels.selectGroup('Management Occupations') })
    fireEvent.mouseDown(commitGroup)
    fireEvent.click(commitGroup)
    expect(onChange).toHaveBeenCalledWith('management-occupations')
  })

  it('closes from the trigger while open and clears the committed filter from the menu', () => {
    const { onChange, trigger } = renderField('web-developers')
    fireEvent.click(trigger())
    expect(screen.getByRole('listbox', { name: 'Computer Occupations' })).toBeTruthy()
    fireEvent.click(trigger())
    expect(screen.queryByRole('listbox', { name: 'Computer Occupations' })).toBeNull()

    fireEvent.click(trigger())
    const clear = screen.getByRole('button', { name: en.allOccupations })
    fireEvent.mouseDown(clear)
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('leaves the drilled occupation level with ArrowLeft', () => {
    const { trigger } = renderField()
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('option', { name: 'Software Developers, 15-1252' }))
    fireEvent.click(screen.getByRole('option', { name: 'Computer Occupations, 15-1200' }))
    expect(screen.getByRole('listbox', { name: 'Computer Occupations' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole<HTMLInputElement>('combobox', { name: en.searchOccupations }), { key: 'ArrowLeft' })
    expect(screen.queryByRole('listbox', { name: 'Computer Occupations' })).toBeNull()
    expect(screen.getByRole('listbox', { name: 'Software Developers' })).toBeTruthy()
  })

  it('renders rows and a drilled header that carry no SOC code', () => {
    const { onChange, trigger, names } = renderField('', uncodedGroup)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('option', { name: 'Major One, 10-0000' }))
    const minors = screen.getByRole('listbox', { name: 'Major One' })
    expect(names(minors)).toEqual(['Group Without Code'])
    fireEvent.click(within(minors).getByRole('option', { name: 'Group Without Code' }))
    const leaves = screen.getByRole('listbox', { name: 'Group Without Code' })
    expect(names(leaves)).toEqual(['Group Leaf'])
    const header = screen.getByText('Group Without Code', { selector: `.${css.occupationColumnTitle}` })
    expect(header.parentElement?.querySelector('code')).toBeNull()
    fireEvent.click(within(leaves).getByRole('option', { name: 'Group Leaf' }))
    expect(onChange).toHaveBeenCalledWith('group-leaf')
  })

  it('keeps uncoded nodes in their source order behind the coded ones', () => {
    const { trigger, names } = renderField('', mixedCodeMajors)
    fireEvent.click(trigger())
    expect(names(screen.getByRole('listbox', { name: en.occupationMajorGroups }))).toEqual([
      'Coded Major, 33-0000',
      'Zulu Uncoded',
      'Alpha Uncoded',
      'Mike Uncoded',
    ])
  })

  it('stops the ancestor walk when a taxonomy parent link is missing', () => {
    const { onChange, trigger } = renderField('', danglingParent)
    fireEvent.click(trigger())
    const search = screen.getByRole<HTMLInputElement>('combobox', { name: en.searchOccupations })
    fireEvent.change(search, { target: { value: 'Orphan' } })
    fireEvent.click(screen.getByRole('option', { name: /Orphan Role/u }))
    expect(onChange).toHaveBeenCalledWith('orphan-role')
  })

  it('orders repeated numeric codes by segment and keeps equal codes stable', () => {
    const { trigger, names } = renderField('', duplicateCodes)
    fireEvent.click(trigger())
    expect(names(screen.getByRole('listbox', { name: en.occupationMajorGroups }))).toEqual([
      'Dup B, 10-0000',
      'Dup A, 20-0000',
      'Dup C, 20-0000',
    ])
  })

  it('falls back to text order for non-numeric codes', () => {
    const { trigger, names } = renderField('', letterCodes)
    fireEvent.click(trigger())
    expect(names(screen.getByRole('listbox', { name: en.occupationMajorGroups }))).toEqual([
      'Code X, X',
      'Code X Two, X',
      'Code Y, Y',
    ])
  })

  it('scrolls the active row into view while the menu is open', () => {
    const scrollIntoView = vi.fn()
    Reflect.set(Element.prototype, 'scrollIntoView', scrollIntoView)
    try {
      const { trigger } = renderField()
      fireEvent.click(trigger())
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })
})
