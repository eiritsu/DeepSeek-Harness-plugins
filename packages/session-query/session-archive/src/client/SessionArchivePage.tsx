/** Session archive transfer controls on its bundle detail page. */

import { useState } from 'react'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  SESSION_ARCHIVE_ROUTE, SESSION_ARCHIVE_SQLITE_IMPORT_ROUTE, SESSION_ARCHIVE_SQLITE_LIST_ROUTE,
} from '../routes.ts'
import type { SessionArchiveLocaleKey } from './locales.ts'
import css from './SessionArchivePage.module.css'

/** Props supplied by the bundle detail page renderer. */
export type SessionArchivePageProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'settings.sessionArchive'> & {
  refreshSessions: () => Promise<void>
  directoryPicker: ClientRemote['directoryPicker']
}

interface SqliteBackupFile {
  readonly name: string
  readonly path: string
  readonly bytes: number
}

/** Render full Session archive export and restore actions. */
export function SessionArchivePage({ t, refreshSessions, directoryPicker }: SessionArchivePageProps) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [backupDirectory, setBackupDirectory] = useState<string>()
  const [backupFiles, setBackupFiles] = useState<readonly SqliteBackupFile[]>([])
  const [backupPath, setBackupPath] = useState<string>()
  const [attachmentRoot, setAttachmentRoot] = useState<string>()

  const exportArchive = () => {
    const link = document.createElement('a')
    link.href = SESSION_ARCHIVE_ROUTE
    link.download = 'dsh-sessions-archive-v1.zip'
    link.click()
  }

  const finishImport = async (response: Response) => {
    const result: unknown = await response.json()
    if (!response.ok || typeof result !== 'object' || result === null || !('importedSessions' in result)
      || typeof result.importedSessions !== 'number') {
      const error = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
        ? result.error
        : t('exportError')
      throw new Error(error)
    }
    let refreshFailed = false
    try {
      await refreshSessions()
    } catch {
      refreshFailed = true
    }
    const outcomeRows: readonly unknown[] = 'outcomes' in result && Array.isArray(result.outcomes)
      ? result.outcomes
      : []
    const failedRows = outcomeRows.filter(row => typeof row === 'object' && row !== null
      && 'status' in row && (row.status === 'failed' || row.status === 'not-started'))
    const unassigned = failedRows.filter(row => typeof row === 'object' && row !== null
      && 'kind' in row && row.kind === 'workspace').length
    const importMessage = 'partial' in result && result.partial === true
      ? t('partialImport', { imported: result.importedSessions, failed: failedRows.length - unassigned, unassigned,
        journal: 'journalPath' in result && typeof result.journalPath === 'string' ? result.journalPath : '' })
      : t('imported', { count: result.importedSessions })
    setMessage(refreshFailed ? `${importMessage} ${t('refreshError')}` : importMessage)
  }

  const importArchive = async (file: File | undefined) => {
    if (file === undefined) return
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setMessage(t('invalidFile'))
      return
    }
    setBusy(true)
    setMessage(t('importing'))
    try {
      const response = await fetch(SESSION_ARCHIVE_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: file,
      })
      await finishImport(response)
    } catch (error: unknown) {
      setMessage(t('importError', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const pickBackupDirectory = async () => {
    setBusy(true)
    setMessage('')
    try {
      const picked = await pickDirectory(directoryPicker)
      if (picked === null) return
      const response = await fetch(SESSION_ARCHIVE_SQLITE_LIST_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ directory: picked }),
      })
      const result: unknown = await response.json()
      if (!response.ok || typeof result !== 'object' || result === null || !('files' in result) || !Array.isArray(result.files)) {
        const error = typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string'
          ? result.error
          : t('exportError')
        throw new Error(error)
      }
      const files = result.files.filter(isSqliteBackupFile)
      setBackupDirectory(picked)
      setBackupFiles(files)
      setBackupPath(undefined)
      setAttachmentRoot(undefined)
      setMessage(files.length === 0 ? t('noSqliteBackups') : '')
    } catch (error: unknown) {
      setMessage(t('importError', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const pickAttachmentRoot = async () => {
    setBusy(true)
    setMessage('')
    try {
      const picked = await pickDirectory(directoryPicker)
      if (picked !== null) setAttachmentRoot(picked)
    } catch (error: unknown) {
      setMessage(t('importError', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const importSqliteBackup = async () => {
    if (backupPath === undefined || attachmentRoot === undefined) return
    setBusy(true)
    setMessage(t('importingSqlite'))
    try {
      const response = await fetch(SESSION_ARCHIVE_SQLITE_IMPORT_ROUTE, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ backupPath, attachmentRoot }),
      })
      await finishImport(response)
    } catch (error: unknown) {
      setMessage(t('sqliteImportError', { message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={css.section} aria-labelledby="session-archive-title">
      <header className={css.header}>
        <div>
          <h2 id="session-archive-title" className={css.title}>{t('title')}</h2>
          <p className={css.description}>{t('description')}</p>
        </div>
      </header>
      <div className={css.actions}>
        <button type="button" className={css.primary} onClick={exportArchive} disabled={busy}>{t('export')}</button>
        <label className={css.secondary} aria-disabled={busy}>
          {t('import')}
          <input type="file" accept=".zip,application/zip" disabled={busy}
            onChange={(event) => { void importArchive(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
        </label>
      </div>
      <p className={css.hint}>{t('importHint')}</p>
      <section className={css.sqliteImport} aria-labelledby="session-archive-sqlite-title">
        <h3 id="session-archive-sqlite-title">{t('sqliteImport')}</h3>
        <p className={css.hint}>{t('sqliteImportHint')}</p>
        <div className={css.actions}>
          <button type="button" className={css.secondaryButton} onClick={() => { void pickBackupDirectory() }} disabled={busy}>
            {t('chooseBackupDirectory')}
          </button>
          {backupFiles.length > 0 && <label className={css.fileSelect}>
            <span>{t('chooseBackupFile')}</span>
            <select aria-label={t('chooseBackupFile')} value={backupPath ?? ''} disabled={busy}
              onChange={(event) => { setBackupPath(event.currentTarget.value || undefined); setAttachmentRoot(undefined) }}>
              <option value="">{t('chooseBackupFile')}</option>
              {backupFiles.map(file => <option key={file.path} value={file.path}>{file.name}</option>)}
            </select>
          </label>}
          {backupPath !== undefined && <button type="button" className={css.secondaryButton}
            onClick={() => { void pickAttachmentRoot() }} disabled={busy}>
            {t('chooseAttachmentDirectory')}
          </button>}
          {backupPath !== undefined && attachmentRoot !== undefined && <button type="button" className={css.primary}
            onClick={() => { void importSqliteBackup() }} disabled={busy}>
            {t('startSqliteImport')}
          </button>}
        </div>
        {backupDirectory !== undefined && <p className={css.path}><span>{t('backupDirectoryLabel')}: </span>{backupDirectory}</p>}
        {backupPath !== undefined && <p className={css.path}><span>{t('backupFileLabel')}: </span>{backupPath}</p>}
        {attachmentRoot !== undefined && <p className={css.path}><span>{t('attachmentRootLabel')}: </span>{attachmentRoot}</p>}
      </section>
      {message !== '' && <p className={css.message} role="status" aria-live="polite">{message}</p>}
    </section>
  )
}

async function pickDirectory(directoryPicker: ClientRemote['directoryPicker']): Promise<string | null> {
  const desktop = (globalThis as typeof globalThis & {
    __DSH_DIRECTORY_PICKER__?: { pick(): Promise<string | null> }
  }).__DSH_DIRECTORY_PICKER__
  if (desktop !== undefined) return desktop.pick()
  const result = await directoryPicker.pick()
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

function isSqliteBackupFile(value: unknown): value is SqliteBackupFile {
  return typeof value === 'object' && value !== null
    && 'name' in value && typeof value.name === 'string' && value.name.toLowerCase().endsWith('.sqlite')
    && 'path' in value && typeof value.path === 'string' && value.path !== ''
    && 'bytes' in value && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 0
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session archive Settings copy. */
    'settings.sessionArchive': SessionArchiveLocaleKey
  }
}
