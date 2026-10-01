---
description: "用于在 Web 或 Desktop UI profile 中发现 SkillHub 技能并安装指定版本的可选组合包。"
kind: "package-bundle"
---

# dsh-community-skill-catalog

[English](README.md) | 中文

## 概述

此可选组合包会在 Web 或 Desktop UI 侧栏添加 SkillHub 技能目录。用户可以搜索、筛选、检查文件清单，并明确确认精确版本后安装。它不会默认启用。

可通过 Plugin Manager 安装此组合包，或运行 `dsh plugin --profile <name> add @deepseek-ai/dsh-community-skill-catalog`。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

当 Web 或 Desktop UI profile 用户需要发现和安装 SkillHub 技能时，安装此组合包；两种界面加载同一套 Web Client。没有 Web Client 运行时的 profile（如 `headless`、`acp`）不会加载此组合包。用户可通过官方 Plugin Manager 启用或停用它。

本组合包的 Host Remote 读取 SkillHub 目录，向可选 Client 提供经过校验的列表、详情和固定版本文件清单。安装需要显式确认，下载固定版本 ZIP，校验其元数据与清单中的每个文件，然后把完整目录树提交到配置的技能根目录；官方技能文件系统负责发现已安装技能。

**插件 → 技能**页面会列出全局 DSH 技能根目录中含普通 `SKILL.md` 文件的技能目录。移除前必须勾选确认，随后会永久删除该目录；项目技能、`~/.agents` 下的 Agent 技能、独立 Markdown 文件和内置技能不在此页面管理范围内。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `endpoint` | `https://api.skillhub.cn` | 免凭据的 HTTPS SkillHub API 源 |
| `timeoutMs` | `15000` | 单次请求时限，1000 至 60000 毫秒 |
| `downloadTimeoutMs` | `120000` | ZIP 下载时限，1000 至 2147483647 毫秒 |
| `maxResponseBytes` | `1048576` | 目录或详情 JSON 响应体上限 |
| `maxFiles` | `4096` | 每个发行版的清单文件数上限 |
| `maxArchiveEntries` | `8192` | ZIP 文件与目录条目数上限 |
| `maxArchiveBytes` | `134217728` | 压缩后 ZIP 大小上限 |
| `maxTotalBytes` | `536870912` | 解包后发行版总大小上限，含容器元数据 |
| `maxMetadataBytes` | `1048576` | 解析后的 `_meta.json` 大小上限 |
| `skillRoot` | `<DSH_HOME>/skills` | 官方技能文件系统扫描的目录 |

ZIP 与解包大小是本地资源预算，不是 SkillHub 的格式限制。API 的单文件 1 MiB 限制只作用于文件预览；安装走固定版本 ZIP 下载路由。

<a id="understand-the-implementation"></a>
## 实现说明

Patch 从本包插入一个 Host entry 和一个动态 Client entry。界面会把 SkillHub 的命名空间限定 canonical identity 贯穿详情确认和安装；当 SkillHub 的 slug-only 详情与下载 API 无法唯一解析发布者时，Host 会拒绝操作。安装器会下载固定版本 ZIP，在替换技能目录前校验 release 元数据、归档路径、文件清单、大小、CRC 与 SHA-256。身份校验错误使用稳定类型码，界面会本地化提示并结束详情加载状态。官方技能文件系统仍负责发现和加载技能。插件页贡献只查询和移除配置的全局 DSH 根目录中的普通技能目录，不管理其他根目录。组合包不会安装插件，也不会执行第三方命令。

<a id="dev-note"></a>
## 开发备注

参见 [SkillHub 安装 Agent Note](../../../.agents/notes/implemented/architecture/2026-09-25-skillhub-catalog-installation.zh.md)。

<a id="model-experience"></a>
## 模型体验

组合包不增加 Agent 输入、工具 schema 或 Session 内容。

#### KV Cache 影响

无；模型请求上下文保持不变。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与暂缓工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

- 组合包需要 Web 或 Desktop UI profile 与 SkillHub 网络访问；没有 Web Client 运行时的 profile（如 `headless`、`acp`）无法加载它。
- 压缩归档大小、解压大小、ZIP 条目数和文件数均为可配置的本地资源预算，不是 SkillHub 格式限制。
- 同 slug 的多发布者条目仍会保留在列表中，但 SkillHub 文档规定的详情与下载路由不接收 namespace，因此在 SkillHub 提供无歧义 API 前无法安装这些条目。
- 旧版本按裸 slug 创建且未记录发布者身份的技能目录不会自动迁移或替换。
- 分类候选使用此面板实例收到的结果中已观察到的非空值。来源候选包含“全部”“官方”“社区”以及结果中已观察到的来源；两者都不是 SkillHub 全目录索引。
- 技能页不列出或移除独立 Markdown 技能、项目技能、Agent 技能和内置技能；它只管理配置的全局 DSH 技能根目录中的目录技能。
