---
description: "为 Lark 或飞书私聊 Host 集成及其设置 Client 页面提供的可选 profile 层。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-lark-integration

[English](README.md) | 中文

## 概述

你可以将一位已授权 Lark 或飞书用户的私聊接入持久化 Harness Session，并在此组合包的 Plugins 详情页配置连接。完成配置后才能启用此集成。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

通过 Plugin Manager 或 `dsh plugin --profile <name> add @deepseek-ai/dsh-lark-integration` 将组合包安装到目标 profile。在 **Plugins** 页面打开此组合包的详情页，选择 **快速连接** 注册应用，或选择 **使用已有应用** 填写应用 ID 与只写密钥字段。两种路径都通过官方 device authorization 授权当前用户；Host 从官方 CLI 状态中读取该用户的 Open ID。设置成功后再启用连接。

组合包只接收配置用户的私聊消息。快速连接会为本集成创建带私聊所需权限的应用；使用已有应用不会更改该应用的权限。模型可调用的 CLI 由独立开关控制，默认关闭；只有 Agent 调用 `lark_cli` 时才启动。

<a id="understand-the-implementation"></a>
## 实现说明

Profile patch 插入一个私聊连接和 `lark_cli` 均默认关闭的 `lark` Host 行。此包包含 Host wrapper、私聊实现、官方 Lark CLI launcher 和 Client 入口；只有 Host 配置处于服务状态时，Client 才会在 Plugins 详情页注册配置页面。Typert Loader 会随 Host entry 注册此包的 `./typert` contribution；直接挂载插件时，仅当 Loader 尚未登记该 contribution 才由插件入口注册。应用注册使用官方 channel SDK。用户 device authorization 与身份查询通过 `ctx.subprocess` 调用官方 CLI；应用密钥经 stdin 传递，不放入 argv 或环境变量，device code 保留在 Host 凭据存储中。只有包内精确列出的只读命令不需要审批；其他 CLI 命令请求官方工具审批。连接状态使用 `dsh-lark` 现有的 `larkStatus` Remote；设置操作使用此包独立的 `larkSetup` Remote。

在同一 profile 中只加载此包作为 Lark 集成的 Host owner；不要再加载独立的 `@deepseek-ai/dsh-lark` Host entry，重复 descriptor owner 会明确报错。独立包仍是此组合包所用的实现来源。

首次显式调用 CLI 操作时可能下载上游 CLI binary；随包 launcher 会依据 checksum manifest 验证 SHA-256。加载组合包或打开其 Plugins 页面不会启动 launcher。应用注册截止时间可在高级设置中调整；授权 URL 仅接受官方飞书与 Lark 账号域名。

<a id="further-exploration"></a>
## 进一步阅读

- [Lark Host 插件](src/host/lark/plugin.ts) — 私聊入口与 Session 行为。
- [Profile 组合](../../../docs/architecture.zh.md#profiles-and-bundles) — 组合包顺序与 profile 所有权。

<a id="model-experience"></a>
## 模型体验

间接通过插入的 Lark Host 插件产生影响；该插件负责模型可见的已接受私聊轮次。

#### KV Cache 影响

只有插入的 Lark Host 插件发起的请求会影响模型上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

- 该组合包需要 Web profile；配置页面属于浏览器 Client 界面。
- Host 只接受一位已配置用户的私聊。快速连接会注册一个仅配置本私聊功能权限的应用；用户授权仅覆盖本集成所需的官方 device-code 流程与当前用户身份。
- 不包含权限模板管理；CLI 写命令的逐次审批不等于 Lark 权限管理。
- 不支持群聊、多位授权用户、通用应用 OAuth 或权限管理。使用已有应用不会修改 Lark 开发者控制台中的权限。

| 能力 | 当前覆盖 |
|---|---|
| 私聊 Session 桥接 | 支持一位配置用户。 |
| 官方 Lark CLI | 作为可选 `lark_cli` 工具提供；只读命令走 allowlist，其余命令请求审批。 |
| 快速应用注册与用户 device authorization | 支持本集成私聊所需范围；不包含通用 OAuth 设置和权限管理。 |
| 权限管理 | 未包含；单次 CLI 调用审批不等于 Lark 权限管理。 |

<a id="dev-note"></a>
### 开发备注

打包运行时冒烟测试依赖 Host 和 Client 的 `lib/` 产物。先构建两侧，再从仓库运行 `pnpm --filter @deepseek-ai/dsh-lark-integration run test:packed-artifact`；普通源测试会明确报告此产物测试为 skipped。
