/** Search SkillsMP and review a pinned Git commit before installation. */
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, IconSearchOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SkillsMpDetail,
  SkillsMpInstallResult,
  SkillsMpLocale,
  SkillsMpPage,
  SkillsMpSort,
  SkillsMpTaxonomy,
} from '@deepseek-ai/dsh-community-skill-catalog/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSkillCatalogStore } from './store.ts'
import type { SkillCatalogKey } from './locales.ts'
import { CategoryCascader } from './CategoryCascader.tsx'
import type { CategoryOption } from './CategoryCascader.tsx'
import { OccupationCascader } from './OccupationCascader.tsx'
import css from './SkillCatalogPage.module.css'

type CatalogRemote = {
  taxonomy(locale: SkillsMpLocale, forceRefresh?: boolean, signal?: AbortSignal): Promise<RemoteResult<SkillsMpTaxonomy>>
  catalog(
    query: string,
    category?: string,
    occupation?: string,
    language?: string,
    sort?: SkillsMpSort,
    page?: number,
    pageSize?: number,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SkillsMpPage>>
  detail(githubUrl: string, signal?: AbortSignal): Promise<RemoteResult<SkillsMpDetail>>
  installSkill(githubUrl: string, commitSha: string, confirmed: boolean, signal?: AbortSignal): Promise<RemoteResult<SkillsMpInstallResult>>
}

export interface SkillCatalogPanelInjected { readonly api: CatalogRemote }
type Store = PropsStore<ReturnType<typeof createSkillCatalogStore>>
type Props = PropsRuntime<'shell.overlay'> & Store & PropsLocale<'skillCatalog'> & InjectFace<SkillCatalogPanelInjected>
const PAGE_SIZE = 24
const SORTS: readonly SkillsMpSort[] = ['stars', 'recent']
const USE_CASES = [
  ['programming', 'typescript code review'], ['documents', 'meeting notes document'], ['data', 'csv data analysis'],
  ['design', 'design system'], ['marketing', 'marketing campaign'], ['operations', 'incident response'],
] as const
const LANGUAGES = ['en', 'zh', 'ja', 'mul', 'und'] as const

function errorMessage(reason: unknown, translate: Props['t']): string {
  const message = reason instanceof Error ? reason.message : ''
  if (typeof reason === 'object' && reason !== null && 'code' in reason && typeof reason.code === 'string') {
    if (reason.code === 'skillsmp/forbidden') return translate('skillsMpForbidden')
    if (reason.code === 'skillsmp/rate-limited') return translate('skillsMpRateLimited')
    if (reason.code === 'skillsmp/search-required') return translate('skillsMpSearchRequired')
    if (reason.code === 'skillsmp/review-required') return translate('skillsMpReviewRequired')
    if (reason.code === 'skillsmp/source-unavailable') return translate('skillsMpSourceUnavailable')
    if (reason.code === 'skillsmp/manifest-incomplete') {
      const details = 'details' in reason && typeof reason.details === 'object' && reason.details !== null ? reason.details : undefined
      const skippedFiles = details !== undefined && 'skippedFiles' in details && typeof details.skippedFiles === 'number'
        ? details.skippedFiles
        : undefined
      const limitReason = details !== undefined && 'limitReason' in details ? details.limitReason : undefined
      const reasonKey = limitReason === 'file_count' ? 'manifestFileCountLimit'
        : limitReason === 'file_size' ? 'manifestFileSizeLimit'
          : limitReason === 'total_size' ? 'manifestTotalSizeLimit' : undefined
      if (skippedFiles !== undefined && skippedFiles > 0 && reasonKey !== undefined) {
        return translate('manifestIncomplete', { count: skippedFiles.toLocaleString(), limit: translate(reasonKey) })
      }
      return translate('manifestIncompleteGeneric')
    }
    if (reason.code === 'skillsmp/github-source-invalid') return translate('githubSourceInvalid')
    if (reason.code === 'skillsmp/skill-markdown-missing') return translate('skillMarkdownMissing')
    if (reason.code === 'skillsmp/file-integrity-failed') return translate('fileIntegrityFailed')
    if (reason.code === 'skillsmp/skill-incompatible') return translate('skillIncompatible')
  }
  if (message.includes('did not resolve exclusively to public addresses')) return translate('networkDenied')
  return translate('failure')
}

function diagnosticMessage(reason: unknown): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && reason.code === 'skillsmp/skill-incompatible') return ''
  let message: string
  if (reason instanceof Error) message = reason.message
  else if (typeof reason === 'object' && reason !== null) {
    try { message = JSON.stringify(reason) }
    catch { message = 'Unknown error object' }
  } else message = String(reason)
  return message.replace(/(Authorization:\s*Bearer\s+|authorization:\s*bearer\s+)\S+/gu, '$1[redacted]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk_live_[A-Za-z0-9_]+)\b/gu, '[redacted]')
    .replace(/("(?:access[_-]?token|api[_-]?key|authorization|password)"\s*:\s*")[^"]*/giu, '$1[redacted]')
}

/** Render the filtered directory and user-confirmed installer.
 * @param props Remote operations, locale, and sidebar-owned visibility state.
 * @returns the SkillsMP modal while it is open.
 */
export function SkillCatalogPanel({ api, useStore, actions, t }: Props): ReactNode {
  const { open } = useStore(state => state)
  const locale: SkillsMpLocale = t('locale') === 'zh' ? 'zh' : 'en'
  const advancedFiltersId = useId().replaceAll(':', '')
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [categoryDraft, setCategoryDraft] = useState('')
  const [category, setCategory] = useState('')
  const [occupationDraft, setOccupationDraft] = useState('')
  const [occupation, setOccupation] = useState('')
  const [languageDraft, setLanguageDraft] = useState('')
  const [language, setLanguage] = useState('')
  const [sortDraft, setSortDraft] = useState<SkillsMpSort>('stars')
  const [sort, setSort] = useState<SkillsMpSort>('stars')
  const [taxonomyByLocale, setTaxonomyByLocale] = useState<Partial<Record<SkillsMpLocale, SkillsMpTaxonomy>>>({})
  const [taxonomyBusy, setTaxonomyBusy] = useState(false)
  const [taxonomyError, setTaxonomyError] = useState('')
  const [taxonomyForceRefresh, setTaxonomyForceRefresh] = useState(0)
  const consumedTaxonomyRefresh = useRef(0)
  const [advanced, setAdvanced] = useState(false)
  const [pageNumber, setPageNumber] = useState(1)
  const [page, setPage] = useState<SkillsMpPage>()
  const [resolvedKey, setResolvedKey] = useState('')
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [errorDetails, setErrorDetails] = useState('')
  const [selected, setSelected] = useState<{ githubUrl: string; name: string }>()
  const [detail, setDetail] = useState<SkillsMpDetail>()
  const [installing, setInstalling] = useState(false)
  const [notice, setNotice] = useState('')
  const installController = useRef<AbortController | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)
  const selectedDetail = selected !== undefined && detail?.skill.githubUrl === selected.githubUrl ? detail : undefined
  const taxonomy = taxonomyByLocale[locale]
  const categoryOptions = useMemo<readonly CategoryOption[]>(() => taxonomy?.categories.map(category => ({
    slug: category.slug,
    name: category.name,
    ...(category.group === undefined ? {} : { group: category.group }),
  })) ?? [], [taxonomy])
  useEffect(() => () => { installController.current?.abort(new Error('SkillsMP catalog panel was unmounted.')) }, [])

  useEffect(() => {
    if (!open) {
      setTaxonomyBusy(false)
      return
    }
    const controller = new AbortController()
    const forceRefresh = taxonomyForceRefresh > consumedTaxonomyRefresh.current
    if (forceRefresh) consumedTaxonomyRefresh.current = taxonomyForceRefresh
    setTaxonomyBusy(true)
    setTaxonomyError('')
    void api.taxonomy(locale, forceRefresh, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) throw result.error
      setTaxonomyByLocale(current => ({ ...current, [locale]: result.value }))
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setTaxonomyError(errorMessage(reason, t))
    }).finally(() => { if (!controller.signal.aborted) setTaxonomyBusy(false) })
    return () => { controller.abort() }
  }, [api, locale, open, taxonomyForceRefresh, t])

  const requestKey = JSON.stringify([query, category, occupation, language, sort, pageNumber])
  const currentPage = resolvedKey === requestKey
  useEffect(() => {
    if (!open || query.trim() === '' || selected !== undefined) {
      setBusy(false)
      return
    }
    const controller = new AbortController()
    setBusy(true)
    setError('')
    setErrorDetails('')
    void api.catalog(
      query.trim(), category || undefined, occupation || undefined, language || undefined,
      sort, pageNumber, PAGE_SIZE, controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) throw result.error
      setPage(result.value)
      setResolvedKey(requestKey)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) { setError(errorMessage(reason, t)); setErrorDetails(diagnosticMessage(reason)) }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => { controller.abort() }
  }, [api, category, language, occupation, open, pageNumber, query, requestKey, retry, selected, sort])

  useEffect(() => {
    if (!open || selected === undefined) return
    const controller = new AbortController()
    setDetail(undefined)
    setError('')
    setErrorDetails('')
    void api.detail(selected.githubUrl, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (!result.ok) throw result.error
      setDetail(result.value)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) { setError(errorMessage(reason, t)); setErrorDetails(diagnosticMessage(reason)) }
    })
    return () => { controller.abort() }
  }, [api, open, retry, selected])

  const close = (): void => { setSelected(undefined); setDetail(undefined); actions.close() }
  const submit = (value: string): void => {
    const trimmed = value.trim()
    setDraft(trimmed)
    setCategory(categoryDraft.trim())
    setOccupation(occupationDraft.trim())
    setLanguage(languageDraft.trim())
    setSort(sortDraft)
    setPageNumber(1)
    setQuery(trimmed)
  }
  const search = (event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); submit(draft) }
  /**
   * Record an edited query box. Emptying it returns the catalog to its initial
   * browse state: the committed query, the results it produced, and its
   * notices go, and the catalog effect's cleanup aborts a search still in flight
   * so a late response cannot bring them back. A non-empty edit only changes the
   * box — the search runs when the user submits it.
   * @param value - the edited query box value.
   */
  const editDraft = (value: string): void => {
    setDraft(value)
    if (value.trim() !== '') return
    setQuery('')
    setPage(undefined)
    setResolvedKey('')
    setPageNumber(1)
    setError('')
    setErrorDetails('')
    setNotice('')
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
      const result = await api.installSkill(selectedDetail.skill.githubUrl, selectedDetail.commitSha, true, controller.signal)
      if (!result.ok) throw result.error
      setNotice(result.value.backupCleanupPending === undefined ? t('installed') : t('backupPending', { path: result.value.backupCleanupPending }))
      setSelected(undefined)
      setDetail(undefined)
    } catch (reason) { if (!controller.signal.aborted) { setError(errorMessage(reason, t)); setErrorDetails(diagnosticMessage(reason)) } }
    finally { installController.current = undefined; setInstalling(false); setConfirming(false) }
  }

  return <>
    <Modal open={open} onClose={installing ? () => undefined : close} title={t('title')} headless className={css.dialog ?? ''}>
      <div className={css.panel}>
        <header className={css.header}><div><h2 className={css.title}>{t('title')}</h2><p className={css.description}>{t('description')}</p></div>
          <button type="button" className={css.iconButton} aria-label={t('close')} onClick={close} disabled={installing}><IconCloseOutlineRegular size={16} /></button></header>
        {selected === undefined ? <>
          <form className={css.search} onSubmit={search}>
            <Input type="search" value={draft} aria-label={t('searchPlaceholder')} placeholder={t('searchPlaceholder')} icon={<IconSearchOutlineRegular size={16} />} onChange={(event) => { editDraft(event.currentTarget.value) }} />
            <Button variant="primary" type="submit" disabled={draft.trim() === ''}>{t('search')}</Button>
          </form>
          {query === '' ? <section className={css.scenarios} aria-label={t('useCasesTitle')}>
            <p className={css.scenarioHeading}>{t('useCasesTitle')}</p>
            <div className={css.scenarioButtons}>{USE_CASES.map(([key, value]) => <Button key={key} variant="primary" size="sm" onClick={() => { submit(value) }}>{t(key satisfies SkillCatalogKey)}</Button>)}</div>
          </section> : null}
          <div className={css.advanced}>
            <button
              type="button"
              className={css.advancedToggle}
              aria-expanded={advanced}
              aria-controls={advancedFiltersId}
              onClick={() => { setAdvanced(value => !value) }}
            >{t('advancedFilters')}</button>
            {advanced ? <section id={advancedFiltersId} className={css.advancedContent} aria-label={t('advancedFilters')}>
              <div className={css.filters}>
                <div className={css.filterField} role="group" aria-label={t('category')}>
                  <span className={css.filterLabel}>{t('category')}</span>
                  {taxonomy === undefined
                    ? <button type="button" className={css.occupationTrigger} disabled={taxonomyBusy} onClick={() => { setTaxonomyForceRefresh(value => value + 1) }}>{taxonomyBusy ? t('taxonomyLoading') : t('retry')}</button>
                    : <CategoryCascader
                      label={t('category')}
                      value={categoryDraft}
                      options={categoryOptions}
                      allLabel={t('allCategories')}
                      otherGroupLabel={t('otherCategories')}
                      searchLabel={t('searchCategories')}
                      noResultsLabel={t('noFilterOptions')}
                      domainsLabel={t('categoryDomains')}
                      categoriesLabel={t('categoryOptions')}
                      backLabel={t('backToDomains')}
                      onChange={setCategoryDraft}
                    />}
                </div>
                <div className={css.filterField} role="group" aria-label={t('occupation')}>
                  <span className={css.filterLabel}>{t('occupation')}</span>
                  {taxonomy === undefined
                    ? <button type="button" className={css.occupationTrigger} disabled={taxonomyBusy} onClick={() => { setTaxonomyForceRefresh(value => value + 1) }}>{taxonomyBusy ? t('taxonomyLoading') : t('retry')}</button>
                    : <OccupationCascader
                      label={t('occupation')}
                      value={occupationDraft}
                      taxonomy={taxonomy}
                      allLabel={t('allOccupations')}
                      pickerTitle={t('occupationPickerTitle')}
                      pickerDescription={t('occupationPickerDescription')}
                      searchLabel={t('searchOccupations')}
                      noResultsLabel={t('noFilterOptions')}
                      majorGroupsLabel={t('occupationMajorGroups')}
                      selectGroupLabel={name => t('selectOccupationGroup', { name })}
                      collapseGroupLabel={name => t('collapseOccupationGroup', { name })}
                      expandGroupLabel={name => t('expandOccupationGroup', { name })}
                      clearSelectionLabel={t('allOccupations')}
                      closeLabel={t('close')}
                      onChange={setOccupationDraft}
                    />}
                </div>
                <label>{t('language')}<select value={languageDraft} onChange={(event) => { setLanguageDraft(event.currentTarget.value) }}>
                  <option value="">{t('anyLanguage')}</option>
                  {LANGUAGES.map(value => <option key={value} value={value}>{t(`language_${value}` satisfies SkillCatalogKey)}</option>)}
                </select></label>
                <label>{t('sort')}<select value={sortDraft} onChange={(event) => {
                  const selectedSort = SORTS.find(value => value === event.currentTarget.value)
                  if (selectedSort !== undefined) setSortDraft(selectedSort)
                }}>
                  {SORTS.map(value => <option key={value} value={value}>{t(value satisfies SkillCatalogKey)}</option>)}
                </select></label>
                <Button variant="primary" size="sm" disabled={taxonomy === undefined || taxonomyBusy} onClick={() => { submit(query) }}>{t('applyFilters')}</Button>
              </div>
              {taxonomyBusy ? <p className={css.status} role="status">{t('taxonomyLoading')}</p> : null}
              <div className={css.taxonomyActions}>
                <Button variant="outline" size="sm" disabled={taxonomyBusy} onClick={() => { setTaxonomyForceRefresh(value => value + 1) }}>{t('refreshTaxonomy')}</Button>
              </div>
              {taxonomyError !== '' ? <div className={css.error} role="alert"><span>{taxonomyError}</span><Button variant="outline" size="sm" disabled={taxonomyBusy} onClick={() => { setTaxonomyForceRefresh(value => value + 1) }}>{t('retry')}</Button></div> : null}
            </section> : null}
          </div>
          {notice !== '' ? <p className={css.notice} role="status">{notice}</p> : null}
          {error !== '' ? <div className={css.error} role="alert"><span>{error}</span>{errorDetails !== '' ? <details className={css.errorDetails}><summary>{t('technicalDetails')}</summary><pre>{errorDetails}</pre></details> : null}<Button variant="outline" size="sm" onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</Button></div> : null}
          <div className={css.results} aria-busy={busy}>
            {query === '' ? <p className={css.status}>{t('searchPrompt')}</p> : null}
            {busy && !currentPage ? <p className={css.status} role="status">{t('loading')}</p> : null}
            {currentPage ? page?.items.map((skill, index) => <article key={`${skill.id}:${index}`} className={css.row}>
              <div className={css.skill}>
                <button type="button" className={css.skillName} onClick={() => { setSelected({ githubUrl: skill.githubUrl, name: skill.name }); setNotice('') }}>{skill.name}</button>
                <span className={css.slug}>{skill.author} · {skill.contentLanguage}</span>
                <p className={css.summary}>{skill.description}</p>
              </div>
              <span className={css.metric} title={t('starsMeaning')}>★ {skill.stars.toLocaleString()}</span>
              <span className={css.date}>{t('updatedAt', { date: new Date(skill.updatedAt * 1000).toLocaleDateString(t('dateLocale')) })}</span>
              <Button variant="outline" size="sm" onClick={() => { setSelected({ githubUrl: skill.githubUrl, name: skill.name }); setNotice('') }}>{t('detail')}</Button>
            </article>) : null}
            {currentPage && page?.items.length === 0 && !busy ? <p className={css.status}>{t('empty')}</p> : null}
          </div>
          {currentPage && page !== undefined ? <footer className={css.pagination}>
            <span>{t('page', { page: String(pageNumber) })} · {page.totalIsExact ? t('exactTotal', { total: page.total.toLocaleString() }) : t('pageResults', { count: String(page.items.length) })}</span>
            <div><Button variant="outline" size="sm" disabled={busy || pageNumber <= 1} onClick={() => { setPageNumber(value => value - 1) }}>{t('previous')}</Button>
              <Button variant="outline" size="sm" disabled={busy || !page.hasNext} onClick={() => { setPageNumber(value => value + 1) }}>{t('next')}</Button></div>
          </footer> : null}
        </> : <>
          <div className={css.detailHeader}><Button variant="outline" size="sm" disabled={installing} onClick={() => { setSelected(undefined); setDetail(undefined); setError('') }}>{t('back')}</Button></div>
          {error !== '' ? <div className={css.error} role="alert"><span>{error}</span>{errorDetails !== '' ? <details className={css.errorDetails}><summary>{t('technicalDetails')}</summary><pre>{errorDetails}</pre></details> : null}<Button variant="outline" size="sm" onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</Button></div> : null}
          {selectedDetail === undefined ? error === '' ? <p className={css.status} role="status">{t('loading')}</p> : null : <section className={css.detail}>
            <h3>{selectedDetail.skill.name}</h3><p>{selectedDetail.skill.description}</p>
            <dl><dt>{t('author')}</dt><dd>{selectedDetail.skill.author}</dd><dt>{t('contentLanguage')}</dt><dd>{selectedDetail.skill.contentLanguage}</dd><dt>{t('source')}</dt><dd><a href={selectedDetail.skill.url} target="_blank" rel="noopener noreferrer">{t('openSkillsMp')}</a> · <a href={selectedDetail.skill.githubUrl} target="_blank" rel="noopener noreferrer">{t('openGitHub')}</a></dd><dt>{t('commit')}</dt><dd><code>{selectedDetail.commitSha}</code></dd><dt>{t('stars')}</dt><dd>{selectedDetail.skill.stars.toLocaleString()} · {t('starsMeaning')}</dd><dt>{t('size')}</dt><dd>{t('bytes', { count: selectedDetail.totalBytes.toLocaleString() })}</dd></dl>
            <h4>{t('files')}</h4><ul className={css.files}>{selectedDetail.files.map(file => <li key={file.path}><code>{file.path}</code><span>{t('bytes', { count: file.size.toLocaleString() })}</span></li>)}</ul>
            <h4>{t('skillMarkdown')}</h4><pre className={css.markdownPreview}>{selectedDetail.skillMarkdown}</pre>
            {installing && !confirming ? <div className={css.installing}><span role="status">{t('installing')}</span></div> : null}
            <Button variant="primary" disabled={installing} onClick={() => { setConfirming(true) }}>{t('install')}</Button>
          </section>}
        </>}
      </div>
    </Modal>
    {selectedDetail !== undefined ? <Modal open={confirming} onClose={() => { if (!installing) setConfirming(false) }} title={t('reviewTitle')} closeLabel={t('closeReview')} className={css.confirmDialog ?? ''} description={t('reviewBody')} footer={<>
      <Button variant="outline" className={css.cancelButton} onClick={() => { if (installing) installController.current?.abort(new Error('Skill installation cancelled.')); else setConfirming(false) }}>{t('cancel')}</Button>
      <Button variant="primary" disabled={installing} onClick={() => { void confirmInstall() }}>{t('confirmInstall')}</Button>
    </>}>
      <p>{t('confirmBody', { name: selectedDetail.skill.name, commit: selectedDetail.commitSha, files: selectedDetail.files.length, target: t('installTarget') })}</p>
      {installing ? <div className={css.installing}><span role="status">{t('installing')}</span></div> : null}
      {error !== '' ? <div className={css.error} role="alert"><span>{error}</span>{errorDetails !== '' ? <details className={css.errorDetails}><summary>{t('technicalDetails')}</summary><pre>{errorDetails}</pre></details> : null}</div> : null}
    </Modal> : null}
  </>
}
