/** Sidebar footer action for the SkillHub skills directory. */
import type { ReactNode } from 'react'
import { IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSkillCatalogStore } from './store.ts'
import type { SkillCatalogPanelInjected } from './SkillCatalogPanel.tsx'
import css from './SkillCatalogPage.module.css'

type Store = PropsStore<ReturnType<typeof createSkillCatalogStore>>

/** Open the SkillHub directory from the official sidebar footer.
 * @param props Sidebar width, visibility state, and localized label.
 * @returns the footer action.
 */
export function SkillCatalogAction(props: PropsRuntime<'sidebar.footer.action'> & Store & PropsLocale<'skillCatalog'> & InjectFace<SkillCatalogPanelInjected>): ReactNode {
  const { wide, useStore, actions, t } = props
  const open = useStore(state => state.open)
  return <button type="button" className={wide ? css.action : css.actionRail} aria-label={t('title')} title={t('title')} aria-expanded={open}
    onClick={() => { actions.open() }}>
    <IconSkillOutlineRegular size={18} />
    {wide ? <span>{t('sidebarAction')}</span> : null}
  </button>
}
