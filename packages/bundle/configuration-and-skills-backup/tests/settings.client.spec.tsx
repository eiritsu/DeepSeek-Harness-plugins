// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { GlobalStandardProps, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '../src/client/locales.ts'
import { ConfigurationSkillsBackupPage } from '../src/client/page.tsx'

function unusedGlobalHook(): never {
  throw new Error('ConfigurationSkillsBackupPage does not use global standard hooks.')
}

const globalProps: GlobalStandardProps = {
  usePanelInfo: unusedGlobalHook,
  useSessions: unusedGlobalHook,
  useSessionStatus: unusedGlobalHook,
  useSessionRetainInfo: unusedGlobalHook,
  useWorkspaces: unusedGlobalHook,
  useResource: unusedGlobalHook,
}

const translate: TranslateNS<'settings.configurationSkillsBackup'> = (key, values) => Object.entries(values ?? {}).reduce(
  (text, [name, value]) => text.replace(`{${name}}`, String(value)),
  en[key as keyof typeof en] ?? key,
)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('configuration and skills backup Settings', () => {
  it('re-previews a failed item for retry without selecting the archive again', async () => {
    const archive = JSON.stringify({
      format: 'dsh-configuration-and-skills-backup', version: 1,
      skillRoots: [{ id: 'source:custom:0', kind: 'custom', label: 'Old root' }],
      skillDirectories: [{ rootId: 'source:custom:0', path: 'guide' }], skillFiles: [],
    })
    const ready = { archiveId: 'b'.repeat(64), items: [
      { id: 'config:office', kind: 'config', status: 'ready', detail: 'Configuration can be restored.' },
      { id: 'directory:source:custom:0:guide', kind: 'skill-file', status: 'missing', detail: 'No destination skill root was selected.' },
    ] }
    const failed = { ...ready, items: [
      { ...ready.items[0], status: 'failed', detail: 'Apply failed: temporary error' }, ready.items[1],
    ] }
    let applies = 0
    let previews = 0
    let applyPayload: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('?action=roots')) return Response.json({ roots: [
        { id: 'skill-filesystem:dsh-user:0', kind: 'dsh-user', label: 'English from Host' },
        { id: 'skill-filesystem:bundled:0', kind: 'bundled', label: 'English from Host' },
      ] })
      if (url.endsWith('?action=preview')) { previews++; return Response.json(ready) }
      if (url.endsWith('?action=apply')) {
        applies++
        if (typeof init?.body === 'string') applyPayload = JSON.parse(init.body) as Record<string, unknown>
        return Response.json(failed)
      }
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ConfigurationSkillsBackupPage {...globalProps} view="page" t={translate} />)
    fireEvent.change(screen.getByLabelText(en.importLabel), { target: { files: [new File([archive], 'backup.json')] } })
    const row = await screen.findByText(en.detailConfigReady)
    expect(screen.getByRole('button', { name: en.apply })).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: en.apply }))
    expect(await screen.findByText(en.statusFailed)).toBeTruthy()
    expect(applyPayload?.['items']).toEqual(['config:office'])
    expect(screen.getByRole('button', { name: en.refreshPreview })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.refreshPreview }))
    await waitFor(() =>{  expect(previews).toBe(2) })
    const refreshed = await screen.findByText(en.detailConfigReady)
    fireEvent.click(within(refreshed.closest('li')!).getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: en.apply }))
    await waitFor(() =>{  expect(applies).toBe(2) })
    expect(screen.getAllByText(en.rootDshUser)).toHaveLength(2)
    expect(screen.queryByRole('option', { name: en.rootBundled })).toBeNull()
    expect(row).toBeTruthy()
  })

  it('requires explicit conflict confirmation and submits only selected items', async () => {
    const archive = JSON.stringify({ format: 'dsh-configuration-and-skills-backup', version: 1 })
    const preview = {
      archiveId: 'a'.repeat(64),
      items: [
        { id: 'config:office', kind: 'config', status: 'conflict', detail: 'Non-secret overrides differ.' },
        { id: 'bundle:feature', kind: 'bundle', status: 'missing', detail: 'Bundle is unavailable.' },
        { id: 'file:skills:0:guide/SKILL.md', kind: 'skill-file', status: 'ready', detail: 'A new file will be created.' },
      ],
    }
    const calls: Array<{ url: string; body?: string }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) })
      if (url.endsWith('?action=roots')) return Response.json({ roots: [] })
      if (url.endsWith('?action=preview')) return Response.json(preview)
      if (url.endsWith('?action=apply')) return Response.json({ ...preview, items: preview.items.map(item => ({ ...item, status: item.status === 'ready' ? 'applied' : item.status })), journalPath: 'DSH_HOME/backups/import.json' })
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ConfigurationSkillsBackupPage {...globalProps} view="page" t={translate} />)
    const input = screen.getByLabelText(en.importLabel)
    fireEvent.change(input, { target: { files: [new File([archive], 'backup.json', { type: 'application/json' })] } })
    const conflict = await screen.findByText('Non-secret overrides differ.')
    const conflictRow = conflict.closest('li')
    expect(conflictRow).not.toBeNull()
    expect(within(conflictRow!).getByRole('checkbox')).toHaveProperty('checked', false)
    expect(within(conflictRow!).getByRole('checkbox')).toHaveProperty('disabled', false)
    fireEvent.click(screen.getByRole('button', { name: en.apply }))
    await waitFor(() => { expect(calls.some(call => call.url.endsWith('?action=apply'))).toBe(true) })
    const applyCall = calls.find(call => call.url.endsWith('?action=apply'))
    expect(applyCall?.body).toBeDefined()
    const payload = JSON.parse(applyCall!.body!) as { items: string[] }
    expect(payload.items).toEqual(['file:skills:0:guide/SKILL.md'])
    expect(payload.items).not.toContain('config:office')
    expect(await screen.findByText(/DSH_HOME\/backups\/import\.json/)).toBeTruthy()
  })

  it('keeps identical and unsupported results collapsed and localizes successful restore details', async () => {
    const archive = JSON.stringify({ format: 'dsh-configuration-and-skills-backup', version: 1 })
    const preview = { archiveId: 'c'.repeat(64), items: [
      { id: 'config:ready', kind: 'config', status: 'ready', detail: 'Configuration can be restored.' },
      { id: 'config:same', kind: 'config', status: 'identical', detail: 'Configuration already matches.' },
      { id: 'config:unknown', kind: 'config', status: 'unsupported', detail: 'The schema is unavailable.' },
    ] }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('?action=roots')) return Response.json({ roots: [] })
      if (url.endsWith('?action=preview')) return Response.json(preview)
      if (url.endsWith('?action=apply')) return Response.json({
        ...preview,
        items: [
          { ...preview.items[0], status: 'applied', detail: 'Applied; retry is safe because the selected operation is idempotent. Verified.' },
          preview.items[1], preview.items[2],
        ],
        journalPath: 'DSH_HOME/backups/import.json',
      })
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ConfigurationSkillsBackupPage {...globalProps} view="page" t={translate} />)
    fireEvent.change(screen.getByLabelText(en.importLabel), { target: { files: [new File([archive], 'backup.json')] } })
    await screen.findByText(en.detailConfigReady)
    const identical = screen.getByText(en.groupIdentical.replace('{count}', '1')).closest('details')
    const unsupported = screen.getByText(en.groupUnsupported.replace('{count}', '1')).closest('details')
    expect(identical?.open).toBe(false)
    expect(unsupported?.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: en.apply }))
    expect(await screen.findByText(en.detailAppliedVerified)).toBeTruthy()
    expect(screen.queryByText(/retry is safe/i)).toBeNull()
  })
})
