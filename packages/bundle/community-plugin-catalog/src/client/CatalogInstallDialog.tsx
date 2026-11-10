/**
 * Reusable official-pipeline plugin install modal for the community catalog.
 * Manages inspect, pnpm live streaming logs, retry and profile activation
 * while keeping the community catalog panel open in the background.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  Button,
  IconCheckCircleFillRegular,
  IconChevronDownOutlineRegular,
  IconCloseOutlineRegular,
  IconWarningOutlineRegular,
  Modal,
  StateDot,
  TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginCatalogKey } from './locales.ts'
import css from './PluginCatalogPage.module.css'

/** Branded identifier correlating live install logs and state notifications. */
export type PluginInstallRequestId = string & { readonly __brand?: 'PluginInstallRequestId' }

/** Settled ChangeResult subset read from `pluginManager.installBundle`. */
export interface PluginInstallChangeResult {
  application?: string | undefined
  bundle?: string | undefined
  error?: { code?: string | undefined; diagnostic?: string | undefined; message?: string | undefined } | undefined
}

/** Minimal Host plugin-manager Remote subset used for in-dialog installation. */
export interface PluginManagerClientFace {
  installBundle?: (spec: string, options?: { enabled?: boolean; requestId?: PluginInstallRequestId }) => Promise<{
    ok: boolean
    value?: PluginInstallChangeResult | undefined
    error?: { message?: string | undefined } | undefined
  }>
  setBundleEnabled?: (name: string, enabled: boolean) => Promise<unknown>
  listBundles?: () => Promise<
    Array<{ name: string; installed?: boolean }> | { ok?: boolean; value?: Array<{ name: string; installed?: boolean }> }
  >
}

/** Props for the in-dialog official-pipeline plugin installer modal. */
export interface CatalogInstallDialogProps {
  readonly target: { readonly name: string; readonly spec: string; readonly description?: string | undefined }
  readonly pluginManager?: PluginManagerClientFace | undefined
  readonly onInstallLog?: ((listener: (chunk: { requestId?: string; data: string; stream?: string }) => void) => () => void) | undefined
  readonly onInstallState?: ((
    listener: (state: { requestId?: string; phase: string; attempt?: { registry: string; index: number; total: number } }) => void,
  ) => () => void) | undefined
  readonly onClose: () => void
  readonly onInstalled: (spec: string, bundle?: string) => void
  readonly t: (key: PluginCatalogKey, values?: Record<string, string | number>) => string
}

/**
 * Installation dialog that invokes the official Host installBundle capability
 * and streams live command outputs to the user without closing the catalog overlay.
 * @param props Target plugin details, log subscribers, localized translator, and completion callback.
 * @returns An anchored Modal overlay with ongoing progress and terminal details.
 */
export function CatalogInstallDialog({
  target,
  pluginManager,
  onInstallLog,
  onInstallState,
  onClose,
  onInstalled,
  t,
}: CatalogInstallDialogProps): ReactNode {
  const [phase, setPhase] = useState<'checking' | 'installing' | 'done' | 'failed'>('checking')
  const [logs, setLogs] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [attemptLine, setAttemptLine] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const run = useCallback(async () => {
    if (!pluginManager?.installBundle) {
      setPhase('failed')
      setErrorMessage(t('installerUnavailable'))
      return
    }
    setPhase('checking')
    setErrorMessage(null)
    setLogs('')
    setAttemptLine(null)

    const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined
    const requestId = (typeof cryptoApi?.randomUUID === 'function' ? cryptoApi.randomUUID() : String(Date.now())) as PluginInstallRequestId

    const disposeLog = onInstallLog?.((chunk) => {
      if (chunk.requestId === undefined || chunk.requestId === requestId) {
        setLogs(prev => prev + chunk.data)
      }
    })
    const disposeState = onInstallState?.((state) => {
      if (state.requestId === undefined || state.requestId === requestId) {
        if (state.phase === 'installing') {
          setPhase('installing')
          if (state.attempt) {
            setAttemptLine(t('tryingRegistry', {
              index: state.attempt.index,
              total: state.attempt.total,
              registry: state.attempt.registry,
            }))
          }
        }
      }
    })

    try {
      setPhase('installing')
      const result = await pluginManager.installBundle(target.spec, { enabled: true, requestId })
      const change = result.value
      if (
        !result.ok
        || change?.application === 'failed'
        || change?.application === 'cancelled'
      ) {
        setPhase('failed')
        setErrorMessage(
          change?.error?.diagnostic
          ?? change?.error?.message
          ?? (!result.ok ? result.error?.message : undefined)
          ?? t('installFailed'),
        )
        setDetailsOpen(true)
        return
      }
      setPhase('done')
      const bundleName = change?.bundle ?? target.spec
      try {
        await pluginManager.setBundleEnabled?.(bundleName, true)
      } catch {
        // Handled by enabled: true in installBundle
      }
      onInstalled(target.spec, bundleName)
    } catch (err) {
      setPhase('failed')
      setErrorMessage(err instanceof Error ? err.message : String(err))
      setDetailsOpen(true)
    } finally {
      disposeLog?.()
      disposeState?.()
    }
  }, [onInstallLog, onInstallState, onInstalled, pluginManager, t, target.spec])

  useEffect(() => {
    void run()
  }, [])

  const terminalLabels = {
    signal: (sig: string) => t('terminalSignal', { sig }),
    exitCode: (code: number) => t('terminalExitCode', { code }),
    noExitCode: t('terminalNoExitCode'),
    running: t('terminalRunning'),
    failed: t('terminalFailed'),
    done: t('terminalDone'),
    copy: t('terminalCopy'),
    copied: t('terminalCopied'),
    noOutput: t('terminalNoOutput'),
    collapseAria: t('terminalCollapseAria'),
    collapse: t('terminalCollapse'),
    expandAria: (hidden: number) => t('terminalExpandAria', { count: hidden }),
    expand: (hidden: number) => t('terminalExpand', { count: hidden }),
  }

  const heading = t('addPluginHeading')

  return (
    <Modal
      open
      onClose={phase === 'installing' ? () => {} : onClose}
      title={heading}
      headless
      className={css.installModalDialog ?? ''}
    >
      <div className={css.installModalPanel}>
        <div className={css.installModalHeader}>
          <h3 className={css.installModalTitle}>{heading}</h3>
          <button
            type="button"
            className={css.close}
            aria-label={t('close')}
            disabled={phase === 'installing'}
            onClick={onClose}
          >
            <IconCloseOutlineRegular size={16} />
          </button>
        </div>

        <div className={css.installCard}>
          <div className={css.installCardNameLine}>
            <strong className={css.installCardName}>{target.name}</strong>
            <span className={css.installCardSpec}>{target.spec}</span>
          </div>
          {target.description ? <p className={css.installCardDesc}>{target.description}</p> : null}
        </div>

        <div className={css.installStatusRow}>
          {phase === 'checking' || phase === 'installing' ? (
            <>
              <StateDot state="ongoing" size={18} />
              <span className={css.installStatusText}>
                {phase === 'checking' ? t('checkingRegistry') : t('installingProgress')}
              </span>
            </>
          ) : phase === 'done' ? (
            <div className={css.installStatusSuccess}>
              <IconCheckCircleFillRegular size={18} />
              <span className={css.installStatusText}>
                {t('installSuccess')}
              </span>
            </div>
          ) : (
            <div className={css.installStatusError}>
              <IconWarningOutlineRegular size={18} />
              <span className={css.installStatusText}>
                {errorMessage ?? t('installFailedSentence')}
              </span>
            </div>
          )}
        </div>

        {attemptLine && (phase === 'checking' || phase === 'installing') ? (
          <p className={css.installAttempt}>{attemptLine}</p>
        ) : null}

        <div className={css.installDetailsSection}>
          <button
            type="button"
            className={css.installLogsToggle}
            onClick={() => { setDetailsOpen(prev => !prev) }}
          >
            <span>{detailsOpen ? t('hideInstallDetails') : t('viewInstallDetails')}</span>
            <IconChevronDownOutlineRegular
              className={detailsOpen ? css.chevronOpen : css.chevronClosed}
              aria-hidden="true"
            />
          </button>

          {detailsOpen ? (
            <div className={css.installTerminalWrap}>
              <TerminalBlock
                command={`pnpm add ${target.spec}`}
                output={logs || t('runningPnpmInstall')}
                running={phase === 'checking' || phase === 'installing'}
                exitCode={phase === 'done' ? 0 : phase === 'failed' ? 1 : undefined}
                maxLines={10}
                labels={terminalLabels}
              />
            </div>
          ) : null}
        </div>

        <div className={css.installFooter}>
          {phase === 'failed' ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={() => { void run() }}>
                {t('retry')}
              </Button>
            </>
          ) : phase === 'done' ? (
            <Button variant="primary" autoFocus onClick={onClose}>
              {t('done')}
            </Button>
          ) : (
            <Button variant="outline" disabled onClick={onClose}>
              {t('installingEllipsis')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
