---
description: "用于在 Web 或 Desktop profile 中搜索 SkillsMP、预览技能并安装所选提交的可选组合包。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-community-skill-catalog

[English](README.md) | 中文

## 概述

此可选组合包会在 Web 和 Desktop UI profile 中添加 SkillsMP 技能目录。搜索需要任务关键词；用户可以筛选和预览结果，然后安装所选提交。目录不会运行技能文件，已安装技能仍可在插件页面管理。

## 目录

- [使用本包](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当用户需要查找 SkillsMP 技能、预览内容并安装所选技能时，可在 Web 或 Desktop UI profile 中安装此组合包。可通过官方 Plugin Manager 添加或移除，也可运行 `dsh plugin --profile <name> add @deepseek-ai/dsh-community-skill-catalog` 和对应的 `remove` 命令。此可选组合包不属于任何已发布 profile。

侧栏目录搜索非空任务关键词，并支持本地化分类、职业、内容语言和排序筛选。职业字段展开一个锚定在字段上的菜单，按大类 → 职业组 → 职业逐级下钻，也可按名称搜索整个目录；选定后字段显示该职业的本地化路径，筛选提交的仍是它的 slug。taxonomy可手动刷新。每项结果会显示作者、内容语言、GitHub Stars 和更新时间。Stars 表示 GitHub 热度，不衡量技能质量。

### SkillsMP 凭据

匿名搜索受 SkillsMP 公布的请求限制约束。如需使用 API Key，请将 `skillsmpCredentialKey` 设为 DSH Credentials 引用；该密钥只用于 SkillsMP 搜索。SkillsMP 来源清单和 GitHub 托管的 raw 技能文件不会使用此密钥。

### Host 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `skillsmpCredentialKey` | 空 | 可选的 DSH Credentials 引用，指向 SkillsMP API Key |
| `timeoutMs` | `15000` | 单个 HTTP 请求的时限，单位为毫秒 |
| `operationTimeoutMs` | `120000` | 详情与安装操作的总时限，单位为毫秒 |
| `maxResponseBytes` | `1048576` | JSON 响应上限 |
| `maxFileBytes` | `512000` | 单个安装文件的上限；manifest 协议最多允许 512000 字节 |
| `maxFiles` | `100` | 单份 manifest 的文件数上限 |
| `maxTotalBytes` | `5242880` | 安装文件总大小上限 |
| `cacheTtlMs` | `300000` | 搜索结果缓存时长，单位为毫秒 |
| `maxCacheEntries` | `100` | Host 保留的近期搜索页、来源身份和已审阅 manifest 上限 |
| `metadataCacheTtlMs` | `3600000` | taxonomy 缓存时长，单位为毫秒 |
| `maxTaxonomyEntries` | `2048` | taxonomy 接受的分类和职业总数上限 |
| `skillRoot` | `<DSH_HOME>/skills` | 已安装技能的目录 |

分类和职业筛选使用 SkillsMP 本地化文档、职业页标签和叶子组元数据。职业菜单按来源 SOC code 排列每一级，并列出全部叶子职业，包括 SkillsMP 报告为 0 个 skill 的职业；内部 taxonomy 节点用于搜索，但不会作为重复选项显示。已下钻分组的表头可以直接提交整个分组，而不是其中的职业。Host 会在缓存前校验父级链接和叶子覆盖范围；手动刷新会绕过配置的缓存，默认缓存时长为一小时。taxonomy 请求不会发送 SkillsMP 搜索 API Key。搜索页结果按 `cacheTtlMs` 过期；来源身份和已审阅 manifest 保留在有界 Host LRU 中，直到被淘汰或 Host dispose。

详情页会链接到 SkillsMP 来源页和 GitHub 仓库，并显示来源清单中的文件、commit SHA，以及纯文本形式的 `SKILL.md`。确认安装时会显示技能名、提交、文件数和全局 DSH 技能目录。**插件 → 技能**页面会列出包含 `SKILL.md` 的已安装目录；移除前必须确认，随后会永久删除所选技能目录。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现细节 — 点击展开</summary>

组合包 patch 会插入提供 `skillsMpCatalog` Remote 的 Host 插件，以及用于 Web UI 的动态 Client 插件。Remote 会搜索 SkillsMP，并通过 SkillsMP 来源清单解析所选技能；安装请求会携带清单中的 commit SHA。相同 Remote 会列出并移除全局技能目录中的目录。

| 文件 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 插入可选 Host 插件 |
| [`src/index.ts`](src/index.ts) | 注册 Host 插件 |
| [`src/client/index.ts`](src/client/index.ts) | 挂载 Remote 并注册 UI slots |
| [`src/client/SkillCatalogPanel.tsx`](src/client/SkillCatalogPanel.tsx) | 搜索、查看详情并确认安装 |
| [`src/client/InstalledSkillsPage.tsx`](src/client/InstalledSkillsPage.tsx) | 列出并移除全局已安装技能 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

参见[组合包索引](../README.zh.md)，了解其他可安装的 profile 组合层。

参见 [SkillsMP GitHub 安装说明](../../../.agents/notes/implemented/architecture/2026-10-08-skillsmp-github-immutable-installation.zh.md)，了解安装、源码校验和 HTTPS 出站策略。

-----

<a id="model-experience"></a>
## 模型体验

无，因为技能目录仅属于 Client UI，不增加 Agent 输入、工具或 Session 内容。

#### KV Cache 影响

不会改变模型请求上下文。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- 组合包需要 Web 或 Desktop UI profile，并且可以访问 SkillsMP 和 GitHub。搜索只使用 SkillsMP，没有 SkillHub 或本地目录搜索回退。
- Host 只会向 SkillsMP 和 GitHub raw content 发送 HTTPS 请求，并拒绝所有 redirect。可选 SkillsMP API Key 仅用于搜索。直连请求会固定 DNS 解析结果，并拒绝非公网地址；仅为支持 TUN DNS，这些 origin 可接受 `198.18.0.0/15`。使用配置的 proxy 时，Host 不会在本地解析 origin。
- 匿名 SkillsMP 搜索受服务商公布的速率限制约束。提交非空关键词后才会搜索。
- Host 会拒绝不完整的 SkillsMP 来源清单，也无法安装来源清单限制所省略的文件。
- SkillsMP 网页下载 endpoint 没有长期稳定性保证。如果响应格式变化，来源检查和安装会 fail closed；组合包没有 GitHub API 或其他来源回退。
- Stars 是服务商提供的元数据，不代表技能质量或安全性评估。
- 已安装的 SkillHub 技能目录会保留在全局技能根目录中，并可继续管理；切换目录不会迁移、重新安装或更改其文件。
- `skillRoot` 控制安装、列表和移除。如果自定义根目录位于官方技能文件系统默认根目录之外，请在 `skill-filesystem.customSkillDirs` 中配置相同路径，以便 Agent 发现并加载已安装技能。目录仍会显示在目录管理页面，但不会因此自动提供给 Agent。
- 已安装技能管理器只覆盖配置的全局 DSH 技能根目录，不管理项目技能或 Agent 技能。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
