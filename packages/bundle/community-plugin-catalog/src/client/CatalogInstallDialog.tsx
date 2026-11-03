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

export type PluginInstallRequestId = string & { readonly __brand?: 'PluginInstallRequestId' }

export interface PluginManagerClientFace {
  installBundle?: (spec: string, options?: { enabled?: boolean; requestId?: PluginInstallRequestId }) => Promise<{
    ok: boolean
    value?: { bundle?: string }
    error?: { message?: string }
  }>
  setBundleEnabled?: (name: string, enabled: boolean) => Promise<unknown>
  listBundles?: () => Promise<
    Array<{ name: string; installed?: boolean }> | { ok?: boolean; value?: Array<{ name: string; installed?: boolean }> }
  >
}

export interface CatalogInstallDialogProps {
  readonly target: { readonly name: string; readonly spec: string; readonly description?: string }
  readonly pluginManager?: PluginManagerClientFace
  readonly onInstallLog?: (listener: (chunk: { requestId?: string; data: string; stream?: string }) => void) => () => void
  readonly onInstallState?: (
    listener: (state: { requestId?: string; phase: string; attempt?: { registry: string; index: number; total: number } }) => void,
  ) => () => void
  readonly onClose: () => void
  readonly onInstalled: (spec: string, bundle?: string) => void
  readonly language: 'zh' | 'en'
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
  language,
  t,
}: CatalogInstallDialogProps): ReactNode {
  const [phase, setPhase] = useState<'checking' | 'installing' | 'done' | 'failed'>('checking')
  const [logs, setLogs] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [attemptLine, setAttemptLine] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const isZh = language === 'zh'

  const run = useCallback(async () => {
    if (!pluginManager?.installBundle) {
      setPhase('failed')
      setErrorMessage(isZh ? '官方插件安装服务暂时不可用' : 'Official plugin installer is currently unavailable')
      return
    }
    setPhase('checking')
    setErrorMessage(null)
    setLogs('')
    setAttemptLine(null)

    const requestId = (globalThis.crypto?.randomUUID?.() ?? String(Date.now())) as PluginInstallRequestId

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
            setAttemptLine(isZh
              ? `尝试安装源 (${state.attempt.index}/${state.attempt.total})：${state.attempt.registry}`
              : `Trying registry (${state.attempt.index}/${state.attempt.total}): ${state.attempt.registry}`)
          }
        }
      }
    })

    try {
      setPhase('installing')
      const result = await pluginManager.installBundle(target.spec, { enabled: true, requestId })
      if (!result || (result.ok === false && result.error)) {
        setPhase('failed')
        setErrorMessage(result?.error?.message ?? (isZh ? '安装失败' : 'Installation failed'))
        setDetailsOpen(true)
        return
      }
      setPhase('done')
      const bundleName = (result.value as { bundle?: string } | undefined)?.bundle ?? target.spec
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
  }, [isZh, onInstallLog, onInstallState, onInstalled, pluginManager, target.spec])

  useEffect(() => {
    void run()
  }, [])

  const terminalLabels = {
    signal: (sig: string) => `Signal ${sig}`,
    exitCode: (code: number) => (isZh ? `退出码 ${code}` : `Exit code ${code}`),
    noExitCode: isZh ? '未提供退出状态' : 'No exit status',
    running: isZh ? '正在运行' : 'Running',
    failed: isZh ? '失败' : 'Failed',
    done: isZh ? '完成' : 'Done',
    copy: isZh ? '复制' : 'Copy',
    copied: isZh ? '已复制' : 'Copied',
  }

  const heading = isZh ? '添加插件' : 'Add Plugin'

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
                {phase === 'checking'
                  ? (isZh ? '正在检查插件源并准备安装…' : 'Checking plugin registry and preparing…')
                  : (isZh ? '正在自动安装插件并配置环境，请稍候…' : 'Installing plugin and configuring environment…')}
              </span>
            </>
          ) : phase === 'done' ? (
            <div className={css.installStatusSuccess}>
              <IconCheckCircleFillRegular size={18} />
              <span className={css.installStatusText}>
                {isZh ? '插件安装成功！已在 Profile 中启用。' : 'Plugin successfully installed and enabled in Profile.'}
              </span>
            </div>
          ) : (
            <div className={css.installStatusError}>
              <IconWarningOutlineRegular size={18} />
              <span className={css.installStatusText}>
                {errorMessage ?? (isZh ? '插件安装失败。' : 'Plugin installation failed.')}
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
            <span>{detailsOpen ? (isZh ? '收起安装详情' : 'Hide install details') : (isZh ? '查看安装详情' : 'View install details')}</span>
            <IconChevronDownOutlineRegular
              className={detailsOpen ? css.chevronOpen : css.chevronClosed}
              aria-hidden="true"
            />
          </button>

          {detailsOpen ? (
            <div className={css.installTerminalWrap}>
              <TerminalBlock
                command={`pnpm add ${target.spec}`}
                output={logs || (isZh ? '正在执行官方 pnpm 安装流程…' : 'Running official pnpm install…')}
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
                {isZh ? '取消' : 'Cancel'}
              </Button>
              <Button variant="primary" onClick={() => { void run() }}>
                {isZh ? '重试' : 'Retry'}
              </Button>
            </>
          ) : phase === 'done' ? (
            <Button variant="primary" autoFocus onClick={onClose}>
              {isZh ? '完成' : 'Done'}
            </Button>
          ) : (
            <Button variant="outline" disabled onClick={onClose}>
              {isZh ? '安装中…' : 'Installing…'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
