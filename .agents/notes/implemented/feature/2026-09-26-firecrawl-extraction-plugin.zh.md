# Agent Note: 可选 Firecrawl 提取工具

状态：已实现

English | [中文](2026-09-26-firecrawl-extraction-plugin.md)

## 问题

rc2 的 web capability 可以搜索和获取网页，但有些模型工作流需要提供方转换后的 Markdown 和元数据。

## 决策

`@deepseek-ai/dsh-web-extract-firecrawl` 作为可选 Cordis Host 插件提供 `firecrawl_extract`。它通过 `ctx.credentials` 在每次调用时解析 `FIRECRAWL_API_KEY`，在 JSON 解析前限制 Firecrawl 响应字节数，按配置的码点上限截断 Markdown，并返回 `truncated` 标记。模型可见性和会话持久化由现有工具流程负责；此包不改动 `ctx.web`、core 或默认 profile。

## 考虑过的替代方案

**用 Firecrawl 替换 `web_fetch`。** 不采用，因为部署可能希望同时使用现有 HTTP 获取行为和 Firecrawl 提取 API。

**将 Firecrawl 加到现有搜索提供方包。** 不采用，因为网页抓取提取是独立的模型工具，不实现 `ctx.web` 搜索 provider API。

## 后果

部署通过挂载此包并经 credentials provider 保存引用值来启用功能。请求超时、响应字节上限和 Markdown 字符上限均为组合配置。GitHub 代码搜索由独立的可选 `ctx.tools` 包提供，因为它不是 `ctx.web` 搜索 provider；Brave、Tavily 和 Exa 由 rc2 原生搜索 provider 覆盖。旧 catalog 中的 FAL、ElevenLabs 和 Browserbase 条目此前没有工具实现可迁移。
