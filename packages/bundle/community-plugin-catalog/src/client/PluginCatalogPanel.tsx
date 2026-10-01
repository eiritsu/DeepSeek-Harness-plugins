/** Category-filtered community plugin discovery and navigation to official installation. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button, IconClockOutlineRegular, IconCloseOutlineRegular, IconDownloadOutlineRegular, IconSearchOutlineRegular, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginCatalogPage as CatalogPage, PluginCatalogSort } from '@deepseek-ai/dsh-community-plugin-catalog/types'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createPluginCatalogStore } from './store.ts'
import type { PluginCatalogKey } from './locales.ts'
import css from './PluginCatalogPage.module.css'

export interface PluginCatalogPanelInjected {
  readonly api: { catalog(query?: string, category?: string, sort?: PluginCatalogSort, page?: number, limit?: number): Promise<RemotePage> }
  readonly openInstall: (spec: string) => void
  readonly language: () => 'zh' | 'en'
}

type RemotePage = { readonly ok: true; readonly value: CatalogPage } | { readonly ok: false; readonly error: { readonly message: string } }
type Store = PropsStore<ReturnType<typeof createPluginCatalogStore>>
type Props = PropsRuntime<'shell.overlay'> & Store & PropsLocale<'pluginCatalog'> & InjectFace<PluginCatalogPanelInjected>

const PAGE_SIZE = 20
const SORTS: readonly PluginCatalogSort[] = ['stars', 'npm', 'installs', 'newest', 'active']

/**
 * Render the site-backed community directory; choosing a plugin hands its
 * spec to the official install dialog.
 * @param props Remote source, localized controls, overlay visibility, and install navigation.
 * @returns the modal layer while the sidebar entry is open.
 */
export function PluginCatalogPanel({ api, openInstall, useStore, actions, t, language }: Props): ReactNode {
  const { open } = useStore(state => state)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState<PluginCatalogSort>('stars')
  const [pageNumber, setPageNumber] = useState(1)
  const [page, setPage] = useState<CatalogPage>()
  const [resolvedKey, setResolvedKey] = useState('')
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [failedKey, setFailedKey] = useState('')

  const requestKey = JSON.stringify([query, category, sort, pageNumber])
  const currentPage = resolvedKey === requestKey
  const categories = currentPage ? page?.categories : undefined

  useEffect(() => {
    if (!open) return
    let current = true
    setBusy(true)
    setError(undefined)
    void api.catalog(query, category, sort, pageNumber, PAGE_SIZE).then((result) => {
      if (!current) return
      if (!result.ok) throw new Error(result.error.message)
      setPage(result.value)
      setResolvedKey(requestKey)
      setFailedKey('')
    }).catch((reason: unknown) => {
      if (current) {
        setError(reason instanceof Error ? reason.message : String(reason))
        setFailedKey(requestKey)
      }
    }).finally(() => { if (current) setBusy(false) })
    return () => { current = false }
  }, [api, category, open, pageNumber, query, requestKey, retry, sort])

  const close = (): void => { actions.close() }
  const search = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setPageNumber(1)
    setQuery(draft.trim())
  }
  const install = (command: string): void => {
    const spec = parseCatalogInstall(command)
    if (spec === undefined) {
      setError(t('installHint'))
      setFailedKey(requestKey)
      return
    }
    actions.close()
    openInstall(spec)
  }

  const activeLanguage = language()
  const errorText = failedKey === requestKey ? error : undefined
  const loading = shouldShowCatalogLoading(busy, currentPage, errorText !== undefined)

  return <Modal open={open} onClose={close} title={t('title')} headless className={css.dialog ?? ''}>
    <div className={css.panel}>
      <header className={css.header}>
        <div><h2 className={css.title}>{t('title')}</h2><p className={css.description}>{t('description')}</p></div>
        <button type="button" className={css.close} aria-label={t('close')} onClick={close}><IconCloseOutlineRegular size={16} /></button>
      </header>
      <form className={css.search} onSubmit={search}>
        <Input type="search" value={draft} aria-label={t('searchPlaceholder')} placeholder={t('searchPlaceholder')} icon={<IconSearchOutlineRegular size={16} />}
          onChange={(event) => { setDraft(event.currentTarget.value) }} />
        <Button variant="primary" type="submit" disabled={busy}>{t('search')}</Button>
      </form>
      <section aria-label={t('all')} className={css.categories}>
        <button type="button" className={category === 'all' ? css.categoryActive : css.category} onClick={() => { setCategory('all'); setPageNumber(1) }}>
          {t('all')} <span>{categories?.reduce((sum, row) => sum + row.count, 0).toLocaleString()}</span>
        </button>
        {categories?.map(row => <button key={row.id} type="button" className={category === row.id ? css.categoryActive : css.category}
          onClick={() => { setCategory(row.id); setPageNumber(1) }}>
          {activeLanguage === 'zh' ? row.zh : row.en} <span>{row.count.toLocaleString()}</span>
        </button>)}
      </section>
      <div className={css.listHead}>
        <strong>{(currentPage ? page?.total ?? 0 : 0).toLocaleString()} {t('results')}</strong>
        <div role="group" aria-label={t('sort')} className={css.sorts}>
          {SORTS.map(value => <button key={value} type="button" aria-pressed={sort === value} className={sort === value ? css.sortActive : css.sort}
            onClick={() => { setSort(value); setPageNumber(1) }}>{t(value satisfies PluginCatalogKey)}</button>)}
        </div>
      </div>
      {errorText !== undefined ? <div className={css.error} role="alert"><span>{errorText}</span><Button variant="outline" size="sm" onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</Button></div> : null}
      <div className={css.list} aria-busy={loading}>
        {loading ? <p className={css.status} role="status">{t('loading')}</p> : null}
        {currentPage ? page?.plugins.map((plugin, index) => <article key={plugin.id} className={css.row}>
          <span className={css.rank}>{String((pageNumber - 1) * PAGE_SIZE + index + 1).padStart(2, '0')}</span>
          <div className={css.main}>
            <div className={css.nameLine}><a className={css.name} href={plugin.url} target="_blank" rel="noopener noreferrer">{plugin.name}</a><span className={css.repo}>{plugin.owner} / {plugin.url.split('/').at(-1)}</span></div>
            <p className={css.summary}>{activeLanguage === 'zh' ? plugin.description.zh : plugin.description.en}</p>
          </div>
          <span className={css.tag}>{page.categories.find(row => row.id === plugin.category)?.[activeLanguage] ?? plugin.category}</span>
          <span className={css.metric} title={t('starsCount', { count: plugin.stars.toLocaleString() })}>{t('stars')}: {plugin.stars.toLocaleString()}</span>
          <span className={`${css.metric} ${css.metricWithIcon}`} title={t('installsCount', { count: plugin.installCount.toLocaleString() })}>
            <IconDownloadOutlineRegular size={14} />{t('installsCount', { count: plugin.installCount.toLocaleString() })}
          </span>
          <time className={css.date} dateTime={plugin.added} aria-label={t('addedDate', { date: plugin.added })} title={t('addedDate', { date: plugin.added })}>
            <IconClockOutlineRegular size={14} />{plugin.added}
          </time>
          <Button variant="outline" size="sm" onClick={() => { install(plugin.install) }}>{t('install')}</Button>
        </article>) : null}
        {currentPage && page !== undefined && page.plugins.length === 0 && !busy ? <p className={css.status}>{t('empty')}</p> : null}
      </div>
      <footer className={css.pagination}>
        <span>{t('page', { page: String(pageNumber), total: String(page?.totalPages ?? 0) })}</span>
        <div><Button variant="outline" size="sm" disabled={busy || pageNumber <= 1} onClick={() => { setPageNumber(value => value - 1) }}>{t('previous')}</Button>
          <Button variant="outline" size="sm" disabled={busy || page === undefined || pageNumber >= page.totalPages} onClick={() => { setPageNumber(value => value + 1) }}>{t('next')}</Button></div>
      </footer>
      <p className={css.hint}>{t('installHint')}</p>
    </div>
  </Modal>
}

/**
 * Extract the bare spec from a catalog row's install command.
 * @param command - the command string the catalog publishes.
 * @returns the spec, or undefined when the command is not a recognised add.
 */
export function parseCatalogInstall(command: string): string | undefined {
  const input = command.trim()
  const match = /^dsh plugin --profile [a-z0-9_-]+ add (?:--allow-build=[@a-z0-9._/-]+ )?(\S+)$/iu.exec(input)
  const spec = match?.[1] ?? input
  const npmPackage = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9.+_~^*-]*)?$/iu.test(spec)
  const githubRepo = /^github:[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:#[^\s]*)?$/iu.test(spec)
    || /^git\+https:\/\/github\.com\/[^\s/?#]+\/[^\s/?#]+(?:\.git)?\/?(?:#[^\s]*)?$/iu.test(spec)
    || /^https:\/\/github\.com\/[^\s/?#]+\/[^\s/?#]+(?:\.git)?\/?(?:#[^\s]*)?$/iu.test(spec)
  return !/\s/u.test(spec) && (npmPackage || githubRepo) ? spec : undefined
}

/**
 * Decide whether a catalog request should show its loading status.
 * @param busy Whether the current request is pending.
 * @param currentPage Whether the visible page matches the current filters.
 * @param hasError Whether the current request failed.
 * @returns Whether to render the loading status.
 */
export function shouldShowCatalogLoading(busy: boolean, currentPage: boolean, hasError: boolean): boolean {
  return !hasError && (busy || !currentPage)
}
