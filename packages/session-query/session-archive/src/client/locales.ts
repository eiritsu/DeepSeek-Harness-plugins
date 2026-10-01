/** Session archive page copy. */

export const zh = {
  title: '会话备份',
  description: '导出或恢复会话日志及其引用的附件。不会覆盖现有会话。',
  export: '导出会话归档',
  import: '导入会话归档',
  importHint: '仅接受 DeepSeek Harness 会话归档 ZIP。导入后会创建归档中的会话；已有同 ID 会话时拒绝导入。',
  sqliteImport: '导入旧版桌面 SQLite 备份',
  sqliteImportHint: '从旧版备份恢复会话，保留原备份。',
  chooseBackupDirectory: '选择备份目录',
  chooseBackupFile: '选择 SQLite 备份',
  chooseAttachmentDirectory: '选择附件根目录',
  backupDirectoryLabel: '备份目录',
  backupFileLabel: '备份文件',
  attachmentRootLabel: '附件目录',
  startSqliteImport: '转换并导入',
  noSqliteBackups: '所选目录没有普通 .sqlite 文件。',
  importingSqlite: '正在转换并导入 SQLite 备份…',
  sqliteImportError: '不支持此次迁移或导入失败：{message}。源文件保持不变；转换失败不会写入会话。',
  importing: '正在验证并导入…',
  imported: '已导入 {count} 个会话。',
  refreshError: '会话已导入，但列表未能刷新；请重新载入会话列表。',
  partialImport: '部分导入：{imported} 个会话已导入，{failed} 项失败或未开始，{unassigned} 个会话未归属工作区。未创建任何目录；请创建或打开已存在的匹配工作区后重试。无 cwd 的会话需手动归属。重试记录：{journal}',
  exportError: '导出失败，请检查连接后重试。',
  importError: '导入失败：{message}',
  invalidFile: '请选择 ZIP 归档文件。',
} satisfies Record<string, string>

/** English labels and messages for the Session archive page. */
export const en = {
  title: 'Session archive',
  description: 'Export or restore Session logs and their referenced attachments. Existing Sessions are never overwritten.',
  export: 'Export Session archive',
  import: 'Import Session archive',
  importHint: 'Only DeepSeek Harness Session archive ZIP files are accepted. Imported Sessions keep their archived IDs; an existing ID rejects the import.',
  sqliteImport: 'Import legacy Desktop SQLite backup',
  sqliteImportHint: 'Restore Sessions from a legacy backup; the source backup remains unchanged.',
  chooseBackupDirectory: 'Choose backup directory',
  chooseBackupFile: 'Choose SQLite backup',
  chooseAttachmentDirectory: 'Choose attachment root',
  backupDirectoryLabel: 'Backup directory',
  backupFileLabel: 'Backup file',
  attachmentRootLabel: 'Attachment directory',
  startSqliteImport: 'Convert and import',
  noSqliteBackups: 'The selected directory contains no regular .sqlite files.',
  importingSqlite: 'Converting and importing SQLite backup…',
  sqliteImportError: 'This migration is unsupported or the import failed: {message}. The source files are unchanged; conversion failures do not write Sessions.',
  importing: 'Validating and importing…',
  imported: 'Imported {count} Sessions.',
  refreshError: 'The Sessions were imported, but the list could not refresh. Reload the Session list.',
  partialImport: 'Partial import: {imported} Sessions imported; {failed} items failed or did not start; {unassigned} Sessions remain unassigned. No directory was created. Create or open an existing matching Workspace, then retry; Sessions without cwd need manual assignment. Retry record: {journal}',
  exportError: 'Export failed. Check the connection and try again.',
  importError: 'Import failed: {message}',
  invalidFile: 'Choose a ZIP archive.',
} satisfies Record<keyof typeof zh, string>

/** Keys shared by the English and Chinese Session archive dictionaries. */
export type SessionArchiveLocaleKey = keyof typeof zh
