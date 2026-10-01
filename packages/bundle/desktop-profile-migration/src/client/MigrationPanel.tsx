/** Explicit choice screen for the one-time Desktop profile bundle migration. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopProfileMigrationState } from '../types.ts'
import { applyMigrationSelection, splitInstalledCandidates } from './selection.ts'
import type { DesktopMigrationLocaleKey } from './locales.ts'
import css from './MigrationPanel.module.css'

/** Remotes consumed by this page. */
export interface MigrationPanelFace {
  readonly migration: {
    read(): Promise<DesktopProfileMigrationState>
    complete(expected: readonly string[], chosen: readonly string[]): Promise<DesktopProfileMigrationState>
  }
  readonly bundles: {
    listBundles(): Promise<
      | { readonly ok: true; readonly value: readonly { readonly name: string; readonly installed: boolean }[] }
      | { readonly ok: false; readonly error: { readonly message: string } }
    >
    setBundleEnabled(name: string, enabled: boolean): Promise<
      | { readonly ok: true; readonly value: { readonly application: string } }
      | { readonly ok: false; readonly error: { readonly message: string } }
    >
  }
}

type Props = PropsRuntime<'settings.plugins.tab'> & PropsLocale<'settings.desktopMigration'> & InjectFace<MigrationPanelFace>

const LABELS = {
  '@deepseek-ai/dsh-community-plugin-catalog': 'pluginCatalog',
  '@deepseek-ai/dsh-community-skill-catalog': 'skillCatalog',
  '@deepseek-ai/dsh-file-recognizer-office': 'officeFiles',
  '@deepseek-ai/dsh-model-catalog': 'modelCatalog',
  '@deepseek-ai/dsh-copy-session-id': 'copySessionId',
  '@deepseek-ai/dsh-turn-process-shimmer': 'turnTreatment',
  '@deepseek-ai/dsh-session-archive': 'sessionArchive',
  '@deepseek-ai/dsh-lark-integration': 'lark',
} as const satisfies Record<string, DesktopMigrationLocaleKey>

/** Render optional candidates without changing profile selection until confirmed. */
export function MigrationPanel({ migration, bundles, t }: Props): ReactNode {
  const [state, setState] = useState<DesktopProfileMigrationState>()
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [installed, setInstalled] = useState<Set<string>>(new Set())
  const [missing, setMissing] = useState<string[]>([])
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()
  const live = useRef(false)
  const initialRead = useRef(false)
  /** Read the live mount latch; the call keeps an await from reusing a narrowed value. */
  const isLive = (): boolean => live.current

  const refresh = useCallback(async (): Promise<DesktopProfileMigrationState> => {
    const [value, inventory] = await Promise.all([migration.read(), bundles.listBundles()])
    if (!inventory.ok) throw new Error(inventory.error.message)
    const split = splitInstalledCandidates(value.candidates, inventory.value)
    if (live.current) {
      if (!initialRead.current) {
        initialRead.current = true
        setHidden(value.complete)
      }
      setState(value)
      setInstalled(new Set(split.installed))
      setMissing([...split.missing])
      setChosen(new Set())
    }
    return value
  }, [bundles, migration])

  useEffect(() => {
    live.current = true
    void refresh().catch((error: unknown) => { if (live.current) setMessage(t('failed', { reason: messageOf(error) })) })
    return () => { live.current = false }
  }, [refresh, t])

  if (hidden) return null
  const run = async (confirm: boolean): Promise<void> => {
    if (state === undefined || busy) return
    setBusy(true)
    setMessage(undefined)
    try {
      const selected = confirm ? state.candidates.filter(name => chosen.has(name) && installed.has(name)) : []
      const result = await applyMigrationSelection(state.selected, selected, {
        setBundleEnabled: (name, enabled) => bundles.setBundleEnabled(name, enabled),
        read: () => migration.read(),
        complete: (expected, names) => migration.complete(expected, names),
      })
      if (!live.current) return
      if (result.kind === 'partial') {
        await refresh()
        if (isLive()) setMessage(t('partial', { name: labelFor(result.failedName, t) }))
        return
      }
      setMessage(t(result.restartRequired ? 'completeRestart' : 'complete'))
      setState(result.state)
    } catch (error) {
      try {
        const current = await refresh()
        if (live.current && !current.complete) setMessage(t('failed', { reason: messageOf(error) }))
      } catch {
        if (live.current) setMessage(t('failed', { reason: messageOf(error) }))
      }
    } finally {
      if (live.current) setBusy(false)
    }
  }

  return <section className={css.panel} aria-busy={busy}>
    <h2>{t('title')}</h2>
    {state === undefined ? <p role="status">{message ?? t('loading')}</p> : null}
    {state?.eligible === false ? <p>{t('unavailable')}</p> : null}
    {state?.warning !== undefined ? <p role="alert">{t('warning', { reason: state.warning })}</p> : null}
    {state?.eligible === true && state.complete ? <p>{t('complete')}</p> : null}
    {state?.eligible === true && !state.complete && state.warning === undefined ? <>
      <p>{t('body')}</p>
      {state.selected.length > 0 && <p>{t('alreadySelected', { names: state.selected.join(', ') })}</p>}
      {missing.length > 0 && <p>{t('installFirst', { names: missing.map(name => labelFor(name, t)).join(', ') })}</p>}
      <fieldset disabled={busy} className={css.choices}>
        <legend>{t('title')}</legend>
        {state.candidates.filter(name => installed.has(name)).length === 0 ? <p>{t('empty')}</p> : state.candidates
          .filter(name => installed.has(name)).map(name => (
            <label className={css.choice} key={name}>
              <input type="checkbox" checked={chosen.has(name)} onChange={(event) => {
                const checked = event.currentTarget.checked
                setChosen((previous) => {
                  const next = new Set(previous)
                  if (checked) next.add(name)
                  else next.delete(name)
                  return next
                })
              }} />
              <span>{t(LABELS[name as keyof typeof LABELS])}</span>
            </label>
          ))}
      </fieldset>
      <div className={css.actions}>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => { void run(true) }}>{t('confirm')}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void run(false) }}>{t('keep')}</Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setHidden(true) }}>{t('later')}</Button>
      </div>
    </> : null}
    {message !== undefined ? <p role="status">{message}</p> : null}
  </section>
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function labelFor(name: string, t: Props['t']): string {
  const key = Object.hasOwn(LABELS, name) ? LABELS[name as keyof typeof LABELS] : undefined
  return key === undefined ? name : t(key)
}
