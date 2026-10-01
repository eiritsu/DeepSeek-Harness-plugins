/** Locale copy for the Lark bundle configuration page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Keys rendered by the page. */
export type LarkLocaleKey = 'title' | 'appId' | 'appIdHint' | 'appSecretEnv' | 'appSecretEnvHint' | 'brand'
  | 'feishu' | 'lark' | 'authorizedUserOpenId' | 'authorizedUserOpenIdHint' | 'enabled' | 'enabledHint'
  | 'connectionPath' | 'quickPath' | 'existingPath' | 'quickPathHint' | 'existingPathHint' | 'startQuickConnect' | 'completeQuickConnect'
  | 'startUserAuthorization' | 'saveAndAuthorize' | 'completeUserAuthorization' | 'cancelAuthorization' | 'openVerificationPage'
  | 'authorizationCallout' | 'authorizationHint' | 'authorizationBadgePending' | 'authorizationBadgeOpen'
  | 'authorizationResumable' | 'authorizationExpired' | 'authorizationRestart' | 'authorizationRestartHint'
  | 'advanced' | 'setupComplete' | 'setupCancelled' | 'setupExpired' | 'setupNotConfigured' | 'setupNotReady'
  | 'setupFailed' | 'setupUnsupportedUrl' | 'saveApplicationFirst' | 'statusUnavailable' | 'statusDiagnostic'
  | 'registrationTimeoutMs' | 'registrationTimeoutMsHint'
  | 'cliEnabled' | 'cliEnabledHint' | 'cliTimeoutMs' | 'cliTimeoutMsHint'
  | 'cliMaxOutputBytes' | 'cliMaxOutputBytesHint' | 'cliGraceMs' | 'cliGraceMsHint'
  | 'conversationCwd' | 'conversationCwdHint'
  | 'appSecret' | 'appSecretHint' | 'secretConfigured' | 'secretMissing' | 'overridden' | 'reset'
  | 'invalid' | 'readOnly' | 'unavailable' | 'save' | 'saving' | 'saveFailed'
  | 'connectionStatus' | 'statusDisabled' | 'statusConnecting' | 'statusConnected' | 'statusError' | 'statusPendingAuthorization'
  | 'statusMissingIdentityHint' | 'statusMissingCredential' | 'statusConnectionFailed'

/** English labels. */
export const en: Record<LarkLocaleKey, string> = {
  title: 'Lark', appId: 'Application ID', appIdHint: 'The application ID used by the Lark or Feishu bot.',
  appSecretEnv: 'Secret reference', appSecretEnvHint: 'Credential reference resolved by the Host.',
  brand: 'Platform', feishu: 'Feishu', lark: 'Lark',
  authorizedUserOpenId: 'Authorized user Open ID',
  authorizedUserOpenIdHint: 'Only this user may start private-chat sessions with the bot.',
  connectionPath: 'Connection method', quickPath: 'Quick connect', existingPath: 'Use an existing app',
  quickPathHint: 'Create an app and authorize one private-chat user.',
  existingPathHint: 'Use an app you manage and authorize one private-chat user.',
  startQuickConnect: 'Create app and authorize', completeQuickConnect: 'I finished app setup',
  startUserAuthorization: 'Authorize user', completeUserAuthorization: 'I finished authorization',
  saveAndAuthorize: 'Save and authorize',
  cancelAuthorization: 'Cancel', openVerificationPage: 'Open official Lark authorization page',
  authorizationCallout: 'Finish official Lark authorization',
  authorizationHint: 'Open the official Lark page in a new tab, grant the requested scope, then return here and save the authorized user.',
  authorizationBadgePending: 'Authorization pending',
  authorizationBadgeOpen: 'Action required',
  authorizationResumable: 'If you already finished authorization on the official Lark page, confirm here. Otherwise restart to get a fresh link.',
  authorizationExpired: 'The saved device authorization expired. Restart to get a fresh link.',
  authorizationRestart: 'Restart authorization',
  authorizationRestartHint: 'Issue a fresh device authorization so you can return to the official Lark page.',
  advanced: 'Advanced settings', setupComplete: 'Authorization completed.', setupCancelled: 'Authorization cancelled. You can retry.',
  setupExpired: 'The authorization expired. Start again to get a new link.',
  setupNotConfigured: 'Save the application ID and secret before starting user authorization.',
  setupNotReady: 'Authorization is not ready or has expired. Start again to retry.',
  setupFailed: 'The operation failed. Check the configuration and retry.',
  setupUnsupportedUrl: 'The provider returned an unsupported authorization address; it was not opened.',
  saveApplicationFirst: 'Save the application settings before authorizing a user.',
  statusUnavailable: 'Status service unavailable; the Lark connection state is unknown.',
  statusDiagnostic: 'Status transport diagnostic',
  registrationTimeoutMs: 'App registration timeout (ms)',
  registrationTimeoutMsHint: 'Deadline for the official app registration flow, from 30,000 to 900,000 ms.',
  enabled: 'Enable connection', enabledHint: 'Opens the Lark or Feishu long connection after saving.',
  cliEnabled: 'Enable Lark CLI tool', cliEnabledHint: 'Makes lark_cli available to the agent. Commands that may change Lark data require approval.',
  cliTimeoutMs: 'CLI process timeout (ms)', cliTimeoutMsHint: 'Per-process deadline, from 1,000 to 300,000 ms.',
  cliMaxOutputBytes: 'CLI output limit (bytes)', cliMaxOutputBytesHint: 'Capture limit for stdout and stderr separately, from 1 KiB to 4 MiB.',
  cliGraceMs: 'CLI termination grace (ms)', cliGraceMsHint: 'Wait before force-stopping a timed-out process, from 100 to 30,000 ms.',
  conversationCwd: 'Session working directory', conversationCwdHint: 'Working directory for new private-chat Sessions; leave blank for the default.',
  appSecret: 'Application secret', appSecretHint: 'Saved to the credential store; its value is never read back here.',
  secretConfigured: 'Configured', secretMissing: 'Not configured', overridden: 'Overridden', reset: 'Reset to default',
  invalid: 'Enter a value or leave blank.', readOnly: 'This deployment stores settings read-only.',
  unavailable: 'Lark is not loaded, so it cannot be configured right now.', save: 'Save', saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  connectionStatus: 'Connection status', statusDisabled: 'Disabled', statusConnecting: 'Connecting',
  statusConnected: 'Connected', statusError: 'Connection error', statusPendingAuthorization: 'Waiting for user authorization',
  statusMissingIdentityHint: 'Save the application and complete official user authorization before enabling the long connection.',
  statusMissingCredential: 'The configured application secret is not available.',
  statusConnectionFailed: 'The connection could not be established. Check the Host log for details.',
}

/** Simplified Chinese labels. */
export const zh: Record<LarkLocaleKey, string> = {
  title: 'Lark', appId: '应用 ID', appIdHint: 'Lark 或飞书机器人的应用 ID。',
  appSecretEnv: '密钥引用', appSecretEnvHint: 'Host 用于解析应用密钥的凭据引用。',
  brand: '平台', feishu: '飞书', lark: 'Lark',
  authorizedUserOpenId: '授权用户 Open ID',
  authorizedUserOpenIdHint: '仅此用户可以通过私聊启动 Harness Session。',
  connectionPath: '连接方式', quickPath: '快速连接', existingPath: '使用已有应用',
  quickPathHint: '创建应用并授权一位私聊用户。',
  existingPathHint: '使用已有应用并授权一位私聊用户。',
  startQuickConnect: '创建应用并授权', completeQuickConnect: '我已完成应用设置',
  startUserAuthorization: '授权用户', completeUserAuthorization: '我已完成授权',
  saveAndAuthorize: '保存并授权',
  cancelAuthorization: '取消', openVerificationPage: '打开官方 Lark 授权页面',
  authorizationCallout: '完成官方 Lark 授权',
  authorizationHint: '在新标签页中打开官方 Lark 页面并授予所请求的权限，然后回到这里保存已授权用户。',
  authorizationBadgePending: '授权未完成',
  authorizationBadgeOpen: '需要操作',
  authorizationResumable: '如果已在官方 Lark 页面完成授权，请在此确认。否则重新开始以获取新链接。',
  authorizationExpired: '保存的设备授权已过期，请重新开始以获取新链接。',
  authorizationRestart: '重新开始授权',
  authorizationRestartHint: '重新签发一个设备授权，使你可以回到官方 Lark 页面完成授权。',
  advanced: '高级设置', setupComplete: '授权已完成。', setupCancelled: '已取消授权，可以重新尝试。',
  setupExpired: '授权已过期。请重新开始以获取新链接。',
  setupNotConfigured: '请先保存应用 ID 和密钥，再开始用户授权。',
  setupNotReady: '授权尚未就绪或已过期。请重新开始。',
  setupFailed: '操作失败。请检查配置后重试。',
  setupUnsupportedUrl: '服务返回了不受支持的授权地址，未打开该地址。',
  saveApplicationFirst: '请先保存应用设置，再授权用户。',
  statusUnavailable: '状态服务暂不可用，无法确认 Lark 连接状态。',
  statusDiagnostic: '状态传输诊断',
  registrationTimeoutMs: '应用注册超时（毫秒）',
  registrationTimeoutMsHint: '官方应用注册流程的截止时间，范围 30,000 至 900,000 毫秒。',
  enabled: '启用连接', enabledHint: '保存后打开 Lark 或飞书长连接。',
  cliEnabled: '启用 Lark CLI 工具', cliEnabledHint: '向 Agent 提供 lark_cli。可能修改 Lark 数据的命令需要审批。',
  cliTimeoutMs: 'CLI 进程超时（毫秒）', cliTimeoutMsHint: '单个进程的截止时间，范围 1,000 至 300,000 毫秒。',
  cliMaxOutputBytes: 'CLI 输出上限（字节）', cliMaxOutputBytesHint: 'stdout 与 stderr 各自的采集上限，范围 1 KiB 至 4 MiB。',
  cliGraceMs: 'CLI 终止宽限期（毫秒）', cliGraceMsHint: '超时后强制结束进程前的等待时间，范围 100 至 30,000 毫秒。',
  conversationCwd: 'Session 工作目录', conversationCwdHint: '新私聊 Session 使用的工作目录；留空使用默认路径。',
  appSecret: '应用密钥', appSecretHint: '密钥保存在凭据存储中，页面不会读取其值。',
  secretConfigured: '已配置', secretMissing: '未配置', overridden: '已覆盖', reset: '恢复默认值',
  invalid: '请填写内容或留空。', readOnly: '此部署的设置为只读。',
  unavailable: 'Lark 当前未加载，暂时无法配置。', save: '保存', saving: '保存中…',
  saveFailed: '部署未接受这些值，已保留供你修改。',
  connectionStatus: '连接状态', statusDisabled: '已停用', statusConnecting: '连接中',
  statusConnected: '已连接', statusError: '连接错误', statusPendingAuthorization: '等待用户授权',
  statusMissingIdentityHint: '请先保存应用设置并完成官方用户授权，再启用长连接。',
  statusMissingCredential: '当前配置的应用密钥不可用。', statusConnectionFailed: '无法建立连接，请查看 Host 日志。',
}

/** Shared form-shell labels.
 * @param t - the locale lookup for Lark configuration text.
 * @returns the localized labels required by the shared form shell.
 */
export function formLabels(t: (key: LarkLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
