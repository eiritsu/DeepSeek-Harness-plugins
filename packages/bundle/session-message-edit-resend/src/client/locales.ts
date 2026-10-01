/** Copy for the optional latest-user-turn edit action. */
export const zh = {
  'action.edit': '编辑并重发',
  'action.cancel': '取消',
  'status.editing': '正在编辑已发送的消息',
  'status.edited': '已编辑',
  'status.submitting': '正在重发…',
  'status.uncertain': '请求状态不确定，未自动重试。请先确认会话记录。',
  'status.recoveredUncertain': '上次重发状态不确定，未自动重试。请先确认会话记录。',
  'status.failed': '重发失败。编辑后的内容仍保留在输入框。',
  'error.empty': '请输入要重发的消息内容。',
  'error.attachments': '请先取消编辑并另行发送新附件；此操作会保留原消息附件。',
  'error.uncertain': '请求可能已发送，系统不会自动重复调用。请先确认会话记录。',
  'error.failed': '重发未完成。编辑后的内容仍保留在输入框。',
} as const

export type EditResendLocaleKey = keyof typeof zh

/** English dictionary with the same keys as the Chinese dictionary. */
export const en = {
  'action.edit': 'Edit and resend',
  'action.cancel': 'Cancel',
  'status.editing': 'Editing a sent message',
  'status.edited': 'Edited',
  'status.submitting': 'Resending…',
  'status.uncertain': 'The request state is uncertain and was not retried. Check the conversation first.',
  'status.recoveredUncertain': 'The previous resend has an uncertain status and was not retried. Check the conversation first.',
  'status.failed': 'Resend failed. The edited text remains in the composer.',
  'error.empty': 'Enter message text to resend.',
  'error.attachments': 'Cancel editing before sending new attachments; the original attachments will be preserved.',
  'error.uncertain': 'The request may have been sent. It will not be retried automatically; check the conversation first.',
  'error.failed': 'Resend did not complete. The edited text remains in the composer.',
} satisfies Record<EditResendLocaleKey, string>
