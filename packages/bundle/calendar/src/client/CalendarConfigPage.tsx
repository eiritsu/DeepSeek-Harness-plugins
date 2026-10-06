/** Plugins detail page: subscription management and ICS import. */
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, Input, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CalendarImportedCalendar, CalendarSubscription, CalendarSubscriptionId } from '../types.ts'
import { checkSubscriptionUrl, MAX_CALENDAR_NAME_LENGTH } from '../client-api.ts'
import { formatDateTime, subscriptionColor } from './calendar-model.ts'
import type { CalendarActionResult, CalendarFace } from './controller.ts'
import { configZh, type CalendarConfigKey } from './locales.ts'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import css from './CalendarConfigPage.module.css'

/** Renderer-bound props of the bundle detail page. */
export type CalendarConfigPageProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<'settings.calendar'> & InjectFace<CalendarFace>

/** Which stored source the removal confirmation is about. */
type RemoveTarget =
  | { kind: 'subscription'; value: CalendarSubscription }
  | { kind: 'imported'; value: CalendarImportedCalendar }

/**
 * Render subscription management and ICS import for one bundle detail page.
 * @param props - injected face, localized strings, and the calendar store hook.
 * @returns the configuration page.
 */
export function CalendarConfigPage(props: CalendarConfigPageProps): ReactNode {
  const { t, useCalendar, ...face } = props
  const state = useCalendar(snapshot => snapshot)
  const locale = t('time.locale')
  const zone = state.snapshotTimeZone || state.hostTimeZone

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [interval, setInterval] = useState('')
  const [formError, setFormError] = useState<{ key: CalendarConfigKey; detail?: string }>()
  const [importName, setImportName] = useState('')
  const [ics, setIcs] = useState('')
  const [importFileName, setImportFileName] = useState('')
  const [readingFile, setReadingFile] = useState(false)
  const [importError, setImportError] = useState<{ key: CalendarConfigKey; detail?: string }>()
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget>()
  const [editing, setEditing] = useState<CalendarSubscription>()
  const fileInput = useRef<HTMLInputElement>(null)

  const busy = state.feedback.busy

  const startEdit = (subscription: CalendarSubscription): void => {
    setName(subscription.name)
    setUrl(subscription.url)
    setEnabled(subscription.enabled)
    setInterval(String(subscription.refreshIntervalSeconds))
    setFormError(undefined)
    setEditing(subscription)
  }

  const resetForm = (): void => {
    setName(''); setUrl(''); setEnabled(true); setInterval(''); setEditing(undefined); setFormError(undefined)
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (trimmedName === '' || trimmedName.length > MAX_CALENDAR_NAME_LENGTH) { setFormError({ key: 'error' }); return }
    const checked = checkSubscriptionUrl(url)
    if (!checked.ok) { setFormError({ key: failureKey(checked.code) }); return }
    const seconds = interval.trim() === '' ? undefined : Number(interval)
    if (seconds !== undefined && (!Number.isSafeInteger(seconds) || seconds <= 0)) {
      setFormError({ key: 'error' })
      return
    }
    setFormError(undefined)
    const draft = {
      name: trimmedName, url: checked.url, enabled,
      ...(seconds === undefined ? {} : { refreshIntervalSeconds: Math.round(seconds) }),
    }
    const pending = editing === undefined ? face.addSubscription(draft) : face.updateSubscription(editing.id, draft)
    void pending.then((result) => {
      if (result.ok) resetForm()
      else setFormError({ key: configKey(result.key), ...(result.detail === undefined ? {} : { detail: result.detail }) })
    })
  }

  const toggleEnabled = (subscription: CalendarSubscription, enabled: boolean): void => {
    void face.updateSubscription(subscription.id, {
      name: subscription.name, url: subscription.url, enabled,
      refreshIntervalSeconds: subscription.refreshIntervalSeconds,
    })
  }

  const importIcs = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (readingFile) return
    if (importName.trim() === '' || ics.trim() === '') { setImportError({ key: 'import.invalid-ics' }); return }
    setImportError(undefined)
    void face.importIcs(importName, ics).then((result) => {
      if (result.ok) { setImportName(''); setIcs(''); setImportFileName(''); if (fileInput.current !== null) fileInput.current.value = '' }
      else setImportError({ key: configKey(result.key), ...(result.detail === undefined ? {} : { detail: result.detail }) })
    })
  }

  const readFile = (event: ChangeEvent<HTMLInputElement>): void => {
    if (readingFile) return
    const input = event.currentTarget
    const file = input.files?.[0]
    if (file === undefined) return
    input.value = ''
    setIcs('')
    setImportFileName(file.name)
    if (importName.trim() === '') setImportName(file.name.replace(/\.ics$/iu, ''))
    setImportError(undefined)
    setReadingFile(true)
    try {
      void file.text()
        .then(setIcs, () => { setImportError({ key: 'import.read-failed' }) })
        .finally(() => { setReadingFile(false) })
    } catch {
      setImportError({ key: 'import.read-failed' })
      setReadingFile(false)
    }
  }

  const removeSubscription = (id: CalendarSubscriptionId): Promise<CalendarActionResult> => face.removeSubscription(id)

  const removeLabels = removeTarget === undefined
    ? undefined
    : removeTarget.kind === 'imported'
      ? { title: t('removeImportedTitle'), description: t('removeImportedDescription'), confirm: t('removeImportedConfirm') }
      : { title: t('removeTitle'), description: t('removeDescription'), confirm: t('removeConfirm') }

  return (
    <div className={css.page}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>

      {state.feedback.key === undefined ? null : (
        <p className={state.feedback.ok === true ? css.notice : css.noticeError} role="status">
          {state.feedback.ok === true ? t('saved') : t(configKey(state.feedback.key))}
          {state.feedback.detail === undefined ? null : <span className={css.noticeDetail}> {state.feedback.detail}</span>}
          <button type="button" className={css.noticeDismiss} aria-label={t('notice.dismiss')} onClick={() => { face.clearFeedback() }}>
            <IconCloseOutlineRegular size={14} />
          </button>
        </p>
      )}
      <p className={css.hint}>{t('readonlyHint')}</p>
      <p className={css.hint}>{t('holidayHint')}</p>

      <section className={css.section} aria-label={t('subscriptions')}>
        <h3 className={css.sectionTitle}>{t('subscriptions')}</h3>
        <form className={css.form} onSubmit={submit}>
          <label className={css.field} htmlFor="calendar-sub-name">
            <span className={css.fieldLabel}>{editing === undefined ? t('name') : t('edit')}</span>
            <Input id="calendar-sub-name" className={css.inputWrap ?? ''} value={name} placeholder={t('namePlaceholder')} maxLength={MAX_CALENDAR_NAME_LENGTH}
              onChange={(event) => { setName(event.currentTarget.value) }} />
          </label>
          <label className={css.field} htmlFor="calendar-sub-url">
            <span className={css.fieldLabel}>{t('url')}</span>
            <Input id="calendar-sub-url" className={css.inputWrap ?? ''} value={url} placeholder={t('urlPlaceholder')} type="url"
              onChange={(event) => { setUrl(event.currentTarget.value) }} />
            <span className={css.fieldHint}>{t('urlHint')}</span>
          </label>
          <div className={css.formRow}>
            <label className={css.field} htmlFor="calendar-sub-interval">
              <span className={css.fieldLabel}>{t('refreshInterval')}</span>
              <span className={css.fieldHint}>{t('refreshIntervalHint')}</span>
              <input id="calendar-sub-interval" className={css.native} type="number"
                min={1}
                placeholder={t('refreshIntervalPlaceholder')}
                value={interval} onChange={(event) => { setInterval(event.currentTarget.value) }} />
            </label>
            <div className={css.enabledSwitch}>
              <span className={css.fieldLabel}>{t('enabled')}</span>
              <Switch checked={enabled} label={t('enabled')} disabled={busy} onChange={setEnabled} />
            </div>
          </div>
          {formError === undefined ? null : (
            <p className={css.formError} role="alert">{t(formError.key)}{formError.detail === undefined ? null : <span className={css.noticeDetail}> {formError.detail}</span>}</p>
          )}
          <div className={css.formActions}>
            {editing === undefined ? null : <Button variant="outline" type="button" className={css.dangerButton} onClick={resetForm} disabled={busy}>{t('cancel')}</Button>}
            <Button variant="primary" type="submit" className={css.primaryButton} disabled={busy}>{busy ? t('adding') : editing === undefined ? t('add') : t('save')}</Button>
          </div>
        </form>

        {state.subscriptions.length === 0 ? <p className={css.empty}>{t('empty')}</p> : (
          <ul className={css.list}>
            {state.subscriptions.map(subscription => (
              <li key={subscription.id} className={css.row}>
                <span className={css.colorDot} style={{ background: subscriptionColor(subscription.id) }} aria-hidden />
                <div className={css.rowMain}>
                  <div className={css.rowName}>
                    {subscription.name}
                    <Tag tone={subscription.enabled ? 'success' : 'neutral'}>{subscription.enabled ? t('enabled') : t('disabled')}</Tag>
                    <span className={css.rowCount}>{t('entryCount', { count: subscription.entryCount })}</span>
                    {subscription.droppedEntryCount > 0
                      ? <span className={css.rowCount}>{t('droppedCount', { count: subscription.droppedEntryCount })}</span>
                      : null}
                  </div>
                  <span className={css.rowMeta}>
                    {subscription.lastRefreshedAt === undefined
                      ? t('neverSynced')
                      : t('lastSync', { time: formatDateTime(subscription.lastRefreshedAt, zone, locale) })}
                  </span>
                  {subscription.lastFailure === undefined ? null : (
                    <span className={css.rowError} role="alert">
                      {t('lastError', { message: subscriptionFailureText(subscription.lastFailure.code, t) })}
                    </span>
                  )}
                </div>
                <div className={css.rowActions}>
                  <div className={css.enabledSwitch}>
                    <span className={css.fieldLabel}>{t('enabled')}</span>
                    <Switch checked={subscription.enabled} label={t('enabledFor', { name: subscription.name })} disabled={busy}
                      onChange={(next) => { toggleEnabled(subscription, next) }} />
                  </div>
                  <Button variant="outline" size="sm" className={css.actionButton} aria-label={t('editSubscription', { name: subscription.name })} disabled={busy}
                    onClick={() => { startEdit(subscription) }}>
                    {t('edit')}
                  </Button>
                  <Button variant="outline" size="sm" className={css.actionButton} aria-label={subscription.refreshing ? t('refreshingSubscription', { name: subscription.name }) : t('refreshSubscription', { name: subscription.name })} disabled={busy || subscription.refreshing}
                    onClick={() => { void face.refreshSubscription(subscription.id) }}>
                    {subscription.refreshing ? t('refreshing') : t('refresh')}
                  </Button>
                  <Button variant="outline" size="sm" className={`${css.dangerButton} ${css.actionButton}`} aria-label={t('removeSubscription', { name: subscription.name })} disabled={busy}
                    onClick={() => { setRemoveTarget({ kind: 'subscription', value: subscription }) }}>
                    {t('remove')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={css.section} aria-label={t('importTitle')}>
        <h3 className={css.sectionTitle}>{t('importTitle')}</h3>
        <form className={css.form} onSubmit={importIcs}>
          <label className={css.field} htmlFor="calendar-import-name">
            <span className={css.fieldLabel}>{t('importName')}</span>
            <Input id="calendar-import-name" className={css.inputWrap ?? ''} value={importName} maxLength={MAX_CALENDAR_NAME_LENGTH}
              onChange={(event) => { setImportName(event.currentTarget.value) }} />
          </label>
          <div className={css.field}>
            <span className={css.fieldLabel}>{t('importFile')}</span>
            <div className={css.filePicker}>
              <input ref={fileInput} id="calendar-import-file" className={css.fileInput} type="file" accept=".ics,text/calendar"
                aria-label={t('importFile')} disabled={readingFile} onChange={readFile} />
              <label className={css.fileButton} htmlFor="calendar-import-file">{t('chooseFile')}</label>
              <span className={css.fileName} aria-live="polite">{importFileName || t('noFileSelected')}</span>
            </div>
          </div>
          <label className={css.field} htmlFor="calendar-import-text">
            <span className={css.fieldLabel}>{t('importText')}</span>
            <textarea id="calendar-import-text" className={css.textarea} rows={4} value={ics} placeholder={t('importTextPlaceholder')} disabled={readingFile}
              onChange={(event) => { setIcs(event.currentTarget.value) }} />
          </label>
          {importError === undefined ? null : (
            <p className={css.formError} role="alert">{t(importError.key)}{importError.detail === undefined ? null : <span className={css.noticeDetail}> {importError.detail}</span>}</p>
          )}
          <div className={css.formActions}>
            <Button variant="primary" type="submit" className={css.primaryButton} disabled={busy || readingFile}>{readingFile ? t('readingFile') : busy ? t('importing') : t('importAction')}</Button>
          </div>
        </form>
        <h4 className={css.subHeading}>{t('imported')}</h4>
        {state.imported.length === 0 ? <p className={css.empty}>{t('importedEmpty')}</p> : (
          <ul className={css.list}>
            {state.imported.map(calendar => (
              <li key={calendar.id} className={css.row}>
                <div className={css.rowMain}>
                  <div className={css.rowName}>{calendar.name}</div>
                  <span className={css.rowMeta}>{t('importedCount', { count: calendar.entryCount, dropped: calendar.droppedEntryCount })}</span>
                </div>
                <div className={css.rowActions}>
                  <Button variant="outline" size="sm" className={`${css.dangerButton} ${css.actionButton}`} disabled={busy}
                    onClick={() => { setRemoveTarget({ kind: 'imported', value: calendar }) }}>
                    {t('removeImported')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {removeTarget === undefined || removeLabels === undefined ? null : (
        <ConfirmDialog
          title={removeLabels.title}
          description={removeLabels.description}
          confirmLabel={busy ? t('removing') : removeLabels.confirm}
          cancelLabel={t('removeCancel')}
          busy={busy}
          onConfirm={() => {
            const target = removeTarget
            const action = target.kind === 'subscription'
              ? removeSubscription(target.value.id)
              : face.removeImported(target.value.id)
            void action.then((result) => { if (result.ok) setRemoveTarget(undefined) })
          }}
          onCancel={() => { setRemoveTarget(undefined) }}
        />
      )}
    </div>
  )
}

/** Config-namespace key for a controller feedback key, falling back to `error`. */
function configKey(key: string): CalendarConfigKey {
  return isConfigKey(key) ? key : 'error'
}

function isConfigKey(key: string): key is CalendarConfigKey {
  return Object.prototype.hasOwnProperty.call(configZh, key)
}

function failureKey(code: string): CalendarConfigKey {
  return configKey(`failure.${code}`)
}

function subscriptionFailureText(code: string, t: (key: CalendarConfigKey) => string): string {
  return t(configKey(`failure.${code}`))
}

/** Strip a subscription URL's query string so a private token is never re-shown.
 * @param url - stored absolute subscription URL.
 * @returns the protocol, host, and path only.
 */
export function maskUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.protocol}//${parsed.host}${path}`
  } catch {
    return url.split('?')[0] ?? url
  }
}
