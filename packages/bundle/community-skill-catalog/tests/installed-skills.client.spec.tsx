// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { en } from '../src/client/locales.ts'
import { InstalledSkillsPage } from '../src/client/InstalledSkillsPage.tsx'

function unusedGlobalHook(): never { throw new Error('InstalledSkillsPage does not use global standard hooks.') }
const globalProps: GlobalStandardProps = {
  usePanelInfo: unusedGlobalHook,
  useSessions: unusedGlobalHook,
  useSessionStatus: unusedGlobalHook,
  useSessionRetainInfo: unusedGlobalHook,
  useWorkspaces: unusedGlobalHook,
  useResource: unusedGlobalHook,
}
const translate: TranslateNS<'skillCatalog'> = (key, values) => Object.entries(values ?? {}).reduce(
  (text, [name, value]) => text.replace(`{${name}}`, String(value)),
  en[key as keyof typeof en] ?? key,
)

afterEach(cleanup)

it('shows the global skill list in the official Plugins item and matches the visible copy snapshot', async () => {
  const api = {
    listInstalledSkills: vi.fn().mockResolvedValue({ ok: true, value: [
      { id: '%40publisher%2Fcatalog-skill', name: '@publisher/catalog-skill' },
      { id: 'local-skill', name: 'local-skill' },
    ] }),
    removeInstalledSkill: vi.fn(),
  }
  render(<InstalledSkillsPage {...globalProps} view="page" api={api} t={translate} />)
  const region = await screen.findByRole('region', { name: en.managerTitle })
  expect(region.textContent).toMatchInlineSnapshot('"SkillsThis list contains directories with SKILL.md files in the global DSH skills folder. Removing a skill permanently deletes its files from this computer.Refresh@publisher/catalog-skillRemovelocal-skillRemove"')
  expect(within(region).getAllByRole('button', { name: en.removeSkill })).toHaveLength(2)
})

it('removes a skill only after the user acknowledges the destructive action', async () => {
  const api = {
    listInstalledSkills: vi.fn().mockResolvedValue({ ok: true, value: [{ id: 'local-skill', name: 'local-skill' }] }),
    removeInstalledSkill: vi.fn().mockResolvedValue({ ok: true, value: 'local-skill' }),
  }
  render(<InstalledSkillsPage {...globalProps} view="page" api={api} t={translate} />)
  const region = await screen.findByRole('region', { name: en.managerTitle })
  fireEvent.click(within(region).getByRole('button', { name: en.removeSkill }))

  const dialog = screen.getByRole('dialog', { name: en.removeSkillTitle })
  const confirm = within(dialog).getByRole('button', { name: en.confirmSkillRemoval })
  expect(confirm).toHaveProperty('disabled', true)
  expect(api.removeInstalledSkill).not.toHaveBeenCalled()

  fireEvent.click(within(dialog).getByRole('checkbox', { name: en.acknowledgeSkillRemoval }))
  expect(confirm).toHaveProperty('disabled', false)
  fireEvent.click(confirm)

  await waitFor(() => { expect(api.removeInstalledSkill).toHaveBeenCalledWith('local-skill', true) })
  expect(await screen.findByText(en.skillRemoved)).toBeTruthy()
  expect(await screen.findByText(en.skillsEmpty)).toBeTruthy()
})
