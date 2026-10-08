// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillsMpTaxonomy } from '@deepseek-ai/dsh-community-skill-catalog/types'
import { en } from '../src/client/locales.ts'
import { CategoryCascader } from '../src/client/CategoryCascader.tsx'
import type { CategoryOption } from '../src/client/CategoryCascader.tsx'
import { OccupationCascader } from '../src/client/OccupationCascader.tsx'

afterEach(cleanup)

/**
 * The real catalog dialog: the inline dropdowns sit inside the shipped
 * `ui-primitives` Modal exactly as `SkillCatalogPanel` mounts them. No mock
 * replaces the Modal, so Escape ownership is exercised against the production
 * `useModalLayer` listener.
 */
function CatalogDialog({ children }: { readonly children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const close = useCallback(() => { setOpen(false) }, [])
  return <Modal open={open} onClose={close} title={en.title} closeLabel={en.close}>{children}</Modal>
}

const categoryOptions: readonly CategoryOption[] = [
  { slug: 'architecture', name: 'Architecture', group: 'Development' },
  { slug: 'backend', name: 'Backend', group: 'Development' },
]

const taxonomy: SkillsMpTaxonomy = {
  categories: [],
  occupations: [
    { slug: 'software-developers', name: 'Software Developers', level: 1, code: '15-1252' },
    { slug: 'computer-occupations', name: 'Computer Occupations', parentId: 'software-developers', level: 2, code: '15-1200' },
    { slug: 'web-developers', name: 'Web Developers', parentId: 'computer-occupations', level: 4, code: '15-1254' },
  ],
}

const categoryLabel = `${en.category}: ${en.allCategories}`
const occupationLabel = new RegExp(`^${en.occupation}:`, 'u')

/** The catalog dialog survives unless a user action closes it. */
function expectDialogOpen(): void {
  expect(screen.getByRole('dialog', { name: en.title })).toBeTruthy()
}

/** The catalog dialog is gone once its own Escape close runs. */
async function expectDialogClosed(): Promise<void> {
  await waitFor(() => { expect(screen.queryByRole('dialog', { name: en.title })).toBeNull() })
}

describe('inline dropdown Escape ownership inside the catalog dialog', () => {
  it('closes only the category menu on Escape from its search field and restores the trigger', () => {
    render(<CatalogDialog>
      <CategoryCascader
        label={en.category}
        value=""
        options={categoryOptions}
        allLabel={en.allCategories}
        otherGroupLabel={en.otherCategories}
        searchLabel={en.searchCategories}
        noResultsLabel={en.noFilterOptions}
        domainsLabel={en.categoryDomains}
        categoriesLabel={en.categoryOptions}
        backLabel={en.backToDomains}
        onChange={vi.fn()}
      />
    </CatalogDialog>)
    fireEvent.click(screen.getByRole('combobox', { name: categoryLabel }))
    fireEvent.keyDown(screen.getByRole('searchbox', { name: en.searchCategories }), { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: en.categoryDomains })).toBeNull()
    expectDialogOpen()
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: categoryLabel }))
  })

  it('closes only the category menu on Escape from its trigger', () => {
    render(<CatalogDialog>
      <CategoryCascader
        label={en.category}
        value=""
        options={categoryOptions}
        allLabel={en.allCategories}
        otherGroupLabel={en.otherCategories}
        searchLabel={en.searchCategories}
        noResultsLabel={en.noFilterOptions}
        domainsLabel={en.categoryDomains}
        categoriesLabel={en.categoryOptions}
        backLabel={en.backToDomains}
        onChange={vi.fn()}
      />
    </CatalogDialog>)
    fireEvent.click(screen.getByRole('combobox', { name: categoryLabel }))
    fireEvent.keyDown(screen.getByRole('combobox', { name: categoryLabel }), { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: en.categoryDomains })).toBeNull()
    expectDialogOpen()
  })

  it('still closes the catalog dialog on Escape once the category menu is closed', async () => {
    render(<CatalogDialog>
      <CategoryCascader
        label={en.category}
        value=""
        options={categoryOptions}
        allLabel={en.allCategories}
        otherGroupLabel={en.otherCategories}
        searchLabel={en.searchCategories}
        noResultsLabel={en.noFilterOptions}
        domainsLabel={en.categoryDomains}
        categoriesLabel={en.categoryOptions}
        backLabel={en.backToDomains}
        onChange={vi.fn()}
      />
    </CatalogDialog>)
    fireEvent.keyDown(screen.getByRole('dialog', { name: en.title }), { key: 'Escape' })
    await expectDialogClosed()
  })

  it('closes only the occupation menu on Escape from its search field and restores the trigger', async () => {
    render(<CatalogDialog>
      <OccupationCascader
        label={en.occupation}
        value=""
        taxonomy={taxonomy}
        allLabel={en.allOccupations}
        pickerTitle={en.occupationPickerTitle}
        pickerDescription={en.occupationPickerDescription}
        searchLabel={en.searchOccupations}
        noResultsLabel={en.noFilterOptions}
        majorGroupsLabel={en.occupationMajorGroups}
        selectGroupLabel={name => en.selectOccupationGroup.replace('{name}', name)}
        collapseGroupLabel={name => en.collapseOccupationGroup.replace('{name}', name)}
        expandGroupLabel={name => en.expandOccupationGroup.replace('{name}', name)}
        clearSelectionLabel={en.allOccupations}
        closeLabel={en.close}
        onChange={vi.fn()}
      />
    </CatalogDialog>)
    fireEvent.click(screen.getByRole('button', { name: occupationLabel }))
    fireEvent.keyDown(screen.getByRole('combobox', { name: en.searchOccupations }), { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: en.occupationMajorGroups })).toBeNull()
    expectDialogOpen()
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole('button', { name: occupationLabel })) })
  })

  it('closes only the occupation menu on Escape from its trigger', () => {
    render(<CatalogDialog>
      <OccupationCascader
        label={en.occupation}
        value=""
        taxonomy={taxonomy}
        allLabel={en.allOccupations}
        pickerTitle={en.occupationPickerTitle}
        pickerDescription={en.occupationPickerDescription}
        searchLabel={en.searchOccupations}
        noResultsLabel={en.noFilterOptions}
        majorGroupsLabel={en.occupationMajorGroups}
        selectGroupLabel={name => en.selectOccupationGroup.replace('{name}', name)}
        collapseGroupLabel={name => en.collapseOccupationGroup.replace('{name}', name)}
        expandGroupLabel={name => en.expandOccupationGroup.replace('{name}', name)}
        clearSelectionLabel={en.allOccupations}
        closeLabel={en.close}
        onChange={vi.fn()}
      />
    </CatalogDialog>)
    const trigger = screen.getByRole('button', { name: occupationLabel })
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox', { name: en.occupationMajorGroups })).toBeNull()
    expectDialogOpen()
  })

  it('still closes the catalog dialog on Escape once the occupation menu is closed', async () => {
    render(<CatalogDialog>
      <OccupationCascader
        label={en.occupation}
        value=""
        taxonomy={taxonomy}
        allLabel={en.allOccupations}
        pickerTitle={en.occupationPickerTitle}
        pickerDescription={en.occupationPickerDescription}
        searchLabel={en.searchOccupations}
        noResultsLabel={en.noFilterOptions}
        majorGroupsLabel={en.occupationMajorGroups}
        selectGroupLabel={name => en.selectOccupationGroup.replace('{name}', name)}
        collapseGroupLabel={name => en.collapseOccupationGroup.replace('{name}', name)}
        expandGroupLabel={name => en.expandOccupationGroup.replace('{name}', name)}
        clearSelectionLabel={en.allOccupations}
        closeLabel={en.close}
        onChange={vi.fn()}
      />
    </CatalogDialog>)
    fireEvent.keyDown(screen.getByRole('dialog', { name: en.title }), { key: 'Escape' })
    await expectDialogClosed()
  })
})
