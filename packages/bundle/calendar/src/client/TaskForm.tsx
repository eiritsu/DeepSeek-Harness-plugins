/** Appointment create/edit form. Session, schedule, zone, and repeat rule. */
import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import {
  defaultRuleDraft, isValidTimeZone, validatePrompt, validateRuleDraft, validateTitle,
  type CalendarRuleDraft, type CalendarRuleKind,
} from './calendar-model.ts'
import type { CalendarActionResult } from './controller.ts'
import { WEEKDAY_KEYS, type CalendarKey } from './locales.ts'
import css from './CalendarPage.module.css'

/** One session choice shown by the form, with its display label and live state. */
export interface TaskFormSession {
  readonly id: string
  readonly live: boolean
  readonly label: string
}

/** One validated form submission handed to the page. */
export interface TaskFormSubmission {
  readonly sessionId: string
  readonly title: string
  readonly prompt: string
  readonly zone: string
  readonly rule: CalendarRuleDraft
}

/** Initial values when editing an existing task. */
export interface TaskFormInitial {
  readonly sessionId: string
  readonly title: string
  readonly prompt: string
  readonly zone: string
  readonly rule: CalendarRuleDraft
}

/** Props of the appointment form. */
export interface TaskFormProps {
  readonly mode: 'create' | 'edit'
  readonly sessions: readonly TaskFormSession[]
  readonly now: string
  readonly defaultZone: string
  readonly initial?: TaskFormInitial
  readonly t: TranslateNS<'calendar'>
  readonly onSubmit: (submission: TaskFormSubmission) => Promise<CalendarActionResult>
  readonly onCancel: () => void
}

const RULE_OPTIONS = [
  { kind: 'at', key: 'rule.option.at' },
  { kind: 'daily', key: 'rule.option.daily' },
  { kind: 'weekly', key: 'rule.option.weekly' },
  { kind: 'every', key: 'rule.option.every' },
] as const satisfies readonly { readonly kind: CalendarRuleKind; readonly key: CalendarKey }[]
const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7]
const ZONE_SUGGESTIONS: readonly string[] = [
  'UTC', 'Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin',
  'America/New_York', 'America/Los_Angeles', 'Australia/Sydney',
]

/**
 * Render the appointment form and submit a validated draft.
 * @param props - mode, sessions, defaults, and submit handler.
 * @returns the form element.
 */
export function TaskForm(props: TaskFormProps): ReactNode {
  const { mode, sessions, now, defaultZone, initial, t, onSubmit, onCancel } = props
  const [sessionId, setSessionId] = useState(initial?.sessionId ?? sessions[0]?.id ?? '')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [zone, setZone] = useState(initial?.zone ?? defaultZone)
  const [rule, setRule] = useState<CalendarRuleDraft>(initial?.rule ?? defaultRuleDraft(now, defaultZone))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ key: CalendarKey; detail?: string }>()

  const validate = (): CalendarKey | undefined => {
    if (sessions.length === 0 || !sessions.some(item => item.id === sessionId)) return 'create.invalidSession'
    return validateTitle(title) ?? validatePrompt(prompt)
      ?? (isValidTimeZone(zone.trim()) ? undefined : 'create.invalidTimezone')
      ?? validateRuleDraft(rule, zone.trim(), now)
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const errorKey = validate()
    if (errorKey !== undefined) { setError({ key: errorKey }); return }
    setBusy(true)
    setError(undefined)
    void onSubmit({ sessionId, title, prompt, zone: zone.trim(), rule }).then((result) => {
      setBusy(false)
      if (!result.ok) setError({ key: result.key, ...(result.detail === undefined ? {} : { detail: result.detail }) })
    })
  }

  const patch = (next: Partial<CalendarRuleDraft>): void => { setRule(current => ({ ...current, ...next })) }
  const selected = sessions.find(item => item.id === sessionId)

  return (
    <form className={css.form} onSubmit={submit} aria-label={mode === 'create' ? t('create.title') : t('edit.title')}>
      <h2 className={css.formTitle}>{mode === 'create' ? t('create.title') : t('edit.title')}</h2>
      {sessions.length === 0 ? <p className={css.formWarn}>{t('create.sessionEmpty')}</p> : null}

      <label className={css.field} htmlFor="calendar-session">
        <span className={css.fieldLabel}>{t('create.session')}</span>
        <select id="calendar-session" className={css.select} value={sessionId} disabled={sessions.length === 0}
          onChange={(event) => { setSessionId(event.currentTarget.value) }}>
          {sessions.length === 0 ? <option value="">{t('create.sessionChoose')}</option> : null}
          {sessions.map(item => (
            <option key={item.id} value={item.id}>
              {item.live ? item.label : `${item.label} · ${t('create.sessionDeferred')}`}
            </option>
          ))}
        </select>
        {selected === undefined || selected.live ? null : <span className={css.fieldHint}>{t('create.sessionNote')}</span>}
      </label>

      <label className={css.field} htmlFor="calendar-title">
        <span className={css.fieldLabel}>{t('create.name')}</span>
        <Input
          id="calendar-title"
          className={css.textInput ?? ''}
          value={title}
          placeholder={t('create.namePlaceholder')}
          maxLength={120}
          onChange={(event) => { setTitle(event.currentTarget.value) }} />
      </label>

      <label className={css.field} htmlFor="calendar-prompt">
        <span className={css.fieldLabel}>{t('create.instruction')}</span>
        <textarea id="calendar-prompt" className={css.textarea} value={prompt} rows={3}
          placeholder={t('create.instructionPlaceholder')}
          onChange={(event) => { setPrompt(event.currentTarget.value) }} />
      </label>

      {rule.kind === 'keep' ? <p className={css.fieldHint}>{t('create.keepHint')}</p> : (
        <label className={css.field} htmlFor="calendar-rule">
          <span className={css.fieldLabel}>{t('create.rule')}</span>
          <select id="calendar-rule" className={css.select} value={rule.kind}
            onChange={(event) => { patch({ kind: event.currentTarget.value as CalendarRuleKind }) }}>
            {RULE_OPTIONS.map(({ kind, key }) => <option key={kind} value={kind}>{t(key)}</option>)}
          </select>
        </label>
      )}

      {rule.kind === 'at' || rule.kind === 'daily' || rule.kind === 'weekly' ? (
        <div className={rule.kind === 'at' ? css.dateTime : css.dateTimeSingle}>
          {rule.kind === 'at' ? (
            <label className={css.field} htmlFor="calendar-date">
              <span className={css.fieldLabel}>{t('create.date')}</span>
              <input id="calendar-date" type="date" className={css.native} value={rule.date}
                onChange={(event) => { patch({ date: event.currentTarget.value }) }} />
            </label>
          ) : null}
          <label className={css.field} htmlFor="calendar-time">
            <span className={css.fieldLabel}>{t('create.time')}</span>
            <input id="calendar-time" type="time" className={css.native} value={rule.time}
              onChange={(event) => { patch({ time: event.currentTarget.value }) }} />
          </label>
        </div>
      ) : null}

      {rule.kind === 'weekly' ? (
        <fieldset className={css.fieldset}>
          <legend className={css.fieldLabel}>{t('create.weekdays')}</legend>
          <div className={css.weekdays}>
            {WEEKDAYS.map(day => (
              <label key={day} className={css.weekday}>
                <input type="checkbox" checked={rule.weekdays.includes(day)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked
                    patch({ weekdays: checked ? [...rule.weekdays, day] : rule.weekdays.filter(value => value !== day) })
                  }} />
                <span>{t(WEEKDAY_KEYS[day - 1] ?? 'grid.weekday.1')}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {rule.kind === 'every' ? (
        <label className={css.field} htmlFor="calendar-interval">
          <span className={css.fieldLabel}>{t('create.interval')}</span>
          <span className={css.interval}>
            <input id="calendar-interval" type="number" min={1} className={css.native} value={rule.everyAmount}
              onChange={(event) => { patch({ everyAmount: Number(event.currentTarget.value) }) }} />
            <select className={css.select} value={rule.everyUnit}
              onChange={(event) => { patch({ everyUnit: event.currentTarget.value as CalendarRuleDraft['everyUnit'] }) }}>
              <option value="second">{t('unit.second')}</option>
              <option value="minute">{t('unit.minute')}</option>
              <option value="hour">{t('unit.hour')}</option>
            </select>
          </span>
          <span className={css.fieldHint}>{t('create.intervalHint')}</span>
        </label>
      ) : null}

      {rule.kind === 'at' || rule.kind === 'daily' || rule.kind === 'weekly' ? (
        <label className={css.field} htmlFor="calendar-zone">
          <span className={css.fieldLabel}>{t('create.timezone')}</span>
          <Input
            id="calendar-zone"
            className={css.textInput ?? ''}
            value={zone}
            list="calendar-zone-list"
            onChange={(event) => { setZone(event.currentTarget.value) }} />
          <datalist id="calendar-zone-list">
            {[defaultZone, ...ZONE_SUGGESTIONS.filter(item => item !== defaultZone)].map(item => <option key={item} value={item} />)}
          </datalist>
        </label>
      ) : null}

      {error === undefined ? null : (
        <p className={css.formError} role="alert">
          {t(error.key)}
          {error.detail === undefined ? null : <span className={css.formDetail}> {error.detail}</span>}
        </p>
      )}

      <div className={css.formActions}>
        <Button
          variant="outline"
          type="button"
          className={css.dangerButton}
          onClick={onCancel}
          disabled={busy}
        >
          {t('create.cancel')}
        </Button>
        <Button
          variant="primary"
          type="submit"
          className={css.primaryAction}
          disabled={busy || sessions.length === 0}
        >
          {busy ? t('create.saving') : mode === 'create' ? t('create.save') : t('edit.save')}
        </Button>
      </div>
    </form>
  )
}
