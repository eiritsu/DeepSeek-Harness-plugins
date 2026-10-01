# Agent Note: Tools and connections providers as an optional bundle

Status: implemented

[English](2026-09-28-tools-connections-bundle.md) | 中文

## Problem

rc2 Web service 尚无 Brave 或 Tavily 提供方，而旧 UI 代码不符合当前 credentials、settings 和 provider selection API。

## Decision

`@deepseek-ai/dsh-tools-connections` 通过 `ctx.web` 分别注册 Brave 和 Tavily，通过 Plugins 设置槽提供 Client 卡片，并通过 `ctx.remote.credentials` 存储 Key。卡片配置各个提供方；原生提供方选择仍由显式的 `web.searchProvider` profile 设置决定，因为现有设置表单 API 不写入该非 volatile 字段。每个提供方在调用时读取自己的启用设置、接口地址和凭据引用。此 bundle 不添加厂商专用 model tools，也不修改 core 或默认 profile entries。

GitHub Code Search 和 Firecrawl extraction 保留为现有可选包。Exa 和 Perplexity 保留为现有 `ctx.web` providers。用户通过 Plugin Manager 安装和配置各个包；此 bundle 不推断它们的连接状态。

## Alternatives considered

**添加一个隐式路由器，选择第一个已配置的提供方。** 拒绝，因为 `dsh-web` 在多个提供方可用时要求显式选择，也不承诺按优先级 fallback。

**添加 Brave 和 Tavily model tools。** 拒绝，因为 `dsh-tool-web` 已负责原生 `web_search` 工具，两个提供方均实现其现有 service interface。

**重做 GitHub 或 Firecrawl 控制。** 拒绝，因为 rc2 已提供这两项能力的独立包。

## Consequences

用户在 profile 配置中显式选择 Brave 或 Tavily 作为 `web` 搜索提供方，并在此 bundle 设置中启用它。Key 不会写入设置文档。停用或卸载 bundle 会保留设置和凭据记录；若 `web.searchProvider` 指向未挂载的提供方，则遵循现有 configured-provider error 行为。

bundle 不增加 provider health check、连接探测或 fallback 路由。其他提供方设置和 MCP server 生命周期仍由各自现有包负责。
