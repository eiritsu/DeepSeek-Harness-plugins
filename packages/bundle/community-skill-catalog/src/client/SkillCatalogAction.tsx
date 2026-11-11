/** Sidebar footer action for the community skill directory. */
import type { ReactNode } from 'react'
import { IconSkillOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createSkillCatalogStore } from './store.ts'
import css from './SkillCatalogPage.module.css'

type Store = PropsStore<ReturnType<typeof createSkillCatalogStore>>

/** Open the community skill directory from the official sidebar footer.
 * @param props Sidebar width, overlay state, and localized label.
 * @returns the footer action control.
 */
export function SkillCatalogAction(props: PropsRuntime<'sidebar.footer.action'> & Store & PropsLocale<'skillCatalog'>): ReactNode {
  const { wide, useStore, actions, t } = props
  const open = useStore(state => state.open)
  return <button type="button" className={wide ? css.action : css.actionRail} aria-label={t('title')} title={t('title')} aria-expanded={open}
    onClick={() => { actions.open() }}>
    <IconSkillOutlineRegular size={18} />
    {wide ? <span>{t('sidebarAction')}</span> : null}
  </button>
}
