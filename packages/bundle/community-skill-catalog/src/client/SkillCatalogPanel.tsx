/** Search SkillHub and review an exact release before verified installation. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, IconSearchOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SkillHubApiKeyFilter, SkillHubDetail, SkillHubPage, SkillHubSort } from '@deepseek-ai/dsh-community-skill-catalog/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSkillCatalogStore } from './store.ts'
import type { SkillCatalogKey } from './locales.ts'
import css from './SkillCatalogPage.module.css'

type CatalogRemote = {
  catalog(
    query?: string,
    category?: string,
    source?: string,
    apiKey?: SkillHubApiKeyFilter,
    sort?: SkillHubSort,
    page?: number,
    pageSize?: number,
    signal?: AbortSignal,
  ): Promise<RemoteResult<SkillHubPage>>
  detail(canonicalName: string, signal?: AbortSignal): Promise<RemoteResult<SkillHubDetail>>
  installSkill(
    canonicalName: string,
    version: string,
    confirmed: boolean,
    signal?: AbortSignal,
  ): Promise<RemoteResult<{
    readonly slug: string
    readonly canonicalName: string
    readonly version: string
    readonly path: string
    readonly files: number
    readonly totalBytes: number
    readonly backupCleanupPending?: string
  }>>
}

export interface SkillCatalogPanelInjected { readonly api: CatalogRemote }
type Store = PropsStore<ReturnType<typeof createSkillCatalogStore>>
type Props = PropsRuntime<'shell.overlay'> & Store & PropsLocale<'skillCatalog'> & InjectFace<SkillCatalogPanelInjected>
const PAGE_SIZE = 24
const SORTS: readonly SkillHubSort[] = ['score', 'downloads', 'stars', 'installs', 'updated_at']

function errorMessage(reason: unknown, translate: Props['t']): string {
  if (typeof reason === 'object' && reason !== null && 'code' in reason && typeof reason.code === 'string') {
    if (reason.code === 'skillhub/identity-ambiguous') return translate('identityAmbiguous')
    if (reason.code === 'skillhub/identity-changed') return translate('identityChanged')
    if (reason.code === 'skillhub/install-limit' && 'details' in reason && typeof reason.details === 'object' && reason.details !== null) {
      const details = reason.details
      const key = 'budget' in details && details.budget === 'archive' ? 'budgetArchive'
        : 'budget' in details && details.budget === 'entries' ? 'budgetEntries'
          : 'budget' in details && details.budget === 'files' ? 'budgetFiles'
            : 'budget' in details && details.budget === 'expanded' ? 'budgetExpanded'
              : 'budget' in details && details.budget === 'metadata' ? 'budgetMetadata' : undefined
      if (key !== undefined && 'limit' in details && typeof details.limit === 'number' && Number.isSafeInteger(details.limit)) {
        return translate('installLimit', { budget: translate(key), limit: details.limit.toLocaleString() })
      }
    }
  }
  const message = reason instanceof Error ? reason.message : String(reason)
  if (message.includes('did not resolve exclusively to public addresses')) return translate('networkDenied')
  return message
}

/** Render the filtered directory and user-confirmed installer.
 * @param props Remote operations, locale, and sidebar-owned visibility state.
 * @returns the SkillHub modal while it is open.
 */
export function SkillCatalogPanel({ api, useStore, actions, t }: Props): ReactNode {
  const { open } = useStore(state => state)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [source, setSource] = useState('all')
  const [apiKey, setApiKey] = useState<SkillHubApiKeyFilter>('all')
  const [sort, setSort] = useState<SkillHubSort>('score')
  const [pageNumber, setPageNumber] = useState(1)
  const [page, setPage] = useState<SkillHubPage>()
  const [observedCategories, setObservedCategories] = useState<readonly string[]>([])
  const [observedSources, setObservedSources] = useState<readonly string[]>([])
  const [resolvedKey, setResolvedKey] = useState('')
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selectedIdentity, setSelectedIdentity] = useState<string>()
  const [detail, setDetail] = useState<SkillHubDetail>()
  const [installing, setInstalling] = useState(false)
  const [notice, setNotice] = useState('')
  const installController = useRef<AbortController | undefined>(undefined)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => () => { installController.current?.abort(new Error('Skill catalog panel was unmounted.')) }, [])

  const requestKey = JSON.stringify([query, category, source, apiKey, sort, pageNumber])
  const currentPage = resolvedKey === requestKey
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setBusy(true)
    setError('')
    void api.catalog(query, category, source, apiKey, sort, pageNumber, PAGE_SIZE, controller.signal).then((result) => {
      if (!result.ok) throw result.error
      setPage(result.value)
      setObservedCategories(current => [...new Set([
        ...current,
        ...result.value.items.map(skill => skill.category.trim()).filter(value => value !== '' && value !== 'all'),
      ])].sort((left, right) => left.localeCompare(right)))
      setObservedSources(current => [...new Set([
        ...current,
        ...result.value.items.map(skill => skill.source.trim()).filter(value => value !== '' && value !== 'all'),
      ])].sort((left, right) => left.localeCompare(right)))
      setResolvedKey(requestKey)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(reason, t))
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => { controller.abort() }
  }, [api, apiKey, category, open, pageNumber, query, requestKey, retry, sort, source])

  useEffect(() => {
    if (!open || selectedIdentity === undefined) return
    const controller = new AbortController()
    setDetail(undefined)
    setError('')
    void api.detail(selectedIdentity, controller.signal).then((result) => {
      if (!result.ok) throw result.error
      setDetail(result.value)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(reason, t))
    })
    return () => { controller.abort() }
  }, [api, open, selectedIdentity, retry])

  const close = (): void => { setSelectedIdentity(undefined); setDetail(undefined); actions.close() }
  const search = (event: FormEvent<HTMLFormElement>): void => { event.preventDefault(); setPageNumber(1); setQuery(draft.trim()) }
  const filter = (update: () => void): void => { update(); setPageNumber(1) }
  const confirmInstall = async (): Promise<void> => {
    if (detail === undefined || installing) return
    const controller = new AbortController()
    installController.current = controller
    setInstalling(true)
    setError('')
    setNotice('')
    try {
      const result = await api.installSkill(detail.skill.canonicalName ?? '', detail.skill.version, true, controller.signal)
      if (!result.ok) throw result.error
      setNotice(result.value.backupCleanupPending === undefined ? t('installed') : t('backupPending', { path: result.value.backupCleanupPending }))
      setSelectedIdentity(undefined)
      setDetail(undefined)
    } catch (reason) { if (!controller.signal.aborted) setError(errorMessage(reason, t)) }
    finally { installController.current = undefined; setInstalling(false); setConfirming(false) }
  }

  return <>
    <Modal open={open} onClose={installing ? () => undefined : close} title={t('title')} headless className={css.dialog ?? ''}>
      <div className={css.panel}>
        <header className={css.header}><div><h2 className={css.title}>{t('title')}</h2><p className={css.description}>{t('description')}</p></div>
          <button type="button" className={css.iconButton} aria-label={t('close')} onClick={close} disabled={installing}><IconCloseOutlineRegular size={16} /></button></header>
        {selectedIdentity === undefined ? <>
          <form className={css.search} onSubmit={search}>
            <Input type="search" value={draft} aria-label={t('searchPlaceholder')} placeholder={t('searchPlaceholder')} icon={<IconSearchOutlineRegular size={16} />} onChange={(event) => { setDraft(event.currentTarget.value) }} />
            <Button variant="primary" type="submit" disabled={busy}>{t('search')}</Button>
          </form>
          <div className={css.filters}>
            <label>{t('category')}<select value={category} onChange={(event) => {
              filter(() => { setCategory(event.currentTarget.value) })
            }}>
              <option value="all">{t('all')}</option>
              {observedCategories.map(value => <option key={value} value={value}>{value}</option>)}
              {category !== 'all' && !observedCategories.includes(category) ? <option value={category}>{category}</option> : null}
            </select></label>
            <label>{t('source')}<select value={source} onChange={(event) => {
              filter(() => { setSource(event.currentTarget.value) })
            }}>
              <option value="all">{t('all')}</option>
              <option value="official">{t('official')}</option>
              <option value="community">{t('community')}</option>
              {observedSources.filter(value => value !== 'official' && value !== 'community').map(value => <option key={value} value={value}>{value}</option>)}
              {source !== 'all' && !observedSources.includes(source) && source !== 'official' && source !== 'community' ? <option value={source}>{source}</option> : null}
            </select></label>
            <label>{t('apiKey')}<select value={apiKey} onChange={(event) => {
              filter(() => { setApiKey(event.currentTarget.value as SkillHubApiKeyFilter) })
            }}>
              <option value="all">{t('all')}</option><option value="required">{t('required')}</option><option value="none">{t('none')}</option>
            </select></label>
            <label>{t('sort')}<select value={sort} onChange={(event) => {
              filter(() => { setSort(event.currentTarget.value as SkillHubSort) })
            }}>
              {SORTS.map(value => <option key={value} value={value}>{t(value satisfies SkillCatalogKey)}</option>)}
            </select></label>
          </div>
          {notice !== '' ? <p className={css.notice} role="status">{notice}</p> : null}
          {error !== '' ? <div className={css.error} role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</Button></div> : null}
          <div className={css.results} aria-busy={busy}>
            {busy && !currentPage ? <p className={css.status} role="status">{t('loading')}</p> : null}
            {currentPage ? page?.items.map((skill, index) => <article key={`${skill.canonicalName ?? skill.slug}:${index}`} className={css.row}>
              <div className={css.skill}>
                <button type="button" className={css.skillName} onClick={() => { setSelectedIdentity(skill.canonicalName ?? ''); setNotice('') }}>{skill.name}</button>
                <span className={css.slug}>{skill.canonicalName ?? skill.slug} · {skill.version}</span>
                <p className={css.summary}>{skill.description}</p>
              </div>
              <span className={css.category}>{skill.category || t('all')}</span>
              <span className={css.metric} title={t('downloads')}>{skill.downloads.toLocaleString()}</span>
              <Button variant="outline" size="sm" onClick={() => { setSelectedIdentity(skill.canonicalName ?? ''); setNotice('') }}>{t('detail')}</Button>
            </article>) : null}
            {currentPage && page?.items.length === 0 && !busy ? <p className={css.status}>{t('empty')}</p> : null}
          </div>
          {currentPage && page !== undefined ? <footer className={css.pagination}><span>{page.total === 0 ? `0 ${t('results')}` : `${t('page', { page: String(pageNumber), total: String(Math.ceil(page.total / PAGE_SIZE)) })} · ${page.total.toLocaleString()} ${t('results')}`}</span>
            <div><Button variant="outline" size="sm" disabled={busy || pageNumber <= 1} onClick={() => { setPageNumber(value => value - 1) }}>{t('previous')}</Button>
              <Button variant="outline" size="sm" disabled={busy || pageNumber >= Math.ceil(page.total / PAGE_SIZE)} onClick={() => { setPageNumber(value => value + 1) }}>{t('next')}</Button></div>
          </footer> : null}
        </> : <>
          <div className={css.detailHeader}><Button variant="outline" size="sm" disabled={installing} onClick={() => { setSelectedIdentity(undefined); setDetail(undefined); setError('') }}>{t('back')}</Button></div>
          {error !== '' ? <div className={css.error} role="alert"><span>{error}</span><Button variant="outline" size="sm" onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</Button></div> : null}
          {detail === undefined ? error === '' ? <p className={css.status} role="status">{t('loading')}</p> : null : <section className={css.detail}>
            <h3>{detail.skill.name}</h3><p>{detail.skill.description}</p>
            <dl><dt>{t('publisher')}</dt><dd>{detail.owner || detail.skill.source}</dd><dt>{t('version')}</dt><dd>{detail.skill.version}</dd><dt>{t('size')}</dt><dd>{t('bytes', { count: detail.totalBytes.toLocaleString() })}</dd></dl>
            {detail.skill.requiresApiKey ? <p className={css.warning}>{t('apiRequired')}</p> : null}
            <h4>{t('changelog')}</h4><p className={css.changelog}>{detail.changelog || '—'}</p>
            <h4>{t('files')}</h4><ul className={css.files}>{detail.files.map(file => <li key={file.path}><code>{file.path}</code><span>{t('bytes', { count: file.size.toLocaleString() })}</span></li>)}</ul>
            {installing && !confirming ? <div className={css.installing}><span role="status">{t('installing')}</span></div> : null}
            <Button variant="primary" disabled={installing} onClick={() => { setConfirming(true) }}>{t('install')}</Button>
          </section>}
        </>}
      </div>
    </Modal>
    {detail !== undefined ? <Modal open={confirming} onClose={() => { if (!installing) setConfirming(false) }} title={t('reviewTitle')} closeLabel={t('closeReview')} description={t('reviewBody')} footer={<>
      <Button variant="outline" onClick={() => { if (installing) installController.current?.abort(new Error('Skill installation cancelled.')); else setConfirming(false) }}>{t('cancel')}</Button>
      <Button variant="primary" disabled={installing} onClick={() => { void confirmInstall() }}>{t('confirmInstall')}</Button>
    </>}>
      <p>{t('confirmBody', { name: detail.skill.name, version: detail.skill.version })}</p>
      {installing ? <div className={css.installing}><span role="status">{t('installing')}</span></div> : null}
      {error !== '' ? <p className={css.error} role="alert">{error}</p> : null}
    </Modal> : null}
  </>
}
