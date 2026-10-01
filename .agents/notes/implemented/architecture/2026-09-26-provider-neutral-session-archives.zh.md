# Agent Note: Provider-neutral Session 归档

Status: implemented

[English](2026-09-26-provider-neutral-session-archives.md) | 中文

## 问题

用户需要在安装之间迁移完整会话历史，不能替换 provider 的数据库文件，也不能依赖 provider 私有目录布局。Session 日志可能引用不可变图片和文件对象，这些附件也必须随日志迁移。

## 决策

可选的 `session-archive` 包会生成版本化 ZIP，其中包含当前 V4 Session JSONL、带字节数和 SHA-256 摘要的清单，以及所有引用附件。它使用公开的 Session 持久化和附件服务，在写入前校验完整归档，保留 Session ID 并拒绝冲突。该包仅通过显式启用的 profile overlay 加载，不包含插件配置或密钥。

导入通过公开的 `saveImage` 和 `saveFileStream` 操作保存附件，并验证生成的不可变引用与归档完全一致后才创建 Session。每个归档指纹使用跨进程 journal 锁；Session 写入彼此独立，不会回滚。后续失败可能留下已验证附件或较早写入的 Session，journal 会记录结果以供重试。

每个 Session 写入后，导入器会按 header 中的规范 `cwd` 查找现有 Workspace，并调用公开的 `attachSession` 操作。Workspace 归属具有独立 journal 结果和重试路径，因为 Registry 不会在导入后重建其已登记的 Session ID。缺少 `cwd`、目录或 Workspace 时，Session 保持未归属；导入器不会创建目录或 Workspace。

导入器依据 ZIP central directory 读取条目，并通过有界流暂存、校验展开大小和 CRC。以 Store 方式保存且自身包含 ZIP 数据的附件仍作为一个外层条目处理。

## 考虑过的替代方案

**复制或替换 v0.1.21 SQLite 文件。** 拒绝，因为该文件不是 rc2 持久化约定的一部分，这样做会绕过 provider API 和 schema 的所有权管理。

**只归档 Session 日志，不包含引用附件。** 拒绝，因为导入后这些日志仍会有无法解析的附件引用，不能称为完整 Session 归档。

**在默认 Web profile 中启用功能。** 拒绝，因为 Session 归档 UI 和路由是可选扩展，不是官方默认行为。

## 影响

目标附件 provider 必须能通过常规保存操作精确复现归档引用。导出流会限制压缩归档、单个 Session 日志和单张图片的大小；导入还会限制展开后的总大小。附件和 Session 导入都不具备原子事务。插件和 Skill 设置需由独立的配置备份功能负责。
