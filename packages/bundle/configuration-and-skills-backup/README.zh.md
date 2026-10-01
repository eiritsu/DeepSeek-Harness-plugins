---
description: "独立 profile bundle，可导出活动插件的非敏感配置、已选 bundle 名称和用户明确选择的物理技能目录，供恢复 profile 使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-configuration-and-skills-backup

[English](README.md) | 中文

## 概述

此可选 bundle 可导出活动插件的配置（不含凭据值）、已选 bundle 名称和用户明确选择的物理技能目录。可通过 Plugin Manager 或 `dsh plugin` 安装到 profile；它不属于随产品提供的 profile 默认项。导入会先预览冲突，再逐项应用用户确认的内容，并记录可重试 journal。归档不包含 Session 数据。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 安装到 profile

通过 Plugin Manager 或 `dsh plugin --profile <name> add @deepseek-ai/dsh-configuration-and-skills-backup` 安装，再启用此 bundle。不再需要时，可在同一 profile 中停用或移除。

### 提供的能力

此 bundle 的 Plugins 详情页可导出活动插件的非敏感配置、当前已选 bundle 名称，以及导出表单中明确选择的技能根目录。导入预览会逐项显示配置、bundle 和技能文件为可导入、已一致、冲突、目标缺失或不支持。已一致和不支持的项目收在默认折叠分组中；不支持项仍可展开查看。用户选择要应用的可导入或冲突项，并将归档技能根映射到本机物理目录。

导入逐项执行。单项失败不会撤销其他成功项；结果 journal 记录各项状态，可重试同一归档。替换技能文件时，旧文件会以 `.previous` 后缀保留在旁边。用户确认导入项之前，不会更改配置、bundle 选择或技能目标目录。

### 转换旧配置备份

转换器另外只迁移 `ui-settings.enabled` 和经当前 schema 验证的 `ui-settings-account` 七个 onboarding 字段；account 联系设置与未知字段会保留待审。

仓库还提供离线转换工具，输入由用户明确选择的旧版 `cordis.patch.yml`、`settings.yaml` 副本及可选凭据 YAML。请在源码 checkout 中运行；工具不会扫描 `~/.dsh`、写入 profile、安装 package 或应用凭据：

```sh
pnpm --filter @deepseek-ai/dsh-configuration-and-skills-backup migrate:legacy-config -- --patch /path/to/copy/cordis.patch.yml --settings /path/to/copy/settings.yaml --credentials /path/to/copy/credentials.yaml --output-dir /tmp/dsh-migration-output
```

输出目录必须尚不存在。通过此 bundle 的 Plugins 详情页导入该目录中的 `dsh-configuration-and-skills-backup-v1.json`，并查看 `migration-report.json` 中暂缓处理的字段。转换器会迁移当前 `llm-pi-ai` 路由字段（`apiKeyEnv`、显示名、协议、base URL、模型列表／覆盖项和受支持的路由默认值）及模型 id 与能力字段；`agent-default-model` 会迁移提供方、模型和推理强度；旧 `ui-onboarding.welcomeNoticeVersion` 会迁移到当前通用设置；`subagent-model-selection-settings` 只迁移精确的 `enabled`／`allowedModels` 字段。subagent 归档行使用当前 Config entry 名称 `@deepseek-ai/dsh-tool-subagent/model-selection-settings`，以匹配活动行。若 patch 已有当前 `ui-settings-general` 行，旧 onboarding 别名会保留待审而不会回填。subagent 路由仅接受非空 provider/model 对；开启模型选择但没有有效非空路由列表时会保留待审，不产生不可用配置。headers、兼容性覆盖、重试与传输调优等转换集之外的字段会保留为待审项。只有显式提供、经审阅且能证明当前目标匹配的映射上下文时，权限与 Agent preset 选择才会转换；否则保留为待审项。若生成 `credentials-to-review.yaml`，它与导入归档分离且含敏感值；请私下审阅，并通过官方凭据设置重新录入所需凭据。转换工具不会应用该文件。

同一插件同时出现在两份输入时，以旧 patch 为准；旧 settings 仅补充 patch 中完全不存在的插件。patch 行省略的字段不会从 settings 复活。不支持或无效字段只在报告中列出，不会被复制，因此请保留输入副本供后续审阅。凭据引用名可以保留在转换配置中；凭据值只写入独立私密文件。可选的 `--selection-context FILE` 提供经明确审阅的当前权限表和 preset roster；转换器仍会校验两侧语义是否匹配。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

此包注册经过身份验证的 profile route 和本地化 Plugins 详情页。它使用活动 ConfigEditor 行及已加载 Config schema、官方 secret redactor、Plugin Manager bundle 操作，以及 Node 文件系统对用户明确选择的技能根目录进行读写。patch 插入一个 Host 行；同一 tarball 还包含 Client 页面。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Profile composition](../../../docs/architecture.zh.md#profiles-and-bundles) — bundle 顺序与 profile 所有权。
- [Plugin settings](../../settings/README.zh.md) — schema 配置和 secret 字段。

-----

<a id="model-experience"></a>
## 模型体验

无。此 bundle 不添加模型上下文，也不更改模型请求。

#### KV Cache 影响

不添加或更改模型请求上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 归档只包含活动插件中有内容且可由已加载 Config schema 解释的配置。空配置没有可恢复内容，会被省略。非空配置缺少可用 schema 时会列为不支持；不会动态加载或复制其值。
- schema 标记为 `secret` 的凭据值会被删除，但凭据引用会保留。没有 secret 标记的字段无法被识别为凭据。
- 技能根目录根据活动 skill-filesystem 配置解析，界面不显示绝对路径。用户必须明确选择根目录。符号链接、特殊文件、不安全路径、超限文件和互相重叠的根目录都会被拒绝。
- 只有目标 profile 已安装且可用的 bundle 才能恢复选择。备份不会安装 package。
- 配置、bundle 选择和技能文件之间没有全局原子事务。其他项目成功时，不会因单项失败而回滚。
- 归档不包含 Session、附件数据、账户状态或凭据值。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
