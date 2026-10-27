---
description: "多平台即时通讯集成（飞书、钉钉、企业微信、微信、QQ、Telegram、Discord、WhatsApp）及其设置 Client 页面的可选 profile 层。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-im-integration

[English](README.md) | 中文

## 概述

本插件为 DeepSeek Harness 提供统一的多平台即时通讯（IM）集成能力。你可以将获准用户的私聊或频道消息直接接入持久化的 Harness Session，并在 Plugins 详情页通过多 Tab 标签页管理各平台的连接状态与凭证。

支持的平台包括：
- 飞书 / Lark（长连接与私聊）
- 钉钉 / DingTalk（Stream 模式与 `dws` CLI 工具）
- 企业微信 / WeCom（机器人通信与 `@wecom/cli` 工具）
- 微信 / WeChat（扫码安全授权与消息会话）
- QQ（QQ 开放平台 WebSocket Gateway）
- Telegram（Telegram Bot API Long-Polling）
- Discord（Discord Gateway WebSocket）
- WhatsApp（扫码配对与会话交互）

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

通过 Plugin Manager 或 `dsh plugin --profile <name> add @deepseek-ai/dsh-im-integration` 将组合包安装到目标 profile。在 **Plugins** 页面打开此组合包的详情页，顶部包含各平台的切换标签页。选择对应平台填写应用凭证或扫码授权。

<a id="understand-the-implementation"></a>
## 实现说明

此包包含统一的 IM Ingress Router、各平台适配器与 Client 多 Tab 配置界面。应用密钥均经由 Host 凭据存储管理，不在前端明文暴露。

<a id="further-exploration"></a>
## 进一步阅读

- [Profile 组合](../../../docs/architecture.zh.md#profiles-and-bundles) — 组合包顺序与 profile 所有权。

<a id="model-experience"></a>
## 模型体验

间接通过插入的 IM Host 插件产生影响；该插件负责模型可见的已接受私聊轮次。

#### KV Cache 影响

只有各个 IM Host 插件发起的请求会影响模型上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

- 该组合包需要 Web profile；配置页面属于浏览器 Client 界面。
- 仅响应授权用户消息，防止未授权调用消耗 token。

<a id="dev-note"></a>
### 开发备注

构建 Host 和 Client：`pnpm --filter @deepseek-ai/dsh-im-integration run bundle`。
