// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GlobalStandardProps, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CalendarSubscription, CalendarSubscriptionId } from '../src/types.ts'
import type { CalendarConfigPageProps } from '../src/client/CalendarConfigPage.tsx'
import { CalendarConfigPage } from '../src/client/CalendarConfigPage.tsx'
import type { CalendarFace, CalendarState } from '../src/client/controller.ts'
import { configEn, type CalendarConfigKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t: TranslateNS<'settings.calendar'> = (key, params) => Object.entries(params ?? {}).reduce(
  (copy, [name, value]) => copy.replaceAll(`{${name}}`, String(value)),
  configEn[key as CalendarConfigKey],
)
const unusedStandardHook = (): never => { throw new Error('Calendar configuration fixture does not provide global state') }
const standard: Pick<GlobalStandardProps, 'usePanelInfo' | 'useSessions' | 'useSessionStatus' | 'useSessionRetainInfo' | 'useResource' | 'useWorkspaces'> = {
  usePanelInfo: unusedStandardHook, useSessions: unusedStandardHook, useSessionStatus: unusedStandardHook,
  useSessionRetainInfo: unusedStandardHook, useResource: unusedStandardHook, useWorkspaces: unusedStandardHook,
}

function subscription(id: string, name: string): CalendarSubscription {
  return {
    id: id as CalendarSubscriptionId, name, url: `https://example.com/${id}.ics`, protocol: 'https', enabled: true,
    refreshIntervalSeconds: 3600, entryCount: 0, droppedEntryCount: 0, refreshing: false,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

function state(subscriptions: CalendarSubscription[] = []): CalendarState {
  return {
    view: 'month', year: 2026, month: 10, selectedDate: '2026-10-05', filter: 'all', loading: false,
    refreshing: false, errorKey: undefined, items: [], subscriptions, imported: [], selectableSessions: [],
    hostSelectableSessions: [], hostSnapshotLoaded: false, sessionLabels: {}, allowedSessionIds: [],
    sessionDirectoryLoaded: false, serviceAvailable: true, now: '2026-10-05T00:00:00.000Z',
    hostTimeZone: 'UTC', snapshotTimeZone: 'UTC', occurrencesTruncated: false, entriesTruncated: false,
    feedback: { busy: false },
  }
}

function renderPage(overrides: Partial<CalendarFace> = {}, pageState = state()) {
  const face: CalendarFace = {
    hooks: { calendar: createSnapshotStore(pageState) }, onOpenSession: () => {},
    setView: () => {}, setFilter: () => {}, selectDate: () => {}, stepMonth: () => {}, goToday: () => {},
    refresh: () => {}, clearFeedback: () => {}, createTask: async () => ({ ok: true }), updateTask: async () => ({ ok: true }),
    cancelTask: async () => ({ ok: true }), addSubscription: async () => ({ ok: true }), updateSubscription: async () => ({ ok: true }),
    removeSubscription: async () => ({ ok: true }), refreshSubscription: async () => ({ ok: true }), importIcs: async () => ({ ok: true }),
    removeImported: async () => ({ ok: true }), ...overrides,
  }
  const props: CalendarConfigPageProps = {
    ...face, ...standard, t, view: 'page', useCalendar: selector => selector(pageState),
  }
  return render(<CalendarConfigPage {...props} />)
}

function chooseFile(file: File): HTMLInputElement {
  const input = screen.getByLabelText('Choose file') as HTMLInputElement
  fireEvent.change(input, { target: { files: [file] } })
  return input
}

describe('CalendarConfigPage file import', () => {
  it('imports a selected file, clears its name, and accepts the same file again', async () => {
    const importIcs = vi.fn(async () => ({ ok: true } as const))
    renderPage({ importIcs })
    const file = new File(['BEGIN:VCALENDAR\nEND:VCALENDAR'], 'team.ics', { type: 'text/calendar' })
    const input = chooseFile(file)
    await waitFor(() => {
      expect(screen.getByText('team.ics')).toBeTruthy()
      expect(screen.getByLabelText<HTMLTextAreaElement>('ICS content').value).toBe('BEGIN:VCALENDAR\nEND:VCALENDAR')
      expect(screen.getByRole('button', { name: 'Import' }).hasAttribute('disabled')).toBe(false)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => { expect(importIcs).toHaveBeenCalledWith('team', 'BEGIN:VCALENDAR\nEND:VCALENDAR') })
    await waitFor(() => { expect(screen.getByText('No file selected')).toBeTruthy() })
    chooseFile(file)
    await waitFor(() => { expect(screen.getByText('team.ics')).toBeTruthy() })
    expect(input.value).toBe('')
  })

  it('localizes file read failures and disables import while a read is pending', async () => {
    let rejectRead: ((error: Error) => void) | undefined
    const file = new File(['content'], 'broken.ics', { type: 'text/calendar' })
    Object.defineProperty(file, 'text', { value: () => new Promise<string>((_resolve, reject: (error: Error) => void) => { rejectRead = reject }) })
    renderPage()
    fireEvent.change(screen.getByLabelText('ICS content'), { target: { value: 'old clipboard content' } })
    const input = chooseFile(file)
    expect(screen.getByRole('button', { name: 'Reading file…' }).hasAttribute('disabled')).toBe(true)
    expect(input.disabled).toBe(true)
    expect(screen.getByLabelText<HTMLTextAreaElement>('ICS content').disabled).toBe(true)
    expect(screen.getByLabelText<HTMLTextAreaElement>('ICS content').value).toBe('')
    rejectRead?.(new Error('read failed'))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('Could not read the selected file.') })
    expect(screen.getByText('broken.ics')).toBeTruthy()
  })

  it('still imports pasted iCalendar text', async () => {
    const importIcs = vi.fn(async () => ({ ok: true } as const))
    renderPage({ importIcs })
    fireEvent.change(screen.getByLabelText('Import name'), { target: { value: 'Pasted calendar' } })
    fireEvent.change(screen.getByLabelText('ICS content'), { target: { value: 'BEGIN:VCALENDAR\nEND:VCALENDAR' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await waitFor(() => { expect(importIcs).toHaveBeenCalledWith('Pasted calendar', 'BEGIN:VCALENDAR\nEND:VCALENDAR') })
  })

  it('keeps each subscription identified with visible auto-refresh labels and its own actions', () => {
    const refreshSubscription = vi.fn<CalendarFace['refreshSubscription']>(async () => ({ ok: true }))
    const updateSubscription = vi.fn<CalendarFace['updateSubscription']>(async () => ({ ok: true }))
    renderPage({ refreshSubscription, updateSubscription }, state([subscription('work', 'Work'), subscription('home', 'Home')]))
    expect(screen.getByLabelText('Auto-refresh: Work')).toBeTruthy()
    expect(screen.getByLabelText('Auto-refresh: Home')).toBeTruthy()
    expect(screen.getByLabelText('Auto-refresh: Work').parentElement?.textContent).toContain('Auto-refresh')
    expect(screen.getByLabelText('Auto-refresh: Home').parentElement?.textContent).toContain('Auto-refresh')
    expect(screen.getByRole('button', { name: 'Edit subscription: Work' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit subscription: Home' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh subscription: Work' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh subscription: Home' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove subscription: Work' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove subscription: Home' })).toBeTruthy()
    expect(screen.getByText('Leave blank to use the default.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh subscription: Work' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh subscription: Home' }))
    fireEvent.click(screen.getByLabelText('Auto-refresh: Home'))
    expect(refreshSubscription.mock.calls.map(([id]) => id)).toEqual(['work', 'home'])
    expect(updateSubscription.mock.calls).toEqual([[
      'home', { name: 'Home', url: 'https://example.com/home.ics', enabled: false, refreshIntervalSeconds: 3600 },
    ]])
  })
})
