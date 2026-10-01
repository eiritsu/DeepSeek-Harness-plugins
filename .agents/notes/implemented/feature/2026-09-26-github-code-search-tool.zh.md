# Agent Note: 可选 GitHub 代码搜索工具

状态：已实现

[English](2026-09-26-github-code-search-tool.md) | 中文

## 问题

旧 external-tools 扩展提供了 GitHub 代码搜索工具，而 rc2 的 GitHub webhook 适配器处理入站事件，`ctx.web` 服务则搜索通用 web provider。

## 决策

`@deepseek-ai/dsh-web-github-code-search` 通过 `ctx.tools` 注册 `github_code_search`，并在每次调用时通过 `ctx.credentials` 解析令牌。它保持可选装载，并返回受限的 GitHub 代码搜索结果投影。此包不向 `ctx.web` 添加 provider、不恢复 external-tools 聚合器，也不提供私有设置页。

## 考虑过的替代方案

**复用 GitHub webhook 支持。** 不采用，因为 webhook 支持接收经过签名验证的入站交付，不会发出经过身份验证的代码搜索请求。

**将 GitHub 注册为 `ctx.web` provider。** 不采用，因为 `ctx.web` 服务通用 web 搜索与抓取；GitHub 代码搜索有独立的面向模型 schema 和结果契约。

**恢复旧 external-tools 包。** 不采用，因为单个可选模型工具不足以证明需要重新引入 provider 目录、设置 UI 和无关 provider。

## 后果

部署只在需要代码搜索的位置挂载此包，并通过现有 credentials provider 管理 `GITHUB_TOKEN`。工具调用与结果使用标准 session 工具事件。搜索可用性取决于 GitHub 索引和令牌访问权限；此包不管理 issue、pull request、commit 或本地仓库。
