/** Desktop migration Settings copy. */
export const zh = {
  tab: '桌面功能迁移', title: '选择要加入的桌面功能',
  body: '此 Desktop profile 保留了之前保存的插件选择。你可以选择新增功能；未选中的功能不会启用。',
  keep: '保留当前选择', confirm: '应用所选功能', later: '稍后', loading: '正在读取迁移状态…',
  unavailable: '此迁移仅适用于 Desktop profile。', complete: '迁移选择已保存。',
  completeRestart: '迁移选择已保存；需要重启应用后生效。', failed: '无法保存迁移选择：{reason}',
  partial: '无法启用 {name}。已重新读取当前 profile 选择；可稍后重试。',
  alreadySelected: '当前已选择：{names}', installFirst: '以下功能尚未安装，请先通过 Plugin Manager 安装：{names}',
  warning: '迁移状态无法读取：{reason}', empty: '没有尚未选择的桌面功能。',
  pluginCatalog: '社区插件目录', skillCatalog: 'SkillHub 技能目录', officeFiles: 'Deepseek-Files 文件识别',
  modelCatalog: '模型目录', copySessionId: '复制会话 ID', turnTreatment: '运行状态文字效果',
  sessionArchive: '会话备份', lark: '飞书私聊接入（默认关闭）',
} as const

/** Copy key of this page's dictionary. */
export type DesktopMigrationLocaleKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  tab: 'Desktop migration', title: 'Choose Desktop features to add',
  body: 'This Desktop profile keeps its previously saved plugin selection. Choose any additional features; unselected features stay off.',
  keep: 'Keep current selection', confirm: 'Apply selected features', later: 'Later', loading: 'Reading migration status…',
  unavailable: 'This migration is only available in a Desktop profile.', complete: 'The migration selection was saved.',
  completeRestart: 'The migration selection was saved; restart the application to apply it.',
  failed: 'Could not save the migration selection: {reason}',
  partial: 'Could not enable {name}. The current profile selection was re-read; you can retry later.',
  alreadySelected: 'Currently selected: {names}', installFirst: 'Install these features through Plugin Manager first: {names}',
  warning: 'Migration status could not be read: {reason}', empty: 'No additional Desktop features are available.',
  pluginCatalog: 'Community plugin catalog', skillCatalog: 'SkillHub skills catalog',
  officeFiles: 'Deepseek-Files recognition', modelCatalog: 'Model catalog', copySessionId: 'Copy Session ID',
  turnTreatment: 'Running status treatment', sessionArchive: 'Session archive', lark: 'Lark private chat (off by default)',
} satisfies Record<DesktopMigrationLocaleKey, string>
