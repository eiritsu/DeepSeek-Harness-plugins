// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type {} from '../src/client/index.ts'
import { MigrationPanel } from '../src/client/MigrationPanel.tsx'
import type { DesktopProfileMigrationState } from '../src/types.ts'

const candidate = '@deepseek-ai/dsh-community-plugin-catalog'
afterEach(cleanup)

const t = (key: string): string => ({
  tab: 'Desktop migration', title: 'Choose Desktop features to add', body: 'Select additions.', loading: 'Loading',
  unavailable: 'Unavailable', confirm: 'Apply selected features', keep: 'Keep current selection', later: 'Later',
  complete: 'Saved', completeRestart: 'Saved; restart the application to apply it.', failed: 'Failed',
  partial: 'Could not enable', alreadySelected: 'Selected', installFirst: 'Install first', warning: 'Warning', empty: 'No options',
  pluginCatalog: 'Community plugin catalog', skillCatalog: 'SkillHub skills catalog', officeFiles: 'Deepseek-Files recognition',
  modelCatalog: 'Model catalog', copySessionId: 'Copy Session ID', turnTreatment: 'Running status treatment',
  sessionArchive: 'Session archive', lark: 'Lark',
}[key] ?? key)

function migrationState(complete = false): DesktopProfileMigrationState {
  return { eligible: true, complete, selected: ['base', 'web-app'], candidates: [candidate] }
}

function setup(complete = false) {
  const migration = {
    read: vi.fn(async () => migrationState(complete)),
    complete: vi.fn(async () => ({ ...migrationState(true), selected: ['base', 'web-app', candidate] })),
  }
  const bundles = {
    listBundles: vi.fn(async () => ({ ok: true as const, value: [{ name: candidate, installed: true }] })),
    setBundleEnabled: vi.fn(async () => ({ ok: true as const, value: { application: 'restart-required' } })),
  }
  const props: ComponentProps<typeof MigrationPanel> = {
    migration, bundles, t,
    usePanelInfo: unusedHook, useSessions: unusedHook, useSessionStatus: unusedHook,
    useSessionRetainInfo: unusedHook, useResource: unusedHook, useWorkspaces: unusedHook,
  }
  return { migration, bundles, props }
}

function unusedHook(): never { throw new Error('Not used by MigrationPanel') }

describe('Desktop migration panel', () => {
  it('keeps the old selections until an explicit choice and confirmation', async () => {
    const model = setup()
    render(<MigrationPanel {...model.props} />)
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply selected features' }))
    await waitFor(() =>{  expect(screen.getByRole('status').textContent).toContain('restart the application') })
    expect(model.migration.complete).toHaveBeenCalledOnce()
    expect(model.migration.complete).toHaveBeenCalledWith(['base', 'web-app', candidate], [candidate])
    expect(screen.queryByRole('button', { name: 'Apply selected features' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Keep current selection' })).toBeNull()
  })

  it('hides a migration already completed before the tab opened', async () => {
    render(<MigrationPanel {...setup(true).props} />)
    await waitFor(() =>{  expect(screen.queryByRole('heading', { name: 'Choose Desktop features to add' })).toBeNull() })
  })
})
