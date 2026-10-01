import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys rendered by the settings page. */
export type LocaleKey = 'title' | 'description' | 'brave' | 'tavily' | 'firecrawl' | 'braveEnabled' | 'tavilyEnabled' | 'firecrawlEnabled' | 'apiKey' | 'keyHint' | 'keySet' | 'keyMissing' | 'reference' | 'referenceHint' | 'endpoint' | 'endpointHint' | 'provider' | 'providerHint' | 'maxResults' | 'maxResultsHint' | 'requestTimeout' | 'requestTimeoutHint' | 'maxResponseBytes' | 'maxResponseBytesHint' | 'maxMarkdownChars' | 'maxMarkdownCharsHint' | 'otherPlugins' | 'save' | 'saving' | 'saveFailed' | 'unavailable' | 'readOnly' | 'overridden' | 'reset' | 'invalid'

/** English settings labels. */
export const en: Record<LocaleKey, string> = {
  title: 'Tools & connections', description: 'Configure Brave, Tavily, and Firecrawl connections.',
  brave: 'Brave Search', tavily: 'Tavily', braveEnabled: 'Use Brave for web search', tavilyEnabled: 'Use Tavily for web search', apiKey: 'API key',
  firecrawl: 'Firecrawl extraction', firecrawlEnabled: 'Offer Firecrawl extraction to the model', requestTimeout: 'Request timeout (ms)', requestTimeoutHint: 'Maximum duration of one Firecrawl tool call.', maxResponseBytes: 'Maximum response bytes', maxResponseBytesHint: 'Response bytes read before JSON parsing.', maxMarkdownChars: 'Maximum Markdown characters', maxMarkdownCharsHint: 'Markdown code points returned to the model.',
  keyHint: 'The key is stored in credentials, outside ordinary settings.', keySet: 'Key configured', keyMissing: 'No key configured',
  reference: 'Credential reference', referenceHint: 'The environment reference resolved by the credentials service.', endpoint: 'Endpoint', endpointHint: 'The vendor API origin.', provider: 'Native web search provider', providerHint: 'Set `web.searchProvider` to `brave` or `tavily` in the profile configuration. Provider selection is explicit; this plugin does not add fallback or priority routing.',
  maxResults: 'Maximum results', maxResultsHint: 'Default result count when the search request has no limit.', otherPlugins: 'GitHub Code Search, Exa, Perplexity, and MCP are separate optional plugins. Install and manage them in Plugin Manager.', save: 'Save', saving: 'Saving…', saveFailed: 'The settings were not accepted.',
  unavailable: 'This plugin is not loaded.', readOnly: 'Settings are read-only.', overridden: 'Overridden', reset: 'Reset', invalid: 'Enter a valid value.',
}

/** Simplified Chinese settings labels. */
export const zh: Record<LocaleKey, string> = {
  title: '工具与连接', description: '配置 Brave、Tavily 和 Firecrawl 连接。',
  brave: 'Brave 搜索', tavily: 'Tavily', braveEnabled: '用于网页搜索', tavilyEnabled: '用于网页搜索', apiKey: 'API Key',
  firecrawl: 'Firecrawl 页面抽取', firecrawlEnabled: '向模型提供 Firecrawl 抽取工具', requestTimeout: '请求超时（毫秒）', requestTimeoutHint: '单次 Firecrawl 工具调用的最长时间。', maxResponseBytes: '最大响应字节数', maxResponseBytesHint: '解析 JSON 前读取的响应字节上限。', maxMarkdownChars: '最大 Markdown 字符数', maxMarkdownCharsHint: '返回给模型的 Markdown 码点上限。',
  keyHint: '密钥存储在普通设置之外的凭据库中。', keySet: '已配置密钥', keyMissing: '未配置密钥',
  reference: '凭据引用', referenceHint: '由凭据服务解析的环境变量引用。', endpoint: '接口地址', endpointHint: '厂商 API origin。', provider: '原生网页搜索提供方', providerHint: '在 profile 配置中将 `web.searchProvider` 设为 `brave` 或 `tavily`。提供方必须显式选择；此插件不添加 fallback 或优先级路由。',
  maxResults: '最多结果数', maxResultsHint: '搜索请求未指定上限时采用的默认结果数。', otherPlugins: 'GitHub Code Search、Exa、Perplexity 和 MCP 是独立的可选插件，可在 Plugin Manager 中安装和管理。', save: '保存', saving: '保存中…', saveFailed: '设置未被接受。',
  unavailable: '此插件未加载。', readOnly: '设置为只读。', overridden: '已覆盖', reset: '重置', invalid: '请输入有效值。',
}

/** Shared staged form copy. */
export function formLabels(t: (key: LocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
