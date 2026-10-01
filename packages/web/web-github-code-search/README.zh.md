---
description: "可选的 GitHub 代码搜索工具，通过标准 tools 与 credentials 服务返回受限的精选结果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-github-code-search

[English](README.md) | 中文

## 概述

`dsh-web-github-code-search` 注册可选模型工具 `github_code_search`。它查询 GitHub 代码搜索 API，并返回精选的仓库、路径、URL 和代码片段字段。它不替换 `ctx.web` 搜索、不管理仓库，也不接收 webhook。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [行为](#behavior)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

仅在需要 GitHub 代码搜索的组合中挂载此 Host 插件。组合必须提供 `ctx.tools` 与 `ctx.credentials`；当需要强制执行 `requestTimeoutMs` 时，还要挂载 timeout policy。此包不会包含在随产品发布的默认 profile 中。

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-credentials'
- name: '@deepseek-ai/dsh-credentials-local'
- name: '@deepseek-ai/dsh-tool-call-timeout-policy'
- name: '@deepseek-ai/dsh-web-github-code-search'
```

通过现有 Credentials 设置页或凭据提供方配置 `GITHUB_TOKEN`。插件在每次工具调用时解析此引用，因此凭据轮换无需重启插件。插件配置只保存引用名称。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiKeyRef` | `GITHUB_TOKEN` | 每次搜索时解析的凭据引用 |
| `baseURL` | `https://api.github.com/` | HTTPS REST API 基址；GitHub Enterprise Server 可配置以 `/api/v3/` 结尾的基址 |
| `requestTimeoutMs` | `30000` | 工具调用期限，并通过 abort signal 传递给 `fetch` |
| `maxResponseBytes` | `2097152` | JSON 解析前读取的最大响应字节数 |
| `maxSnippets` | `20` | 单次工具结果最多返回的文本匹配片段数 |
| `maxSnippetChars` | `2000` | 单个片段最多保留的 Unicode 码点数 |
| `maxTotalSnippetChars` | `8000` | 所有片段总共最多保留的 Unicode 码点数 |
| `maxResults` | `5` | 默认结果数，单次请求最多 100 条 |

Host Config 声明见 [`src/index.ts`](src/index.ts)。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——点击展开</summary>

插件将 GitHub 代码搜索响应转换为精简 JSON 结果，并把工具调用记录交给 `ctx.tools`。它在工具执行时解析凭据，并在解析前按字节上限读取响应。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis 入口、请求验证、GitHub API 调用和响应投影 |

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Tools 子系统](../../../docs/subsystems/tools.zh.md)——工具注册、执行与 Session 事件。
- [Credentials 包](../../credentials/credentials/README.zh.md)——凭据引用与提供方。
- [Timeout policy 包](../../guard/timeout-policy/README.zh.md)——执行工具声明的超时时间。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-web-github-code-search)——模型可见 schema。

<a id="behavior"></a>
## 行为

工具使用查询和 `per_page` 发送 `GET search/code`，并携带 GitHub text-match accept header、API 版本 `2022-11-28` 和配置的 bearer token。请求遇到重定向时会失败，不会转发凭据。响应读取器在解析 JSON 前强制执行字节上限；只返回名称、路径、文件 URL、仓库名称/URL 和可用的文本匹配片段。HTTP 错误不包含上游响应正文。`requestTimeoutMs` 只是声明值，只有组合挂载 `dsh-tool-call-timeout-policy` 后才会强制执行。

工具会拒绝空查询以及不在 1–100 范围内的结果数量。凭据缺失、请求失败、状态码失败、响应过大、UTF-8 无效或 JSON 无效都会作为工具错误返回。请求取消会传递到 HTTP 请求和响应读取器。`maxResponseBytes` 限制上游响应正文；三个片段设置则分别限制进入模型输出的匹配代码量，计量单位为 Unicode 码点。代码和片段都是不可信数据，不得视为指令。

<a id="model-experience"></a>
## 模型体验

### `github_code_search`

#### What the model sees

模型会看到必填的 `query` 和可选的 1 到 100 之间的 `maxResults`。结果包含 `totalCount` 和经过筛选的 `results`；每项结果可能包含代码匹配片段。完整调用和结果由标准 `tool/call` 与 `tool/result` session 事件记录。请参阅生成的 [工具 schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-web-github-code-search)。

#### Token effect

挂载插件会将它的 schema 加入包含此工具的请求。调用会把查询和筛选后的响应字段加入 session 历史；返回片段分别受 `maxSnippets`、`maxSnippetChars` 和 `maxTotalSnippetChars` 限制。

#### KV Cache effect

只要插件配置与工具描述不变，schema 就保持稳定。搜索调用会在可复用的请求前缀后追加参数与结果。

## 已知限制与后续工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

<a id="known-limitations-and-deferred-work"></a>

- 结果取决于 GitHub 代码搜索索引，以及配置令牌的访问权限。
- 此工具只搜索代码；不会检查 issue、pull request、commit 或本地仓库。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`tests/github-code-search.spec.ts` 使用本地凭据提供方挂载插件，并 stub GitHub API 响应，因此测试不需要令牌或外部网络。本地 loopback HTTP 夹具会验证原生 fetch 在联系重定向目标前拒绝重定向。测试还覆盖凭据轮换、结果投影、取消、响应限制和注销。

</details>
