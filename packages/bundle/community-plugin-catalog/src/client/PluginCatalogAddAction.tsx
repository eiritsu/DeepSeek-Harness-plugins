/** Menu action for "+ 添加插件" dropdown in the official Plugins page (<= 0.2.2-alpha.2). */
import type { ReactNode } from 'react'
import { IconPluginPinwheelOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createPluginCatalogStore } from './store.ts'
import css from './PluginCatalogPage.module.css'

type Store = PropsStore<ReturnType<typeof createPluginCatalogStore>>

/** Owner props passed by the legacy `plugins.add.actions` slot. */
export interface PluginAddActionsOwnerProps {
  readonly onDismiss: () => void
}

/**
 * Contributed MenuItemButton row in the "+ 添加插件" dropdown menu.
 * @param props Menu dismissal callback, overlay store actions, and localized labels.
 * @returns The menu item element.
 */
export function PluginCatalogAddAction(props: PluginAddActionsOwnerProps & Store & PropsLocale<'pluginCatalog'>): ReactNode {
  const { onDismiss, actions, t } = props
  return (
    <MenuItemButton
      icon={<IconPluginPinwheelOutlineRegular size={14} />}
      onSelect={() => {
        onDismiss()
        actions.open()
      }}>
      <span className={css.addMenuItem}>
        <span>{t('title')}</span>
        <span className={css.addMenuDescription}>{t('description')}</span>
      </span>
    </MenuItemButton>
  )
}
