/** Localized community catalog controls and status. */
export const NS = 'pluginCatalog'

/** Simplified Chinese community catalog interface strings. */
export const zh = {
  title: '社区插件',
  sidebarAction: '插件库',
  description: '来自 DeepSeek Harness 社区的插件目录。',
  close: '关闭社区插件',
  search: '搜索',
  searchPlaceholder: '搜索插件、作者或能力',
  all: '全部',
  sort: '排序',
  stars: 'Star 数',
  npm: 'npm 榜',
  installs: '安装次数',
  newest: '最新发布',
  active: '最近活跃',
  results: '个插件',
  starsCount: '{count} Star',
  installsCount: '{count} 次安装',
  addedDate: '收录日期：{date}',
  loading: '正在加载插件…',
  retry: '重试',
  empty: '没有找到匹配的插件。',
  previous: '上一页',
  next: '下一页',
  page: '第 {page} 页，共 {total} 页',
  install: '安装',
  installHint: 'Host 会显示待安装的包版本和来源；确认后开始安装。',
} satisfies Record<string, string>

/** Keys shared by the community catalog's locale dictionaries. */
export type PluginCatalogKey = keyof typeof zh

/** English community catalog interface strings. */
export const en = {
  title: 'Community Plugins',
  sidebarAction: 'Plugin catalog',
  description: 'Browse plugins from the DeepSeek Harness community.',
  close: 'Close community plugins',
  search: 'Search',
  searchPlaceholder: 'Search plugins, authors, or capabilities',
  all: 'All',
  sort: 'Sort',
  stars: 'Stars',
  npm: 'npm chart',
  installs: 'Installs',
  newest: 'Published',
  active: 'Recently active',
  results: 'plugins',
  starsCount: '{count} stars',
  installsCount: '{count} installs',
  addedDate: 'Added {date}',
  loading: 'Loading plugins…',
  retry: 'Retry',
  empty: 'No plugins match this search.',
  previous: 'Previous page',
  next: 'Next page',
  page: 'Page {page} of {total}',
  install: 'Install',
  installHint: 'The Host shows the package version and source before installation starts.',
} satisfies Record<PluginCatalogKey, string>
