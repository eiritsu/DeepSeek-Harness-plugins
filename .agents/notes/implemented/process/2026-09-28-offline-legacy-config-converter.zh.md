# Agent Note: 旧配置离线转换器

Status: implemented

[English](2026-09-28-offline-legacy-config-converter.md) | 中文

## Problem

旧版 profile 配置中存在无法仅凭字段名安全映射的内容。用户需要一条可审阅的导入路径，且不能扫描或修改正在使用的 profile。

## Decision

转换器另外只迁移 `ui-settings.enabled` 和经当前 schema 验证的 `ui-settings-account` 七个 onboarding 字段；account 联系设置与未知字段会保留待审。

仓库维护的转换器只读取用户明确选择的旧配置文件，并生成可由可选 Configuration and Skills Backup bundle 导入的 v1 归档。它不会扫描 profile、安装 package 或应用转换后的配置。用户通过 bundle 现有的预览和确认流程导入归档。

旧 patch 中出现的 id 优先；settings 仅补充 patch 中不存在的 id。转换器映射当前 pi-ai 提供方路由／模型字段、默认提供方／模型／推理强度选择、旧版欢迎提示确认值，以及精确的 subagent 模型选择字段。当前通用设置 patch 行优先于旧 onboarding 别名。subagent 归档行保留当前 Config entry 的准确名称，包括 `/model-selection-settings` 导出路径。subagent 路由必须是非空 provider/model 对；开启选择却没有路由时会保留待审。显式转换集之外的字段不会进入归档，只会出现在不含值的报告中。只有经明确审阅的当前选择上下文能证明语义匹配时，权限与 preset 选择才会转换。凭据内容仅写入独立的私密复核文件，不进入归档或报告；凭据仍由用户通过官方设置处理。

## Alternatives considered

**直接把旧 YAML 导入 profile。** 拒绝，因为这会绕过当前 schema 验证，并可能恢复已停用或未知插件的配置。

**把同名 preset 视为等价。** 拒绝，因为 preset id 不能证明权限或 agent composition 相同。

**把凭据放入备份归档。** 拒绝，因为归档可携带到其他环境，凭据值必须与之分离。

## Consequences

该工具从 repository checkout 运行，输入为用户明确选择的副本。它不读取 `~/.dsh`，也不写入 profile。未知值只保留在原始输入文件中；报告仅记录 id、字段名和固定原因，不复制字段值。凭据复核文件必须单独私下处理。

## Verification

合成 Node 测试覆盖输入优先级、选择暂缓、归档格式兼容、凭据分离和输出权限。测试不使用真实 profile 或凭据文件。
