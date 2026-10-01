// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { apply, inject } from '../src/client/index.ts'
import type { SessionArchivePageProps } from '../src/client/SessionArchivePage.tsx'
import type { SessionArchiveLocaleKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function unusedGlobalHook(): never {
  throw new Error('SessionArchivePage does not use global standard hooks.')
}

const globalProps: GlobalStandardProps = {
  usePanelInfo: unusedGlobalHook,
  useSessions: unusedGlobalHook,
  useSessionStatus: unusedGlobalHook,
  useSessionRetainInfo: unusedGlobalHook,
  useWorkspaces: unusedGlobalHook,
  useResource: unusedGlobalHook,
}

/** Parse the JSON request body one fetch mock recorded at a call index. */
function requestBody(fetchMock: { mock: { calls: Parameters<typeof fetch>[] } }, index: number): unknown {
  const body = fetchMock.mock.calls[index]?.[1]?.body
  return typeof body === 'string' ? JSON.parse(body) : undefined
}

const t = ((key: SessionArchiveLocaleKey) => key) as PropsLocale<'settings.sessionArchive'>['t']

/**
 * Mount the real registration on the assembled client test runtime, then hand
 * back a render closure over the registered page with the injected
 * refreshSessions and directoryPicker faces already wired.
 */
async function mountRegisteredPage(
  pick = vi.fn(async () => ({ ok: true as const, value: null })),
): Promise<{ renderPage: () => void; refresh: ReturnType<typeof vi.fn> }> {
  const runtime = await SlotTestRuntime.create()
  onTestFinished(() => runtime.dispose())
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  runtime.remote.provideNamespaces({ directoryPicker: { pick } })
  await runtime.root.declare({
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
  }, () => null)
  const refresh = vi.spyOn(runtime.sessions, 'refresh')
  await runtime.mount({ inject: [...inject], apply })
  const entry = runtime.slots.entries('plugins.bundle.config')
    .find(candidate => candidate.options.key === '@deepseek-ai/dsh-session-archive')
  if (entry === undefined) throw new Error('Session archive bundle detail page was not registered')
  const injected = entry.inject?.() as Pick<SessionArchivePageProps, 'refreshSessions' | 'directoryPicker'>
  const Page = entry.component as ComponentType<SessionArchivePageProps>
  return {
    refresh,
    renderPage: () => { render(<Page {...globalProps} view="page" t={t} {...injected} />) },
  }
}

describe('Session archive Settings import', () => {
  it('refreshes the Host Session list after importing and reports the result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ importedSessions: 1, outcomes: [] }))))
    const { renderPage, refresh } = await mountRegisteredPage()
    renderPage()

    fireEvent.change(screen.getByLabelText('import'), {
      target: { files: [new File(['archive'], 'sessions.zip', { type: 'application/zip' })] },
    })

    expect((await screen.findByRole('status')).textContent).toContain('imported')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('does not misreport a refresh failure as an import failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ importedSessions: 1, outcomes: [] }))))
    const { renderPage, refresh } = await mountRegisteredPage(vi.fn(async () => ({ ok: true as const, value: null })))
    refresh.mockRejectedValue(new Error('offline'))
    renderPage()

    fireEvent.change(screen.getByLabelText('import'), {
      target: { files: [new File(['archive'], 'sessions.zip', { type: 'application/zip' })] },
    })

    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('imported')
    expect(status.textContent).toContain('refreshError')
    expect(status.textContent).not.toContain('importError')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('picks a backup directory and attachment root before converting the selected SQLite file', async () => {
    const backupDirectory = '/tmp/legacy-backups'
    const backupPath = `${backupDirectory}/desktop.sqlite`
    const attachmentRoot = '/tmp/legacy-attachments'
    const pick = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: backupDirectory })
      .mockResolvedValueOnce({ ok: true as const, value: attachmentRoot })
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ name: 'desktop.sqlite', path: backupPath, bytes: 32 }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ importedSessions: 1, outcomes: [] })))
    vi.stubGlobal('fetch', fetchMock)
    const { renderPage, refresh } = await mountRegisteredPage(pick)
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'chooseBackupDirectory' }))
    const backupSelect = await screen.findByRole('combobox', { name: 'chooseBackupFile' })
    fireEvent.change(backupSelect, { target: { value: backupPath } })
    fireEvent.click(screen.getByRole('button', { name: 'chooseAttachmentDirectory' }))
    fireEvent.click(await screen.findByRole('button', { name: 'startSqliteImport' }))

    expect(pick).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('api/session.archive/sqlite-backups')
    expect(requestBody(fetchMock, 0)).toEqual({ directory: backupDirectory })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('api/session.archive/sqlite-import')
    expect(requestBody(fetchMock, 1)).toEqual({ backupPath, attachmentRoot })
    expect((await screen.findByRole('status')).textContent).toContain('imported')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('uses the Electron directory-picker bridge before the Host fallback', async () => {
    const backupDirectory = '/tmp/electron-picked-backups'
    const backupPath = `${backupDirectory}/desktop.sqlite`
    const attachmentRoot = '/tmp/electron-picked-attachments'
    const remotePick = vi.fn(async () => ({ ok: true as const, value: null }))
    const desktopPick = vi.fn()
      .mockResolvedValueOnce(backupDirectory)
      .mockResolvedValueOnce(attachmentRoot)
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ name: 'desktop.sqlite', path: backupPath, bytes: 32 }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ importedSessions: 1, outcomes: [] })))
    vi.stubGlobal('__DSH_DIRECTORY_PICKER__', { pick: desktopPick })
    vi.stubGlobal('fetch', fetchMock)
    const { renderPage } = await mountRegisteredPage(remotePick)
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'chooseBackupDirectory' }))
    const backupSelect = await screen.findByRole('combobox', { name: 'chooseBackupFile' })
    fireEvent.change(backupSelect, { target: { value: backupPath } })
    fireEvent.click(screen.getByRole('button', { name: 'chooseAttachmentDirectory' }))
    fireEvent.click(await screen.findByRole('button', { name: 'startSqliteImport' }))

    expect(desktopPick).toHaveBeenCalledTimes(2)
    expect(remotePick).not.toHaveBeenCalled()
    expect(requestBody(fetchMock, 0)).toEqual({ directory: backupDirectory })
    expect(requestBody(fetchMock, 1)).toEqual({ backupPath, attachmentRoot })
    expect((await screen.findByRole('status')).textContent).toContain('imported')
  })
})
