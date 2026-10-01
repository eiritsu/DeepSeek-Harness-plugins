---
description: "用支持减少动态效果的 shimmer 替换 Web turn-process renderer 的可选 profile 层。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-turn-process-shimmer

[English](README.md) | 中文

## 概述

此可选层会在 Web 会话中启用运行标签 shimmer。所有 profile family 都需显式选择；用户可通过 Plugin Manager 停用或移除它。Client 插件只替换官方 `turn-process` keyed renderer，并保留展开与无障碍行为。

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

通过 Plugin Manager 或 `dsh plugin --profile <name> add @deepseek-ai/dsh-turn-process-shimmer` 将组合包安装到目标 profile，然后在该 profile 的插件页面中启用或停用。

此组合包在所有 profile family 中都需显式选择。

组合包需要 Web 会话 Client。功能插件遵循减少动态效果偏好，不改变 Host 行为。

<a id="understand-the-implementation"></a>
## 实现说明

Patch 只插入 `ui-turn-process-shimmer` 一行，指向本组合包。tarball 同时包含 Host 入口和由本包 Client 源码构建的 Client 模块；Client 模块通过官方 slot 替换现有 keyed renderer。

<a id="further-exploration"></a>
## 进一步阅读

- [ui-chat](../../client/ui-chat/README.zh.md) — 官方聊天节点呈现。
- [Profile 组合](../../../docs/architecture.zh.md#profiles-and-bundles) — 组合包顺序与 profile 所有权。

<a id="model-experience"></a>
## 模型体验

无，因为该组合包只替换浏览器渲染器，不会添加模型上下文。

#### KV Cache 影响

不会添加或更改模型请求上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

- 此替换需要 Web profile 及其 `turn-process` renderer。
- 此功能只影响 Client 呈现，不修改 Session 或 Agent 状态。

<a id="dev-note"></a>
### 开发备注

无。
