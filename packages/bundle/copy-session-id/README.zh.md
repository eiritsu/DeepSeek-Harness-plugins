---
description: "独立可选的 profile 组合包：在会话标题栏工具区添加 Session ID 复制操作。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-copy-session-id

[English](README.md) | 中文

## 概述

此可选包会在 Web profile 的会话标题栏工具区增加按 Session 作用域显示的复制 Session ID 操作。单个 tarball 包含 Loader entry、Client bundle 和 profile patch；它由用户自行安装和启用，不会进入随附 profile 的默认列表。

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

通过 Plugin Manager 或 `dsh plugin --profile <name> add @deepseek-ai/dsh-copy-session-id` 将组合包安装到目标 profile，然后在该 profile 的插件页面中启用或停用。

该操作以复制图标显示在会话标题栏工具区，通过 Host 剪贴板复制当前 Session ID。它需要官方 Web Client 会话标题栏。

<a id="understand-the-implementation"></a>
## 实现说明

Patch 只插入 `ui-copy-session-id` Host 根 entry，指向本包。`dsh.client` manifest 声明浏览器依赖，官方 Client loader 会解析同一包的 `./client` entry。操作直接注册到 `conversation.session.header.utilities`。

<a id="further-exploration"></a>
## 进一步阅读

- [Profile 组合](../../../docs/architecture.zh.md#profiles-and-bundles) — 组合包顺序与 profile 所有权。

<a id="model-experience"></a>
## 模型体验

无，因为该组合包只在浏览器中复制 Session 标识符，不会添加模型上下文。

#### KV Cache 影响

不会添加或更改模型请求上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

- 此组合包需要 Web profile 及其会话标题栏 Client。
- 剪贴板访问仍由 Host 控制；拒绝或不可用时会报告失败。

<a id="dev-note"></a>
### 开发备注

无。
