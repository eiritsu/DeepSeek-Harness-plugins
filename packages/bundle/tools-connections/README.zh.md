---
description: "可选的外部工具 bundle：提供 Brave 与 Tavily 搜索提供方和 Firecrawl 抽取，并在 Plugins 设置页提供凭据控制。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tools-connections

[English](README.md) | 中文

## 概述

此可选的外部工具 bundle 将 Brave Search 和 Tavily 加入现有 `ctx.web` 提供方注册表，注册 Firecrawl 的 `firecrawl_extract` 工具，并在 Plugins 设置页添加“工具与连接”卡片。卡片通过凭据服务保存 API Key 并配置搜索提供方与 Firecrawl 抽取。原生搜索提供方仍由 profile 中显式的 `web.searchProvider` 设置决定。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

通过 Plugin Manager 或运行 `dsh plugin --profile <name> add @deepseek-ai/dsh-tools-connections`，将 `@deepseek-ai/dsh-tools-connections` 安装到 Web profile。启用后，在 **Plugins** 中打开它自己的详情页并填写各提供方的 Key。要将其用于原生搜索，请在 Web profile 现有配置中显式设置 `web.searchProvider: brave` 或 `web.searchProvider: tavily`。

此 bundle 依赖现有的 `web`、`credentials`、`tools` 和 Client settings 服务。搜索提供方在停用、接口地址无效或凭据缺失时不可用；只有 `firecrawlEnabled` 为真时才提供 Firecrawl 工具。空白 Key 草稿会保留已存 Key。Firecrawl 设置为 volatile，保存后会更新已注册的工具。卸载 bundle 不会删除设置或凭据。

GitHub Code Search、Exa、Perplexity 和 MCP 使用各自现有的可选插件及设置。请通过 Plugin Manager 安装或配置；此 bundle 不报告它们的连接状态。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `braveEnabled` | `false` | 是否允许 Brave 提供原生网页搜索 |
| `braveApiKeyRef` | `BRAVE_SEARCH_API_KEY` | 存放 Brave API Key 的凭据引用 |
| `braveBaseURL` | `https://api.search.brave.com` | Brave Search API 源 |
| `tavilyEnabled` | `false` | 是否允许 Tavily 提供原生网页搜索 |
| `tavilyApiKeyRef` | `TAVILY_API_KEY` | 存放 Tavily API Key 的凭据引用 |
| `tavilyBaseURL` | `https://api.tavily.com` | Tavily Search API 源 |
| `maxResults` | `5` | 每次调用向提供方请求的来源数，1 至 20 |
| `firecrawlEnabled` | `false` | 是否向模型提供 `firecrawl_extract` |
| `firecrawlApiKeyRef` | `FIRECRAWL_API_KEY` | 存放 Firecrawl API Key 的凭据引用 |
| `firecrawlBaseURL` | `https://api.firecrawl.dev` | Firecrawl 接口基址，会追加 `/v1/scrape` |
| `firecrawlRequestTimeoutMs` | `30000` | 单次 Firecrawl 请求的工具协作时限 |
| `firecrawlMaxResponseBytes` | `2097152` | 解析 JSON 前读取的 Firecrawl 响应字节上限 |
| `firecrawlMaxMarkdownChars` | `50000` | 返回给模型的 Markdown 码点上限 |

<a id="understand-the-implementation"></a>
## 理解实现

Host 以稳定 ID `brave` 和 `tavily` 注册两个独立提供方。两者都将厂商响应转换为 `ctx.web` 结果；现有的 `dsh-tool-web` 负责 `web_search` schema 和结果呈现。同一个 Host entry 注册 `firecrawl_extract` 工具：它在每次调用时解析凭据，解析 JSON 前最多读取 `firecrawlMaxResponseBytes` 字节，并把返回的 Markdown 截断到 `firecrawlMaxMarkdownChars` 个码点。volatile 配置更新会替换工具注册，使接口地址、凭据引用、响应限制和工具超时一起生效。Client 表单使用官方 ConfigForms 和 credentials RPC；设置保存在插件配置中，凭据字面值只发送给凭据服务。

<a id="further-exploration"></a>
## 进一步了解

- [Web service](../../web/web/README.zh.md) — 提供方注册和显式选择规则。
- [Tool catalog](../../../docs/tool-catalog.zh.md) — `firecrawl_extract` 的 schema 与结果。
- [Profile composition](../../../docs/architecture.zh.md#profiles-and-bundles) — bundle 安装与 profile 归属。

<a id="model-experience"></a>
## 模型体验

### 原生网页搜索

#### What the model sees

现有 [`web_search` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-web) 保持不变。其结果包含 `web` 配置中所选提供方返回的标准化可引用来源。

#### Token effect

此 bundle 不增加工具 schema。搜索调用会将查询和提供方结果加入对话。

#### KV Cache effect

提供方设置不会改变请求前缀。提供方选择只改变搜索结果；只要 `dsh-tool-web` 持续以一致方式挂载，既有 schema 保持稳定。

### Firecrawl 抽取

#### What the model sees

当 `firecrawlEnabled` 为真时，模型可以用 URL 和可选的格式选项调用 [`firecrawl_extract`](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tools-connections)。其结果包含抓取到的 Markdown 和 `truncated` 标记，用于说明文档是否被 `firecrawlMaxMarkdownChars` 截断。

#### Token effect

启用该工具会把它的 schema 加入请求前缀。每次调用会把 URL 和返回的 Markdown 加入对话；码点上限约束了其中最大的一次增量。

#### KV Cache effect

该工具的 schema 在调用之间保持稳定，也不随 Firecrawl 接口地址或凭据引用变化，因此修改配置不会让此前的前缀失效。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

此 bundle 不发布运行时 invariant companion，因为没有可独立变化的运行时关系。

- Brave 和 Tavily 仅作为搜索提供方；不会添加厂商专用搜索工具。
- 提供方选择遵循 `dsh-web` 的显式 `searchProvider` 设置。bundle 不添加 fallback 或优先级路由。
- Firecrawl 抽取每次调用只处理一个 URL，不提供站点爬取地图、批量或站点搜索。
- GitHub Code Search、Exa、Perplexity 和 MCP 状态由各自官方包负责。

<a id="dev-note"></a>
### 开发备注

此 bundle 同时包含 Host 和 Client entries。打包前构建两端，并运行包内的 tarball smoke 验证。
