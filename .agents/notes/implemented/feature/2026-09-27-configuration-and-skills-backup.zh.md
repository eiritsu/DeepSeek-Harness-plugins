# Agent Note: 配置与技能备份

Status: implemented

[English](2026-09-27-configuration-and-skills-backup.md) | 中文

## Problem

用户需要在安装之间迁移 profile 配置和技能文件，同时不能把凭据值或 Session 数据放进可移植文件。此功能不能让自定义备份行为成为默认 profile 或 core runtime 的一部分。

## Decision

可选的 `@deepseek-ai/dsh-configuration-and-skills-backup` bundle 拥有版本化 JSON 归档和本地化 Settings 页面。它通过已加载 schema 和官方 `redactSecrets` helper 快照活动 ConfigEditor 行，记录用户已选 bundle 名称，并且只读取用户明确选择的技能根目录。它会拒绝未知配置字段、不支持的 schema、符号链接、特殊文件、不安全路径、重叠根目录以及超过配置限制的文件。禁用插件的 schema 不会被动态导入；其配置行会标记为不支持。

归档保留凭据引用，但不包含标记为 `secret` 的值。导入时，活动目标 schema 必须与归档包身份匹配。目标中已有的 secret 值会保留。Bundle 选择使用官方 PluginManager 操作，不负责安装 package。如果目标 profile 不存在归档源根 ID，导入需要用户明确映射目标技能目录。

写入前会逐项预览导入结果。用户确认要应用的可导入或冲突项目。每项独立应用，profile-local journal 在每项结果后更新。后续失败不会回滚已成功项目。重复导入可安全识别相同技能文件 hash 和已启用 bundle；被替换的技能文件会在目标文件旁保留先前字节。

## Alternatives considered

- **添加 core 归档或恢复 API：**不采用，因为此功能是可选项，文件系统行为应归自己的 bundle；core 无需拥有自定义备份格式或文件写入。
- **原样复制所有 profile YAML：**不采用，因为 profile 配置可能包含凭据，而禁用插件的 schema 未加载，无法安全解释。
- **动态导入禁用插件以恢复其 schema：**不采用，因为备份操作会执行 profile 尚未启用的代码。
- **声称配置、bundle 和文件之间存在一个事务：**不采用，因为官方编辑器与 Node 文件系统没有共享提交协议；journal 会记录部分结果。

## Consequences

Bundle 不归档 Sessions、附件、账户状态或 secret 值。没有 schema secret 标记的字段无法识别为凭据。目标插件缺失和未知 schema 会作为不支持项目显示，而不是静默跳过。导入可能只恢复 profile 的一部分；journal 用于检查和重试，不提供全局回滚。

## Verification

归档测试覆盖路径遍历、重复路径、文件与目录冲突、内容 hash、归档与展开大小限制、schema secret redaction、未知字段、符号链接根、原子文件替换、部分导入、journal 结果、重试以及 profile home 为符号链接时的拒绝。
