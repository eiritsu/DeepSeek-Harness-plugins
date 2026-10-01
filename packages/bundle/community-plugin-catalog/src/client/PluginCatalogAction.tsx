/** Sidebar footer entry for the community plugin catalog. */
import type { ReactNode } from 'react'
import { IconPluginPinwheelOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createPluginCatalogStore } from './store.ts'
import type { PluginCatalogPanelInjected } from './PluginCatalogPanel.tsx'
import css from './PluginCatalogPage.module.css'

type Store = PropsStore<ReturnType<typeof createPluginCatalogStore>>

/** Open or focus the directory overlay from the official sidebar footer.
 * @param props Footer width, overlay state, and translated label.
 * @returns the sidebar action row.
 */
export function PluginCatalogAction(props: PropsRuntime<'sidebar.footer.action'> & Store & PropsLocale<'pluginCatalog'> & InjectFace<PluginCatalogPanelInjected>): ReactNode {
  const { wide, useStore, actions, t } = props
  const open = useStore(state => state.open)
  return <button type="button" className={wide ? css.action : css.actionRail} aria-label={t('title')} title={t('title')} aria-expanded={open}
    onClick={() => { actions.open() }}>
    <IconPluginPinwheelOutlineRegular size={18} />
    {wide ? <span>{t('sidebarAction')}</span> : null}
  </button>
}
