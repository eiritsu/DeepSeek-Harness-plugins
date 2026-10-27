/** Dictionaries for IM Integration settings. */

export const zh = {
  // Tabs
  tabLark: '飞书 (Lark)',
  tabDingtalk: '钉钉 (DingTalk)',
  tabWecom: '企业微信 (WeCom)',
  tabWeixin: '微信 (WeChat)',
  tabQq: 'QQ',
  tabTelegram: 'Telegram',
  tabDiscord: 'Discord',
  tabWhatsapp: 'WhatsApp',

  // Common Status
  connectionStatus: '连接状态',
  statusDisabled: '已停用',
  statusConnecting: '连接中',
  statusConnected: '已连接',
  statusError: '连接异常',
  statusUnavailable: '服务不可用',
  statusPendingAuthorization: '等待授权',

  // Common Access Control (Whitelist)
  whitelistTitle: '访问控制与用户白名单',
  enableWhitelist: '启用用户白名单限制',
  whitelistHintOpen: '公开模式：任何用户发来的私聊或群聊 @ 消息均可直接与 Agent 对话，不设身份白名单限制。',
  whitelistHintEnforced: '白名单模式：仅允许下方列表中的用户账号触发 Agent，其余陌生人的消息将被直接忽略。',
  authorizedUsers: '授权用户 ID 名单',
  authorizedUsersPlaceholder: '例如：ou_xxx, 123456, wxid_xxx（多个账号以逗号分隔）',

  // Common Moderation & Tool Approval Bypass
  moderationTitle: '审查拦截与操作审批',
  enableModeration: '启用审查拦截与操作审批',
  moderationHintBypass: '⚡ 完全放行模式 (Full Autonomy)：Agent 的所有工具调用（运行命令行、读写文件、发消息等）将 100% 自动执行，无需人工二次审批与拦截。',
  moderationHintEnforced: '安全管控模式：Agent 执行敏感命令时将在聊天会话中请求人工确认，或进行敏感词拦截。',
  approvalPolicy: '审批级别',
  approvalHighRisk: '仅高危写操作拦截（涉及文件删除、写入、执行系统命令时请求确认）',
  approvalAll: '全工具审批（所有工具调用均需在聊天中回复确认）',
  sensitiveKeywords: '敏感词过滤拦截列表',
  sensitiveKeywordsPlaceholder: '违规词1, 敏感词2（命中上述关键词自动阻断）',

  // Common CLI & Actions
  enablePlatform: '启用此平台连接',
  enableCliTool: '允许 Agent 调用官方命令行工具',
  saveSettings: '保存平台设置',
  secretConfigured: '已配置',
  secretHint: '密钥已加密保存在凭据存储中，页面不会明文读取。',

  // Lark Specific
  larkBrand: '平台版本',
  larkFeishu: '飞书 (feishu.cn)',
  larkSuite: 'Lark (larksuite.com)',
  larkAppId: '应用 ID (App ID)',
  larkAppSecret: '应用密钥 (App Secret)',

  // DingTalk Specific
  dingtalkClientId: 'Client ID (AppKey)',
  dingtalkClientSecret: 'Client Secret (AppSecret)',
  dingtalkStreamHint: '使用钉钉官方 Stream 模式 WebSocket 长连接，免公网 IP。支持官方 dws 命令行工具。',

  // WeCom Specific
  wecomBotId: '机器人 ID (Bot ID)',
  wecomBotSecret: '机器人密钥 (Secret)',
  wecomCliHint: '支持企业微信官方 @wecom/cli 技能与消息收发。',

  // WeChat Specific
  weixinScanHint: '微信扫码授权模式（支持个人微信号接入为 AI 联系人，免公网 IP）。',
  weixinScanButton: '生成授权二维码',

  // QQ Specific
  qqAppId: 'QQ 开放平台 AppID',
  qqAppSecret: 'QQ 开放平台 AppSecret',
  qqSandbox: '使用沙箱环境 (Sandbox)',
  qqHint: '通过腾讯 QQ 开放平台官方 WebSocket Gateway 接入，支持 C2C 私聊与群聊。',

  // Telegram Specific
  telegramBotToken: 'Bot Token',
  telegramHint: '通过 Telegram 官方 Bot API Long-Polling 接入，免公网 IP。可在 @BotFather 获取 Token。',

  // Discord Specific
  discordBotToken: 'Bot Token',
  discordHint: '通过 Discord Gateway WebSocket 接入，免公网 IP。请在 Discord Developer Portal 开启 Message Content Intent。',

  // WhatsApp Specific
  whatsappHint: '支持 WhatsApp Web 扫码配对免商户资质接入。',
  whatsappScanButton: '扫码配对',

  // QR Code Modal
  qrModalTitleWeixin: '微信扫码授权',
  qrModalTitleWhatsapp: 'WhatsApp 扫码配对',
  qrModalDescWeixin: '请使用微信扫描下方二维码，完成账号授权接入。',
  qrModalDescWhatsapp: '请使用手机 WhatsApp 扫描此二维码完成配对关联。',
  qrModalHintWeixin: '使用手机微信“扫一扫”扫描上方二维码，并在手机上确认登录。',
  qrModalHintWhatsapp: '手机打开 WhatsApp > 设置 > 关联设备 > 扫描此二维码。',
  qrModalStatusWaiting: '等待扫码中...',
  qrModalRefresh: '刷新二维码',
  qrModalClose: '关闭',
}

export const en = {
  // Tabs
  tabLark: 'Feishu (Lark)',
  tabDingtalk: 'DingTalk',
  tabWecom: 'WeCom',
  tabWeixin: 'WeChat',
  tabQq: 'QQ',
  tabTelegram: 'Telegram',
  tabDiscord: 'Discord',
  tabWhatsapp: 'WhatsApp',

  // Common Status
  connectionStatus: 'Connection Status',
  statusDisabled: 'Disabled',
  statusConnecting: 'Connecting',
  statusConnected: 'Connected',
  statusError: 'Error',
  statusUnavailable: 'Unavailable',
  statusPendingAuthorization: 'Pending Authorization',

  // Common Access Control (Whitelist)
  whitelistTitle: 'Access Control & User Whitelist',
  enableWhitelist: 'Enable User Whitelist Restriction',
  whitelistHintOpen: 'Open Mode: Any user can directly chat with the Agent without whitelist restrictions.',
  whitelistHintEnforced: 'Whitelist Mode: Only user accounts in the list below can chat with the Agent. Other messages are ignored.',
  authorizedUsers: 'Authorized User Identifiers',
  authorizedUsersPlaceholder: 'e.g. ou_xxx, 123456, wxid_xxx (comma-separated)',

  // Common Moderation & Tool Approval Bypass
  moderationTitle: 'Moderation & Action Approval',
  enableModeration: 'Enable Moderation & Action Approval',
  moderationHintBypass: '⚡ Full Autonomy Mode: All Agent tool calls (CLI commands, file writes, messaging) will execute automatically without secondary confirmation or interception.',
  moderationHintEnforced: 'Safety Guard Mode: Requests user confirmation before sensitive actions or blocks sensitive keywords.',
  approvalPolicy: 'Approval Level',
  approvalHighRisk: 'Intercept High-Risk Writes Only (File deletion, write, shell commands)',
  approvalAll: 'Approve All Tool Executions',
  sensitiveKeywords: 'Sensitive Keywords Filter',
  sensitiveKeywordsPlaceholder: 'keyword1, keyword2 (blocked when matched)',

  // Common CLI & Actions
  enablePlatform: 'Enable connection for this platform',
  enableCliTool: 'Allow Agent to execute official CLI tool',
  saveSettings: 'Save Platform Settings',
  secretConfigured: 'Configured',
  secretHint: 'Secret is safely saved in credentials store and not exposed in plaintext.',

  // Lark Specific
  larkBrand: 'Platform Variant',
  larkFeishu: 'Feishu (feishu.cn)',
  larkSuite: 'Lark (larksuite.com)',
  larkAppId: 'App ID',
  larkAppSecret: 'App Secret',

  // DingTalk Specific
  dingtalkClientId: 'Client ID (AppKey)',
  dingtalkClientSecret: 'Client Secret (AppSecret)',
  dingtalkStreamHint: 'Uses DingTalk official Stream mode WebSocket connection without public IP. Supports dws CLI tool.',

  // WeCom Specific
  wecomBotId: 'Bot ID',
  wecomBotSecret: 'Bot Secret',
  wecomCliHint: 'Supports official @wecom/cli skills and messaging.',

  // WeChat Specific
  weixinScanHint: 'WeChat QR code authorization (connects personal WeChat as an AI contact without public IP).',
  weixinScanButton: 'Generate Login QR Code',

  // QQ Specific
  qqAppId: 'QQ Open Platform AppID',
  qqAppSecret: 'QQ Open Platform AppSecret',
  qqSandbox: 'Use Sandbox Environment',
  qqHint: 'Connects via Tencent QQ Open Platform WebSocket Gateway. Supports C2C direct messages.',

  // Telegram Specific
  telegramBotToken: 'Bot Token',
  telegramHint: 'Connects via official Telegram Bot API Long-Polling without public IP. Obtain token from @BotFather.',

  // Discord Specific
  discordBotToken: 'Bot Token',
  discordHint: 'Connects via Discord Gateway WebSocket without public IP. Ensure Message Content Intent is enabled in Discord Portal.',

  // WhatsApp Specific
  whatsappHint: 'Supports WhatsApp Web QR code pairing without enterprise qualification.',
  whatsappScanButton: 'Scan Pairing QR Code',

  // QR Code Modal
  qrModalTitleWeixin: 'WeChat QR Code Authorization',
  qrModalTitleWhatsapp: 'WhatsApp Web QR Pairing',
  qrModalDescWeixin: 'Scan the QR code below with WeChat to complete account authorization.',
  qrModalDescWhatsapp: 'Scan this QR code with WhatsApp on your phone to complete device pairing.',
  qrModalHintWeixin: 'Open WeChat > Scan, and tap "Confirm Login" on your phone.',
  qrModalHintWhatsapp: 'Open WhatsApp on your phone > Settings > Linked Devices > Scan QR code.',
  qrModalStatusWaiting: 'Waiting for scan...',
  qrModalRefresh: 'Refresh',
  qrModalClose: 'Close',
}

export type ImLocaleKey = keyof typeof zh
