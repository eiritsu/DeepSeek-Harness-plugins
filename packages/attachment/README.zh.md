---
description: "持久附件及可选本地 Office、PDF 文本提取功能的包映射。"
kind: "package-group"
---

# attachment/：持久附件能力族

[English](README.md) | 中文

## 概述

`attachment/` 组提供持久文件与图片附件，以及一个可选的本地 Office 和 PDF 文本提取器。随附的 `dsh` 组合无需设置即可支持图片附件；Office 识别器是选择性启用的 profile layer。已存储的附件会在重启后保留，且不会自动删除。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

附件包提供持久存储；可选识别器会在消息写入日志前读取持久文件引用。

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`attachment/`](attachment/README.zh.md) | 可用于提示词与命令、会持久保存并回到历史中的图片附件 | `ctx.attachments` |
| [`attachment-local/`](attachment-local/README.zh.md) | 把附加图片存储在本机 `DSH_HOME` 下 | 注册到 `ctx.attachments` |
| [`file-recognizer-office/`](file-recognizer-office/README.zh.md) | 为上传的 FileBlock 添加 Office 文档提取和可选扫描 PDF OCR | `agent/pre-step` |

-----

<a id="related-documentation"></a>
## 相关文档

先从子系统参考了解服务约定，再看能力 seam 表与本地后端的配置面。

- [附件子系统参考](../../docs/subsystems/attachment.zh.md)——服务约定、载荷类型与 `ctx.attachments` 的 Cordis 接口面。
- [能力 seam](../../docs/capability-seams.zh.md)——本家族遵循的 Service Definition / Service Provider / Consumer 拆分。
- [生成配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-attachment-local)——本地后端的每个受支持字段。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
