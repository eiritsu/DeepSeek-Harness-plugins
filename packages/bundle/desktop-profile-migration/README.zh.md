---
description: "为现有 Desktop profile 提供显式选择已安装功能包的可选 profile bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-desktop-profile-migration-bundle

[English](README.md) | 中文

## 概述

此可选 bundle 会在 Settings 页面中为现有 Desktop profile 提供功能包选择。它保留 profile 当前选择，包括当前应用已不再提供的旧选择。它不会迁移旧配置值或凭据。用户必须显式安装并启用此 bundle；它不属于已发布 profile 的默认组成，也不会安装候选功能包。

## 目录

- [使用此 package](#use-this-package)
- [实现方式](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制和待处理工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此 package

通过 Plugin Manager 或 `dsh plugin --profile <name> add @deepseek-ai/dsh-desktop-profile-migration-bundle` 将 `@deepseek-ai/dsh-desktop-profile-migration-bundle` 安装到 Desktop profile，然后在该 profile 的 Plugins 页面启用它。

**Settings > Plugins > Desktop migration** 页面只列出 profile 中已安装的候选 package。选择一部分并确认后，页面会通过官方 Plugin Manager 逐项启用对应 bundle。保留当前选择或关闭页面不会更改 bundle 选择。候选清单仅包含受支持的 Desktop 功能；Firecrawl 需要单独的外部服务凭据，配置备份则是独立维护工具，需要时可通过 Plugin Manager 单独安装。

<a id="understand-the-implementation"></a>
## 实现方式

同一个 tarball 包含迁移 Host Remote、生成的 Typert 描述、Settings Client 和一份 profile patch。该 patch 只插入迁移 bundle，不会自动加入任何业务候选包。Client 逐项应用选择，失败后重新读取已保存的 profile；只有所有选定操作都成功后才写入完成标记。

<a id="further-exploration"></a>
## 延伸阅读

- [Profile composition](../../../docs/architecture.zh.md#profiles-and-bundles)：profile bundle 的安装和选择。

<a id="model-experience"></a>
## Model Experience

没有，因为迁移页面只修改 profile bundle 选择，不添加模型上下文或 Session 内容。

#### KV Cache effect

不会添加或更改模型请求上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和待处理工作

- 必须先将候选功能包安装到 profile；此页面只启用已安装的 bundle。它不会导入配置、凭据或其他 profile 数据。
- 启用操作按顺序执行，不是原子事务。某项失败时，之前已成功的选择会保留，页面会报告当前 profile 状态以便重试。
- Plugin Manager 的结果可能要求重启应用后候选 bundle 才会生效。
- 此页面仅适用于 Desktop profile。

<a id="dev-note"></a>
### 开发备注

此 package 将 Host 与 Client 一起发布，因此 profile 安装不依赖 private split package。
