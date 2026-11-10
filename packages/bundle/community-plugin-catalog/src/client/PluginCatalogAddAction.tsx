/** Menu action for "+ 添加插件" dropdown in the official Plugins page. */
import type { ReactNode } from 'react'
import { IconPluginPinwheelOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginAddActionsProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { createPluginCatalogStore } from './store.ts'
import css from './PluginCatalogPage.module.css'

type Store = PropsStore<ReturnType<typeof createPluginCatalogStore>>

/** Contributed MenuItemButton row in the "+ 添加插件" dropdown menu. */
export function PluginCatalogAddAction(props: PluginAddActionsProps & Store & PropsLocale<'pluginCatalog'>): ReactNode {
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
