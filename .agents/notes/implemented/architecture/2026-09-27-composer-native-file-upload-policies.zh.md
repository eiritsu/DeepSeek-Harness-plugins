# Agent Note: Conversation composer 中的原生文件上传

Status: implemented

[English](2026-09-27-composer-native-file-upload-policies.md) | 中文

## Problem

桌面端文件选择会暴露 native path，因此标准 composer 会把非图片文件作为 `@` 引用，即使已安装的功能插件拥有该格式的解析器。独立发送器会绕过 composer 附件队列及其上传生命周期。

## Decision

`ui-conversation` 向 Client 插件提供附加式 `nativeFileUploadPolicies` 注册表。每项注册接收原始 `File` 并接受或拒绝；任一项接受后，文件就进入现有 composer 附件队列。目录、图片、无路径文件和手动 `@` 输入保持原路径。重复注册 ID 会报错，effect 释放时只移除创建该注册的那项。

DeepSeek-Files 无条件注册 Office 与 PDF 扩展名。只有当前 Host 已接受设置同时包含 endpoint 和 model 时，它才注册音频与视频扩展名。Host 提取和 Client 接收共用扩展名定义。标准文件选择器、拖放、粘贴、附件卡、上传重试、删除和发送仍由 Conversation composer 管理。

此 Client API 是本发行版新增接口，并非未经修改的上游 rc.2 扩展点。独立 Files 包要求应用所用 `ui-conversation` 导出此注册表；它没有独立发送器作为回退。

## Alternatives considered

**会话标题栏发送器：**不采用，因为它另建上传与提交生命周期，而不是把文件加入标准 composer。

**替换 native path 或重写 `@` 处理：**不采用，因为这会丢失路径身份，或在解析器支持格式之外改变官方引用语义。

## Consequences

`ui-conversation` Client API 增加一个通用 opt-in 注册表；应用必须先提供此版本，Files Client 才能把 native path 路由为上传。未支持路径和目录引用继续使用原行为。Settings 改动通过已接受的 ConfigForm snapshot 影响后续文件接收；未保存草稿不会改变路由。
