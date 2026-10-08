---
description: "用于浏览和安装社区插件包的独立可选 bundle。"
kind: "package-bundle"
---

# dsh-community-plugin-catalog

[English](README.md) | 中文

## 概述

此可选 bundle 会在 Web 或 Desktop UI profile 中添加社区插件目录。它不会被默认选择。目录及其 Host Remote 由一个包提供；「安装」会把选中的包规格交给官方 Plugin Manager 弹窗，由该弹窗处理确认与安装。安装完成的包会保持停用，直到所有者启用。

可通过 Plugin Manager 安装，或运行 `dsh plugin --profile <name> add @deepseek-ai/dsh-community-plugin-catalog`。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

当 Web 或 Desktop UI profile 的用户需要浏览社区插件时，将此 bundle 加入 profile；两种界面加载同一套 Web Client。没有 Web Client 运行时的 profile（如 `headless`、`acp`）不会加载此 bundle。

此 bundle 的 Host Remote 读取公开的 DeepSeek Harness 插件目录。它把搜索、分类、排序、分页与数量上限过滤条件传给站点 API，并返回当前列表与分类元数据。安装文本属于不可信数据：Host 将其规范化为单个受支持的 npm 或 GitHub 包 spec，过滤不支持的值，并要求 GitHub 目标与列表展示的仓库一致。Client 将规范化 spec 交给官方 Plugin Manager，其对话框要求用户确认。

目录采用紧凑的弹窗排版和响应式列表行；宿主页面字体大小不会决定视图中能显示多少条结果。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `endpoint` | `https://deepseek1024.com/api/v2/plugins` | HTTPS 目录 API 地址 |
| `timeoutMs` | `15000` | 单次请求时限，1000 至 60000 毫秒 |
| `maxResponseBytes` | `2097152` | 目录响应体上限，1024 至 8388608 字节 |

<a id="understand-the-implementation"></a>
## 实现说明

Patch 只插入一个 bundle 行。包内包含 Host 目录 Remote 和动态 Web Client。Remote 仅接受位于 `github.com` 的 HTTPS 列表链接，为每行校验单个安装目标、将 GitHub 目标与展示仓库核对，并在解析 JSON 前按配置的字节上限读取响应。Client 使用规范化 spec 打开官方 Plugin Manager 对话框；确认、构建脚本授权、取消、兼容性检查和安装都由该弹窗处理。安装成功后，新包仍保持停用，直到 profile 所有者启用它。

<a id="further-exploration"></a>
## 进一步阅读

- [Plugin Manager](../../boot/plugin-manager/README.zh.md) — 包安装与 profile 生命周期。
- [SkillsMP GitHub 安装说明](../../../.agents/notes/implemented/architecture/2026-10-08-skillsmp-github-immutable-installation.zh.md)记录了相邻技能目录如何固定并校验技能内容。

<a id="dev-note"></a>
### 开发备注

无。

<a id="model-experience"></a>
## 模型体验

### 仅供浏览器使用的目录

#### 模型可见内容

此 bundle 不修改模型可见的指令、工具 schema 或 `Agent` 的 `Session` 内容。

#### Token 影响

无；目录只运行在浏览器中。

#### KV Cache 影响

无；此 bundle 不更改模型请求上下文。

## 已知限制与暂缓工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

<a id="known-limitations-and-deferred-work"></a>

- 此 bundle 需要 Web 或 Desktop UI profile，并要求能够访问社区目录 API；没有 Web Client 运行时的 profile（如 `headless`、`acp`）无法加载它。
- 目录检查和安装流程不会审查包源码或安装脚本。
