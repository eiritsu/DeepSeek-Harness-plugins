/** Explicit configuration and selected skill-root archive transfer controls. */

import { useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CONFIGURATION_BACKUP_PATH } from '../routes.ts'
import type { BackupImportItem, BackupOperationResult, BackupSkillRoot } from '../types.ts'
import type { ConfigurationSkillsBackupLocaleKey } from './locales.ts'
import css from './page.module.css'

/** Props supplied by the bundle detail page renderer. */
export type ConfigurationSkillsBackupPageProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'settings.configurationSkillsBackup'>

type ImportPreview = BackupOperationResult & { items: BackupImportItem[] }

/** Render export, conflict review, and independently applied import controls. */
export function ConfigurationSkillsBackupPage({ t }: ConfigurationSkillsBackupPageProps) {
  const [roots, setRoots] = useState<BackupSkillRoot[]>([])
  const [selectedRoots, setSelectedRoots] = useState<string[]>([])
  const [rootMapping, setRootMapping] = useState<Record<string, string>>({})
  const [archiveText, setArchiveText] = useState('')
  const [preview, setPreview] = useState<ImportPreview>()
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const requiredRootIds = useMemo(() => archivedRootIds(archiveText, selectedItems), [archiveText, selectedItems])
  const rootMappingReady = requiredRootIds.every(id => rootMapping[id] !== undefined)

  useEffect(() => {
    let active = true
    void fetch(`${CONFIGURATION_BACKUP_PATH}?action=roots`).then(async (response) => {
      if (!response.ok) throw new Error(await responseError(response))
      const result: unknown = await response.json()
      const rows = parseRoots(result)
      if (active) setRoots(rows)
    }).catch((error: unknown) => { if (active) setMessage(t('exportError', { message: messageOf(error) })) })
    return () => { active = false }
  }, [t])

  const toggleRoot = (id: string): void => {
    setSelectedRoots(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])
  }

  const exportSelected = async () => {
    setBusy(true)
    setMessage('')
    try {
      const query = new URLSearchParams({ action: 'export' })
      for (const id of selectedRoots) query.append('root', id)
      const response = await fetch(`${CONFIGURATION_BACKUP_PATH}?${query}`)
      if (!response.ok) throw new Error(await responseError(response))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'dsh-configuration-and-skills-backup-v1.json'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error: unknown) {
      setMessage(t('exportError', { message: messageOf(error) }))
    } finally { setBusy(false) }
  }

  const previewFile = async (file: File | undefined) => {
    setPreview(undefined)
    setSelectedItems([])
    setArchiveText('')
    setRootMapping({})
    if (file === undefined) return
    setBusy(true)
    setMessage('')
    try {
      const text = await file.text()
      const imported = JSON.parse(text) as { skillRoots?: Array<{ id?: unknown }> }
      const sourceRoots = Array.isArray(imported.skillRoots) ? imported.skillRoots.flatMap(root => typeof root.id === 'string' ? [root.id] : []) : []
      const mapping = Object.fromEntries(sourceRoots.flatMap(id => roots.some(root => root.id === id) ? [[id, id]] : []))
      const result = await requestPreview(text, mapping)
      setArchiveText(text)
      setPreview(result)
      setRootMapping(mapping)
      setSelectedItems(result.items.filter(item => item.status === 'ready').map(item => item.id))
    } catch (error: unknown) {
      setMessage(t('previewError', { message: messageOf(error) }))
    } finally { setBusy(false) }
  }

  const updateRootMapping = async (sourceId: string, destinationId: string) => {
    const nextMapping = destinationId === ''
      ? Object.fromEntries(Object.entries(rootMapping).filter(([key]) => key !== sourceId))
      : { ...rootMapping, [sourceId]: destinationId }
    setRootMapping(nextMapping)
    if (archiveText === '') return
    setBusy(true)
    try {
      const result = await requestPreview(archiveText, nextMapping)
      setPreview(result)
      setSelectedItems(current => current.filter(id => result.items.some(item => item.id === id && ['ready', 'conflict'].includes(item.status))))
    } catch (error: unknown) {
      setMessage(t('previewError', { message: messageOf(error) }))
    } finally { setBusy(false) }
  }

  const applySelected = async () => {
    if (preview === undefined || archiveText === '') return
    const requiredRoots = archivedRootIds(archiveText, selectedItems)
    if (requiredRoots.some(id => rootMapping[id] === undefined)) {
      setMessage(t('chooseRoot'))
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`${CONFIGURATION_BACKUP_PATH}?action=apply`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archive: archiveText, archiveId: preview.archiveId, items: selectedItems, rootMapping }),
      })
      if (!response.ok) throw new Error(await responseError(response))
      const result = parsePreview(await response.json())
      setPreview(result)
      setSelectedItems(result.items.filter(item => item.status === 'ready').map(item => item.id))
      setMessage(result.journalPath === undefined ? t('noItems') : t('complete', { path: result.journalPath }))
    } catch (error: unknown) {
      setMessage(t('applyError', { message: messageOf(error) }))
    } finally { setBusy(false) }
  }

  const refreshPreview = async () => {
    if (archiveText === '') return
    setBusy(true)
    setMessage('')
    try {
      const result = await requestPreview(archiveText, rootMapping)
      setPreview(result)
      setSelectedItems(current => current.filter(id => result.items.some(item => item.id === id && ['ready', 'conflict'].includes(item.status))))
    } catch (error: unknown) {
      setMessage(t('previewError', { message: messageOf(error) }))
    } finally { setBusy(false) }
  }

  return (
    <section className={css.section} aria-labelledby="configuration-skills-backup-title">
      <header className={css.header}>
        <div>
          <h2 id="configuration-skills-backup-title" className={css.title}>{t('title')}</h2>
          <p className={css.description}>{t('description')}</p>
        </div>
      </header>
      <fieldset className={css.roots} disabled={busy}>
        <legend>{t('selectedRoots')}</legend>
        {roots.length === 0 ? <p className={css.hint}>{t('noRoots')}</p> : roots.map(root => (
          <label className={css.check} key={root.id}>
            <input type="checkbox" checked={selectedRoots.includes(root.id)} onChange={() =>{  toggleRoot(root.id) }} />
            <span>{t(rootKindKey(root.kind), root.kind === 'custom' ? { index: customRootIndex(root.id) } : undefined)}</span>
          </label>
        ))}
      </fieldset>
      <div className={css.actions}>
        <button type="button" className={css.primary} onClick={() => void exportSelected()} disabled={busy}>{busy ? t('working') : t('export')}</button>
        <label className={css.secondary} aria-disabled={busy}>
          {t('importLabel')}
          <input type="file" accept="application/json,.json" disabled={busy}
            onChange={(event) => { void previewFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
        </label>
      </div>
      <p className={css.hint}>{t('importNotes')}</p>
      <p className={css.hint}>{t('secretNote')}</p>
      {preview !== undefined && <>
        {archivedRootIds(archiveText).map(id => (
          <label className={css.rootSelect} key={id}>
            <span>{t('targetRoot')}: {rootLabel(archiveText, id, t)}</span>
            <select value={rootMapping[id] ?? ''} disabled={busy} onChange={event => void updateRootMapping(id, event.currentTarget.value)}>
              <option value="">{t('chooseTarget')}</option>
              {roots.filter(root => root.kind !== 'bundled').map(root => <option key={root.id} value={root.id}>{t(rootKindKey(root.kind), root.kind === 'custom' ? { index: customRootIndex(root.id) } : undefined)}</option>)}
            </select>
          </label>
        ))}
        <ul className={css.items}>
          {preview.items.filter(item => item.status !== 'identical' && item.status !== 'unsupported').map(item => <li className={css.item} key={item.id}>
            <label className={css.itemLabel}>
              <input type="checkbox" disabled={busy || !['ready', 'conflict'].includes(item.status)}
                checked={selectedItems.includes(item.id)} onChange={() => {
                  setSelectedItems(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])
                }} />
              <span className={css.itemText}>
                <strong>{t(kindKey(item.kind))}: {item.id}</strong>
                <span>{t(statusKey(item.status))}</span>
                <span>{detailText(item, t)}</span>
              </span>
            </label>
          </li>)}
        </ul>
        {(['identical', 'unsupported'] as const).map((status) => {
          const items = preview.items.filter(item => item.status === status)
          if (items.length === 0) return null
          return <details className={css.group} key={status}>
            <summary>{t(status === 'identical' ? 'groupIdentical' : 'groupUnsupported', { count: items.length })}</summary>
            <ul className={css.items}>
              {items.map(item => <li className={css.item} key={item.id}>
                <span className={css.itemText}>
                  <strong>{t(kindKey(item.kind))}: {item.id}</strong>
                  <span>{t(statusKey(item.status))}</span>
                  <span>{detailText(item, t)}</span>
                </span>
              </li>)}
            </ul>
          </details>
        })}
        {!rootMappingReady && <p className={css.hint}>{t('chooseRoot')}</p>}
        {preview.items.some(item => item.status === 'failed') && <button type="button" className={css.secondaryButton} onClick={() => void refreshPreview()} disabled={busy}>{t('refreshPreview')}</button>}
        <button type="button" className={css.primary} onClick={() => void applySelected()} disabled={busy || selectedItems.length === 0 || !rootMappingReady}>{t('apply')}</button>
      </>}
      {message !== '' && <p className={css.message} role="status" aria-live="polite">{message}</p>}
    </section>
  )
}

async function requestPreview(archive: string, rootMapping: Record<string, string>): Promise<ImportPreview> {
  const response = await fetch(`${CONFIGURATION_BACKUP_PATH}?action=preview`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archive, rootMapping }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return parsePreview(await response.json())
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Configuration and skills backup Settings copy. */
    'settings.configurationSkillsBackup': ConfigurationSkillsBackupLocaleKey
  }
}

function parseRoots(value: unknown): BackupSkillRoot[] {
  if (!record(value) || !Array.isArray(value['roots'])) throw new Error('Skill root response is invalid.')
  return value['roots'].flatMap(root => record(root) && typeof root['id'] === 'string' && typeof root['label'] === 'string'
    && ['dsh-user', 'agents-user', 'project-dsh', 'project-agents', 'custom', 'bundled'].includes(String(root['kind']))
    ? [{ id: root['id'], label: root['label'], kind: root['kind'] as BackupSkillRoot['kind'] }] : [])
}

function parsePreview(value: unknown): ImportPreview {
  if (!record(value) || typeof value['archiveId'] !== 'string' || !Array.isArray(value['items'])) throw new Error('Backup operation response is invalid.')
  const items: BackupImportItem[] = value['items'].map((row) => {
    if (!record(row) || typeof row['id'] !== 'string' || typeof row['detail'] !== 'string'
      || !['config', 'bundle', 'skill-file'].includes(String(row['kind']))
      || !['ready', 'identical', 'conflict', 'missing', 'unsupported', 'applied', 'failed'].includes(String(row['status']))) {
      throw new Error('Backup operation item is invalid.')
    }
    return {
      id: row['id'], detail: row['detail'],
      kind: row['kind'] as BackupImportItem['kind'], status: row['status'] as BackupImportItem['status'],
    }
  })
  return { archiveId: value['archiveId'], items, ...(typeof value['journalPath'] === 'string' ? { journalPath: value['journalPath'] } : {}) }
}

function archivedRootIds(text: string, selectedItemIds?: readonly string[]): string[] {
  try {
    const value: unknown = JSON.parse(text)
    if (!record(value)) return []
    const rootIds = [value['skillDirectories'], value['skillFiles']].flatMap((rows, index) => Array.isArray(rows)
      ? rows.flatMap((row) => {
        if (!record(row) || typeof row['rootId'] !== 'string' || typeof row['path'] !== 'string') return []
        const itemId = `${index === 0 ? 'directory' : 'file'}:${row['rootId']}:${row['path']}`
        return selectedItemIds === undefined || selectedItemIds.includes(itemId) ? [row['rootId']] : []
      }) : [])
    return [...new Set(rootIds)]
  } catch { return [] }
}

function rootLabel(text: string, id: string, t: ConfigurationSkillsBackupPageProps['t']): string {
  try {
    const value: unknown = JSON.parse(text)
    if (!record(value) || !Array.isArray(value['skillRoots'])) return id
    const row: unknown = value['skillRoots'].find((root: unknown) => record(root) && root['id'] === id)
    return record(row) && typeof row['kind'] === 'string' && isRootKind(row['kind'])
      ? t(rootKindKey(row['kind']), row['kind'] === 'custom' ? { index: customRootIndex(id) } : undefined) : id
  } catch { return id }
}

function rootKindKey(kind: BackupSkillRoot['kind']): ConfigurationSkillsBackupLocaleKey {
  switch (kind) {
    case 'dsh-user': return 'rootDshUser'
    case 'agents-user': return 'rootAgentsUser'
    case 'project-dsh': return 'rootProjectDsh'
    case 'project-agents': return 'rootProjectAgents'
    case 'custom': return 'rootCustom'
    case 'bundled': return 'rootBundled'
    default: return kind satisfies never
  }
}

function customRootIndex(id: string): string {
  const match = id.match(/:(\d+)$/)
  return match?.[1] ?? '?'
}

function isRootKind(value: string): value is BackupSkillRoot['kind'] {
  return ['dsh-user', 'agents-user', 'project-dsh', 'project-agents', 'custom', 'bundled'].includes(value)
}

function detailText(item: BackupImportItem, t: ConfigurationSkillsBackupPageProps['t']): string {
  if (item.status === 'applied' && item.detail.startsWith('Applied;')) {
    return item.detail.endsWith('Verified.') ? t('detailAppliedVerified') : t('detailApplied')
  }
  const exact: Record<string, ConfigurationSkillsBackupLocaleKey> = {
    'The bundle is not installed or the current profile cannot resolve it.': 'detailBundleMissing',
    'Already selected.': 'detailAlreadySelected',
    'Installed and available for selection.': 'detailBundleReady',
    'No destination skill root was selected.': 'detailRootMissing',
    'Directory already exists.': 'detailDirectoryExists',
    'Directory will be created.': 'detailDirectoryReady',
    'A non-directory occupies this path.': 'detailDirectoryConflict',
    'The destination file already matches.': 'detailFileIdentical',
    'A new file will be created.': 'detailFileReady',
    'A different destination file exists.': 'detailFileConflict',
    'The plugin is not active in this profile.': 'detailConfigMissing',
    'The active plugin Config schema is unavailable.': 'detailSchemaMissing',
    'The archive contains a value at a schema-declared secret field.': 'detailSecretPresent',
    'Configuration already matches.': 'detailConfigIdentical',
    'Non-secret overrides differ; confirmation is required.': 'detailConfigConflict',
    'Configuration can be restored.': 'detailConfigReady',
  }
  const key = exact[item.detail]
  if (key !== undefined) return t(key)
  if (item.detail.startsWith('Apply failed: ')) return t('detailApplyFailed', { message: item.detail.slice('Apply failed: '.length) })
  if (item.status === 'unsupported') return t('detailUnsupported', { message: item.detail })
  return item.detail
}

function kindKey(kind: BackupImportItem['kind']): 'kindConfig' | 'kindBundle' | 'kindSkillFile' {
  switch (kind) {
    case 'config': return 'kindConfig'
    case 'bundle': return 'kindBundle'
    case 'skill-file': return 'kindSkillFile'
    default: return kind satisfies never
  }
}

function statusKey(status: BackupImportItem['status']): ConfigurationSkillsBackupLocaleKey {
  return statusKeys[status]
}

const statusKeys = {
  ready: 'statusReady', identical: 'statusIdentical', conflict: 'statusConflict', missing: 'statusMissing',
  unsupported: 'statusUnsupported', applied: 'statusApplied', failed: 'statusFailed',
} as const satisfies Record<BackupImportItem['status'], ConfigurationSkillsBackupLocaleKey>

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function responseError(response: Response): Promise<string> {
  const value: unknown = await response.json().catch(() => undefined)
  return record(value) && typeof value['error'] === 'string' ? value['error'] : `HTTP ${response.status}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
