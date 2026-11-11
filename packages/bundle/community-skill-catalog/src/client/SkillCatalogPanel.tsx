/** Dual-source community skill discovery overlay and pinned commit installer. */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  IconClockOutlineRegular,
  IconCloseOutlineRegular,
  IconDownloadOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  Input,
  Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InstalledSkill,
  SkillCatalogDetail,
  SkillCatalogItem,
  SkillCatalogPage,
  SkillCatalogSort,
  SkillCatalogSourceFilter,
  SkillCatalogTaxonomy,
  SkillInstallResult,
  SkillSourceWarning,
} from '@deepseek-ai/dsh-community-skill-catalog/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSkillCatalogStore } from './store.ts'
import type { SkillCatalogKey } from './locales.ts'
import css from './SkillCatalogPage.module.css'

type CatalogRemote = {
  taxonomy(forceRefresh?: boolean, signal?: AbortSignal): Promise<RemoteResult<SkillCatalogTaxonomy>>
  catalog(
    query: string,
    source?: SkillCatalogSourceFilter,
    category?: string,
    sort?: SkillCatalogSort,
    page?: number,
    pageSize?: number,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SkillCatalogPage>>
  detail(skillId: string, signal?: AbortSignal): Promise<RemoteResult<SkillCatalogDetail>>
  installSkill(skillId: string, commitSha: string, confirmed: boolean, signal?: AbortSignal): Promise<RemoteResult<SkillInstallResult>>
  listInstalledSkills?(): Promise<RemoteResult<readonly InstalledSkill[]>>
}

/** Remote handle injected into `SkillCatalogPanel`. */
export interface SkillCatalogPanelInjected { readonly api: CatalogRemote }
type Store = PropsStore<ReturnType<typeof createSkillCatalogStore>>
type Props = PropsRuntime<'shell.overlay'> & Store & PropsLocale<'skillCatalog'> & InjectFace<SkillCatalogPanelInjected>

const PAGE_SIZE = 24
const SOURCE_FILTERS: readonly { readonly value: SkillCatalogSourceFilter; readonly key: SkillCatalogKey }[] = [
  { value: 'all', key: 'sourceAll' },
  { value: 'github-index', key: 'sourceGithubIndex' },
  { value: 'skills-sh', key: 'sourceSkillsSh' },
]
const SORTS: readonly { readonly value: SkillCatalogSort; readonly key: SkillCatalogKey }[] = [
  { value: 'popular', key: 'popular' },
  { value: 'installs', key: 'installs' },
  { value: 'recent', key: 'recent' },
]
const QUICK_TOPICS: readonly { readonly key: SkillCatalogKey; readonly query: string }[] = [
  { key: 'topic_react', query: 'react' },
  { key: 'topic_typescript', query: 'typescript' },
  { key: 'topic_python', query: 'python' },
  { key: 'topic_pdf', query: 'pdf' },
  { key: 'topic_security', query: 'security' },
  { key: 'topic_testing', query: 'testing' },
  { key: 'topic_design', query: 'design' },
  { key: 'topic_review', query: 'code review' },
]
const CATEGORY_LOCALE_KEYS: Readonly<Record<string, SkillCatalogKey>> = {
  security: 'cat_security',
  development: 'cat_development',
  business: 'cat_business',
  devops: 'cat_devops',
  cloud: 'cat_cloud',
  'ai-ml': 'cat_ai_ml',
  marketing: 'cat_marketing',
  content: 'cat_content',
  workflow: 'cat_workflow',
  'web-development': 'cat_web_development',
  automation: 'cat_automation',
  frontend: 'cat_frontend',
  data: 'cat_data',
  productivity: 'cat_productivity',
  design: 'cat_design',
  'design-it': 'cat_design_it',
  media: 'cat_media',
  testing: 'cat_testing',
  backend: 'cat_backend',
  'api-integration': 'cat_api_integration',
  'code-quality': 'cat_code_quality',
  mobile: 'cat_mobile',
  'agent-orchestration': 'cat_agent_orchestration',
  seo: 'cat_seo',
  architecture: 'cat_architecture',
  meta: 'cat_meta',
  documentation: 'cat_documentation',
  general: 'cat_general',
}

function categoryLabel(slug: string, translate: Props['t']): string {
  const localeKey = CATEGORY_LOCALE_KEYS[slug]
  return localeKey !== undefined ? translate(localeKey) : slug.replace(/-/gu, ' ')
}

function sourceBadgeText(skill: SkillCatalogItem, translate: Props['t']): string {
  if (skill.sources.length > 1) return translate('dualSourceBadge')
  return skill.source === 'skills-sh' ? translate('skillsShBadge') : translate('githubBadge')
}

function warningText(warning: SkillSourceWarning, translate: Props['t']): string {
  if (warning.source === 'skills-sh') {
    return translate(warning.code === 'rate-limited' ? 'partialWarningSkillsShRateLimited' : 'partialWarningSkillsSh')
  }
  return translate(warning.code === 'rate-limited' ? 'partialWarningGithubRateLimited' : 'partialWarningGithub')
}

function errorMessage(reason: unknown, translate: Props['t']): string {
  const message = reason instanceof Error ? reason.message : ''
  if (typeof reason === 'object' && reason !== null && 'code' in reason && typeof reason.code === 'string') {
    if (reason.code === 'skill-catalog/rate-limited') return translate('rateLimited')
    if (reason.code === 'skill-catalog/source-unavailable') return translate('sourceUnavailable')
    if (reason.code === 'skill-catalog/search-required') return translate('searchRequired')
    if (reason.code === 'skill-catalog/review-required') return translate('reviewRequired')
    if (reason.code === 'skill-catalog/manifest-incomplete') {
      const details = 'details' in reason && typeof reason.details === 'object' && reason.details !== null ? reason.details : undefined
      const skippedFiles = details !== undefined && 'skippedFiles' in details && typeof details.skippedFiles === 'number'
        ? details.skippedFiles : undefined
      const limitReason = details !== undefined && 'limitReason' in details ? details.limitReason : undefined
      const reasonKey = limitReason === 'file_count' ? 'manifestFileCountLimit'
        : limitReason === 'file_size' ? 'manifestFileSizeLimit'
          : limitReason === 'total_size' ? 'manifestTotalSizeLimit' : undefined
      if (skippedFiles !== undefined && skippedFiles > 0 && reasonKey !== undefined) {
        return translate('manifestIncomplete', { count: skippedFiles.toLocaleString(), limit: translate(reasonKey) })
      }
      return translate('manifestIncompleteGeneric')
    }
    if (reason.code === 'skill-catalog/github-source-invalid') return translate('githubSourceInvalid')
    if (reason.code === 'skill-catalog/skill-markdown-missing') return translate('skillMarkdownMissing')
    if (reason.code === 'skill-catalog/file-integrity-failed') return translate('fileIntegrityFailed')
    if (reason.code === 'skill-catalog/skill-incompatible') return translate('skillIncompatible')
  }
  if (message.includes('did not resolve exclusively to public addresses')) return translate('networkDenied')
  return translate('failure')
}

function diagnosticMessage(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'skill-catalog/skill-incompatible') return ''
  let message: string
  if (reason instanceof Error) message = reason.message
  else if (typeof reason === 'object' && reason !== null) {
    try { message = JSON.stringify(reason) }
    catch { message = 'Unknown error object' }
  } else message = String(reason)
  return message.replace(/(Authorization:\s*Bearer\s+|authorization:\s*bearer\s+)\S+/gu, '$1[redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|sk_live_[A-Za-z0-9_]+)\b/gu, '[redacted]')
    .replace(/("(?:access[_-]?token|api[_-]?key|authorization|password)"\s*:\s*")[^"]*/giu, '$1[redacted]')
}

/** Render the dual-source community skill browser, preview, and confirmed installer.
 * @param props Remote operations, shared visibility store, and locale translator.
 * @returns The catalog modal while open.
 */
export function SkillCatalogPanel({ api, useStore, actions, t }: Props): ReactNode {
  const { open, installRevision } = useStore(state => state)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<SkillCatalogSourceFilter>('all')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<SkillCatalogSort>('popular')
  const [pageNumber, setPageNumber] = useState(1)
  const [page, setPage] = useState<SkillCatalogPage>()
  const [resolvedKey, setResolvedKey] = useState('')
  const [taxonomy, setTaxonomy] = useState<SkillCatalogTaxonomy>()
  const [taxonomyBusy, setTaxonomyBusy] = useState(false)
  const [taxonomyRefresh, setTaxonomyRefresh] = useState(0)
  const consumedRefresh = useRef(0)
  const [installedIds, setInstalledIds] = useState<ReadonlySet<string>>(new Set())
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorDetails, setErrorDetails] = useState('')
  const [selected, setSelected] = useState<{ id: string; name: string }>()
  const [detail, setDetail] = useState<SkillCatalogDetail>()
  const [installing, setInstalling] = useState(false)
  const [notice, setNotice] = useState('')
  const installController = useRef<AbortController | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)

  const selectedDetail = selected !== undefined && detail?.skill.id === selected.id ? detail : undefined
  const requestKey = JSON.stringify([query, sourceFilter, category, sort, pageNumber])
  const currentPage = resolvedKey === requestKey
  const fetchedCatalog = useRef<{ readonly api: CatalogRemote; readonly key: string; readonly retry: number } | undefined>(undefined)

  useEffect(() => () => { installController.current?.abort(new Error('Skill catalog panel was unmounted.')) }, [])

  const loadInstalled = useCallback(async () => {
    if (typeof api.listInstalledSkills !== 'function') return
    try {
      const result = await api.listInstalledSkills()
      if (result.ok) setInstalledIds(new Set(result.value.map(item => item.id)))
    } catch {
      // Non-critical inventory check; install remains available.
    }
  }, [api])

  useEffect(() => {
    if (!open) return
    void loadInstalled()
  }, [installRevision, loadInstalled, open])

  useEffect(() => {
    if (!open) {
      setTaxonomyBusy(false)
      return
    }
    const controller = new AbortController()
    const forceRefresh = taxonomyRefresh > consumedRefresh.current
    if (forceRefresh) consumedRefresh.current = taxonomyRefresh
    setTaxonomyBusy(true)
    void api.taxonomy(forceRefresh, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) setTaxonomy(result.value)
    }).catch(() => undefined).finally(() => {
      if (!controller.signal.aborted) setTaxonomyBusy(false)
    })
    return () => { controller.abort() }
  }, [api, open, taxonomyRefresh])

  useEffect(() => {
    if (!open || selected !== undefined) {
      setBusy(false)
      return
    }
    if (
      resolvedKey === requestKey
      && fetchedCatalog.current?.api === api
      && fetchedCatalog.current.key === requestKey
      && fetchedCatalog.current.retry === retry
    ) {
      setBusy(false)
      return
    }
    fetchedCatalog.current = { api, key: requestKey, retry }
    const controller = new AbortController()
    setBusy(true)
    setError('')
    setErrorDetails('')
    void api.catalog(query.trim(), sourceFilter, category, sort, pageNumber, PAGE_SIZE, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.ok) throw result.error
        setPage(result.value)
        setResolvedKey(requestKey)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(errorMessage(reason, t))
          setErrorDetails(diagnosticMessage(reason))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => { controller.abort() }
  }, [api, category, open, pageNumber, query, requestKey, resolvedKey, retry, selected, sort, sourceFilter, t])

  useEffect(() => {
    if (!open || selected === undefined) return
    const controller = new AbortController()
    setDetail(undefined)
    setError('')
    setErrorDetails('')
    void api.detail(selected.id, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) throw result.error
      setDetail(result.value)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setError(errorMessage(reason, t))
        setErrorDetails(diagnosticMessage(reason))
      }
    })
    return () => { controller.abort() }
  }, [api, open, retry, selected, t])

  const close = (): void => { setSelected(undefined); setDetail(undefined); actions.close() }

  const submitQuery = (nextText: string): void => {
    const trimmed = nextText.trim()
    setDraft(trimmed)
    setPageNumber(1)
    setQuery(trimmed)
    if (trimmed === query && (resolvedKey !== requestKey || error !== '')) {
      setRetry(value => value + 1)
    }
  }

  const editDraft = (value: string): void => {
    setDraft(value)
    if (value.trim() !== '') return
    if (query !== '') {
      setQuery('')
      setPageNumber(1)
      setError('')
      setErrorDetails('')
      setNotice('')
    }
  }

  const selectSource = (nextSource: SkillCatalogSourceFilter): void => {
    if (nextSource === sourceFilter) return
    setSourceFilter(nextSource)
    if (nextSource === 'skills-sh') setCategory('all')
    setPageNumber(1)
  }

  const selectCategory = (nextCategory: string): void => {
    if (sourceFilter === 'skills-sh' && nextCategory !== 'all') setSourceFilter('all')
    setCategory(nextCategory)
    setPageNumber(1)
  }

  const confirmInstall = async (): Promise<void> => {
    if (selectedDetail === undefined || installing) return
    const controller = new AbortController()
    installController.current = controller
    setInstalling(true)
    setError('')
    setErrorDetails('')
    setNotice('')
    try {
      const result = await api.installSkill(selectedDetail.skill.id, selectedDetail.commitSha, true, controller.signal)
      if (!result.ok) throw result.error
      setNotice(result.value.backupCleanupPending === undefined ? t('installed') : t('backupPending', { path: result.value.backupCleanupPending }))
      setSelected(undefined)
      setDetail(undefined)
      actions.notifyInstalled()
      await loadInstalled()
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(errorMessage(reason, t))
        setErrorDetails(diagnosticMessage(reason))
      }
    } finally {
      installController.current = undefined
      setInstalling(false)
      setConfirming(false)
    }
  }

  const visibleCategories = taxonomy?.categories.slice(0, 20) ?? []
  const totalPages = page !== undefined ? Math.max(1, Math.ceil(page.total / Math.max(1, page.pageSize))) : 0

  return <>
    <Modal open={open} onClose={installing ? () => undefined : close} title={t('title')} headless className={css.dialog ?? ''}>
      <div className={css.panel}>
        <header className={css.header}>
          <div><h2 className={css.title}>{t('title')}</h2><p className={css.description}>{t('description')}</p></div>
          <button type="button" className={css.iconButton} aria-label={t('close')} onClick={close} disabled={installing}><IconCloseOutlineRegular size={16} /></button>
        </header>

        {selected === undefined ? <>
          <form className={css.search} onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); submitQuery(draft) }}>
            <Input
              type="search"
              value={draft}
              aria-label={t('searchPlaceholder')}
              placeholder={t('searchPlaceholder')}
              icon={<IconSearchOutlineRegular size={16} />}
              onChange={(event) => { editDraft(event.currentTarget.value) }}
            />
            <Button variant="primary" type="submit" disabled={busy && !currentPage}>{t('search')}</Button>
          </form>

          <div className={css.toolbar}>
            <div role="group" aria-label={t('sourceLabel')} className={css.segmentedGroup}>
              {SOURCE_FILTERS.map(({ value, key }) => <button
                key={value}
                type="button"
                aria-pressed={sourceFilter === value}
                className={sourceFilter === value ? css.segmentActive : css.segment}
                onClick={() => { selectSource(value) }}
              >{t(key)}</button>)}
            </div>
            <div role="group" aria-label={t('sort')} className={css.segmentedGroup}>
              {SORTS.map(({ value, key }) => <button
                key={value}
                type="button"
                aria-pressed={sort === value}
                className={sort === value ? css.segmentActive : css.segment}
                onClick={() => { setSort(value); setPageNumber(1) }}
              >{t(key)}</button>)}
            </div>
          </div>

          {sourceFilter !== 'skills-sh' && visibleCategories.length > 0 ? (
            <section aria-label={t('categories')} className={css.categories}>
              <button
                type="button"
                className={category === 'all' ? css.categoryActive : css.category}
                onClick={() => { selectCategory('all') }}
              >
                <span>{t('allCategories')}</span>
                <span>{taxonomy?.totalIndexed.toLocaleString()}</span>
              </button>
              {visibleCategories.map(row => <button
                key={row.id}
                type="button"
                className={category === row.id ? css.categoryActive : css.category}
                onClick={() => { selectCategory(row.id) }}
              >
                <span className={css.categoryName}>{categoryLabel(row.id, t)}</span>
                <span>{row.count.toLocaleString()}</span>
              </button>)}
            </section>
          ) : (
            <section aria-label={t('quickTopics')} className={css.categories}>
              {QUICK_TOPICS.map(topic => <button
                key={topic.key}
                type="button"
                className={query.toLowerCase() === topic.query ? css.categoryActive : css.category}
                onClick={() => { submitQuery(topic.query) }}
              >
                <span>{t(topic.key)}</span>
              </button>)}
            </section>
          )}

          <div className={css.listHead}>
            <strong>{(currentPage ? page?.total ?? 0 : 0).toLocaleString()} {t('results')}</strong>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || taxonomyBusy}
              onClick={() => {
                setTaxonomyRefresh(value => value + 1)
                setRetry(value => value + 1)
              }}
            >
              <IconRefreshOutlineRegular size={14} />
              <span>{t('refreshIndex')}</span>
            </Button>
          </div>

          {notice !== '' ? <p className={css.notice} role="status">{notice}</p> : null}
          {currentPage && page?.warnings !== undefined && page.warnings.length > 0 ? (
            <div className={css.warning} role="status">
              <span>{page.warnings.map(item => warningText(item, t)).join(' ')}</span>
            </div>
          ) : null}
          {error !== '' ? (
            <div className={css.error} role="alert">
              <span>{error}</span>
              {errorDetails !== '' ? <details className={css.errorDetails}><summary>{t('technicalDetails')}</summary><pre>{errorDetails}</pre></details> : null}
              <Button variant="outline" size="sm" onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</Button>
            </div>
          ) : null}

          <div className={css.list} aria-busy={busy && !currentPage}>
            {busy && !currentPage ? <p className={css.status} role="status">{t('loading')}</p> : null}
            {currentPage ? page?.items.map((skill, index) => {
              const isInstalled = installedIds.has(skill.installDir)
              const summary = skill.description !== '' ? skill.description : t('skillsShRepoHint', { repo: skill.repo })
              return (
                <article key={`${skill.id}:${index}`} className={css.row}>
                  <div className={css.skill}>
                    <div className={css.nameLine}>
                      <button type="button" className={css.skillName} onClick={() => { setSelected({ id: skill.id, name: skill.name }); setNotice('') }}>
                        {skill.name}
                      </button>
                      <span className={skill.sources.length > 1 ? `${css.badge} ${css.badgeDual}` : css.badge}>
                        {sourceBadgeText(skill, t)}
                      </span>
                      {skill.category !== undefined && skill.category !== '' ? (
                        <span className={`${css.badge} ${css.categoryName}`}>{categoryLabel(skill.category, t)}</span>
                      ) : null}
                      {isInstalled ? <span className={`${css.badge} ${css.badgeInstalled}`}>{t('installedTag')}</span> : null}
                    </div>
                    <span className={css.slug}>{skill.repo} · {skill.author}</span>
                    <p className={css.summary}>{summary}</p>
                  </div>
                  <span className={css.metric}>
                    {skill.installs !== undefined ? (
                      <><IconDownloadOutlineRegular size={14} />{t('installsCount', { count: skill.installs.toLocaleString() })}</>
                    ) : skill.risk !== undefined && skill.risk !== 'safe' && skill.risk !== 'none' ? (
                      <span className={css.badge}>{t('riskTag', { risk: skill.risk })}</span>
                    ) : null}
                  </span>
                  <span className={css.date}>
                    {skill.updatedAt !== undefined ? (
                      <><IconClockOutlineRegular size={14} />{t('addedDate', { date: new Date(skill.updatedAt * 1000).toLocaleDateString(t('dateLocale')) })}</>
                    ) : null}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => { setSelected({ id: skill.id, name: skill.name }); setNotice('') }}>
                    {t('detail')}
                  </Button>
                </article>
              )
            }) : null}
            {currentPage && page?.items.length === 0 && !busy ? <p className={css.status}>{t('empty')}</p> : null}
          </div>

          {currentPage && page !== undefined ? (
            <footer className={css.pagination}>
              <span>{t('page', { page: String(pageNumber), total: String(totalPages) })} · {page.totalIsExact ? t('exactTotal', { total: page.total.toLocaleString() }) : t('pageResults', { count: String(page.items.length) })}</span>
              <div>
                <Button variant="outline" size="sm" disabled={busy || pageNumber <= 1} onClick={() => { setPageNumber(value => value - 1) }}>{t('previous')}</Button>
                <Button variant="outline" size="sm" disabled={busy || !page.hasNext} onClick={() => { setPageNumber(value => value + 1) }}>{t('next')}</Button>
              </div>
            </footer>
          ) : null}
        </> : <>
          <div className={css.detailHeader}>
            <Button variant="outline" size="sm" disabled={installing} onClick={() => { setSelected(undefined); setDetail(undefined); setError('') }}>{t('back')}</Button>
          </div>
          {error !== '' ? (
            <div className={css.error} role="alert">
              <span>{error}</span>
              {errorDetails !== '' ? <details className={css.errorDetails}><summary>{t('technicalDetails')}</summary><pre>{errorDetails}</pre></details> : null}
              <Button variant="outline" size="sm" onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</Button>
            </div>
          ) : null}
          {selectedDetail === undefined ? (error === '' ? <p className={css.status} role="status">{t('loading')}</p> : null) : (
            <section className={css.detail}>
              <div className={css.detailTitleRow}>
                <h3>{selectedDetail.skill.name}</h3>
                <span className={selectedDetail.skill.sources.length > 1 ? `${css.badge} ${css.badgeDual}` : css.badge}>
                  {sourceBadgeText(selectedDetail.skill, t)}
                </span>
                {installedIds.has(selectedDetail.skill.installDir) ? (
                  <span className={`${css.badge} ${css.badgeInstalled}`}>{t('installedTag')}</span>
                ) : null}
              </div>
              <p>{selectedDetail.skill.description}</p>
              {selectedDetail.skippedFiles !== undefined && selectedDetail.skippedFiles > 0 ? (
                <div className={css.warning} role="status">
                  <span>{t('manifestWarning', {
                    count: selectedDetail.skippedFiles.toLocaleString(),
                    limit: selectedDetail.limitReason !== undefined ? t(selectedDetail.limitReason === 'file_count' ? 'manifestFileCountLimit' : selectedDetail.limitReason === 'file_size' ? 'manifestFileSizeLimit' : 'manifestTotalSizeLimit') : '',
                  })}</span>
                </div>
              ) : null}
              <dl>
                <dt>{t('author')}</dt><dd>{selectedDetail.skill.repo} ({selectedDetail.skill.author})</dd>
                {selectedDetail.skill.category !== undefined ? (
                  <><dt>{t('category')}</dt><dd className={css.categoryName}>{categoryLabel(selectedDetail.skill.category, t)}</dd></>
                ) : null}
                {selectedDetail.skill.installs !== undefined ? (
                  <><dt>{t('installs')}</dt><dd>{t('installsCount', { count: selectedDetail.skill.installs.toLocaleString() })}</dd></>
                ) : null}
                <dt>{t('installDir')}</dt><dd><code>{selectedDetail.skill.installDir}</code></dd>
                <dt>{t('source')}</dt>
                <dd>
                  <a href={selectedDetail.skill.githubUrl} target="_blank" rel="noopener noreferrer">{t('openGitHub')}</a>
                  {selectedDetail.skill.url.startsWith('https://skills.sh/') ? (
                    <> · <a href={selectedDetail.skill.url} target="_blank" rel="noopener noreferrer">{t('openSkillsSh')}</a></>
                  ) : null}
                </dd>
                <dt>{t('commit')}</dt><dd><code>{selectedDetail.commitSha}</code></dd>
                <dt>{t('size')}</dt><dd>{t('bytes', { count: selectedDetail.totalBytes.toLocaleString() })}</dd>
              </dl>
              <h4>{t('files')}</h4>
              <ul className={css.files}>{selectedDetail.files.map(file => <li key={file.path}><code>{file.path}</code><span>{t('bytes', { count: file.size.toLocaleString() })}</span></li>)}</ul>
              <h4>{t('skillMarkdown')}</h4>
              <pre className={css.markdownPreview}>{selectedDetail.skillMarkdown}</pre>
              {installing && !confirming ? <div className={css.installing}><span role="status">{t('installing')}</span></div> : null}
              <Button variant="primary" disabled={installing} onClick={() => { setConfirming(true) }}>
                {installedIds.has(selectedDetail.skill.installDir) ? t('reinstall') : t('install')}
              </Button>
            </section>
          )}
        </>}
      </div>
    </Modal>

    {selectedDetail !== undefined ? (
      <Modal
        open={confirming}
        onClose={() => { if (!installing) setConfirming(false) }}
        title={t('reviewTitle')}
        closeLabel={t('closeReview')}
        className={css.confirmDialog ?? ''}
        description={t('reviewBody')}
        footer={<>
          <Button
            variant="outline"
            className={css.cancelButton}
            onClick={() => {
              if (installing) installController.current?.abort(new Error('Skill installation cancelled.'))
              else setConfirming(false)
            }}
          >{t('cancel')}</Button>
          <Button variant="primary" disabled={installing} onClick={() => { void confirmInstall() }}>{t('confirmInstall')}</Button>
        </>}
      >
        <p>{t('confirmBody', {
          name: selectedDetail.skill.name,
          folder: selectedDetail.skill.installDir,
          commit: selectedDetail.commitSha,
          files: selectedDetail.files.length,
          target: t('installTarget'),
        })}</p>
        {installing ? <div className={css.installing}><span role="status">{t('installing')}</span></div> : null}
        {error !== '' ? <div className={css.error} role="alert"><span>{error}</span>{errorDetails !== '' ? <details className={css.errorDetails}><summary>{t('technicalDetails')}</summary><pre>{errorDetails}</pre></details> : null}</div> : null}
      </Modal>
    ) : null}
  </>
}
