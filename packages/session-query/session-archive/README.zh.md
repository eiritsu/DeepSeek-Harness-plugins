---
description: "以 provider-neutral 方式导出和恢复完整持久 Session 及其引用的附件。"
kind: "package-bundle"
---

# session-archive

[English](README.md) | 中文

## 概述

`session-archive` 通过公开的持久化和附件服务导出、恢复完整 Session。V1 包含当前 V4 JSONL、SHA-256 清单和引用附件；恢复会在写入前校验，保留 ID 并拒绝冲突。本包还提供显式离线转换函数，接受冻结 Desktop schema-2、Session-v3 SQLite 备份和显式附件根，生成同一归档且不写入目标 provider。归档保存逻辑数据而非 SQLite 副本，不包含插件或 Skill 设置、凭据或密钥。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 安装

这是独立的可选 bundle。通过 Plugin Manager 或 `dsh plugin --profile <name> add @deepseek-ai/dsh-session-archive` 安装到 profile，再从该 profile 的 Plugins 页面启用或停用。bundle patch 会在此 bundle 的 Plugins 详情页挂载 Session 归档控件，并注册经过身份验证的 `/api/session.archive`、`/api/session.archive/sqlite-backups` 和 `/api/session.archive/sqlite-import` 路由。

### 传输限制

| 配置 | 默认值 | 含义 |
|---|---:|---|
| `compressionLevel` | `6` | ZIP 压缩等级，范围 0 到 9 |
| `maxArchiveBytes` | `256 MiB` | 导入或导出压缩归档的最大大小 |
| `maxExpandedBytes` | `1 GiB` | 导入后所有条目总大小上限 |
| `maxSessionLogBytes` | `128 MiB` | 单个 Session 日志大小上限 |
| `maxImageAttachmentBytes` | `16 MiB` | 导入或导出的单个图片附件大小上限 |
| `maxSourceBytes` | `1 GiB` | 离线转换接受的 SQLite 源文件大小上限 |
| `maxSessionCount` | `10,000` | 离线转换接受的 Session 数量上限 |
| `maxEventCount` | `1,000,000` | 离线转换接受的事件行数上限 |
| `maxInputJsonBytes` | `256 MiB` | 离线转换接受的 header 与事件 JSON 文本合计上限 |

### 离线 SQLite 转换

显式转换器除归档字节上限外，还限制源文件大小和行数。

| 上限 | 默认值 |
|---|---:|
| `maxSourceBytes` | `1 GiB` |
| `maxSessionCount` | `10,000` |
| `maxEventCount` | `1,000,000` |
| `maxInputJsonBytes` | `256 MiB` |
| `maxExpandedBytes` | `1 GiB` |
| `maxArchiveBytes` | `256 MiB` |
| `maxSessionLogBytes` | `128 MiB` |
| `maxImageAttachmentBytes` | `16 MiB` |

转换器会在保留行记录前检查 Session 与事件行数，以及 header 和事件 JSON 文本合计的 UTF-8 字节数；事件行使用迭代读取，并拒绝存在 WAL 或 SHM sidecar 的 SQLite 文件。`maxInputJsonBytes` 限制存储的 JSON 文本，与输出展开大小上限分别计算；它不承诺精确限制解码对象占用的内存。每次调用都可以通过 `SqliteBackupArchiveLimits` 覆盖这些上限。

此 bundle 的 Plugins 详情页还提供显式旧版 Desktop 导入：选择备份所在目录、一个普通 `.sqlite` 文件，再选择对应附件根目录。导入器会读取私有副本，保持所选数据库及其 `-wal`、`-shm` sidecar 不变；不会执行 checkpoint 或删除 sidecar。仅接受冻结的 schema-2 备份及 Session-v3 header，并且只转换能够安全续跑的历史。格式不支持、存在 WAL/SHM sidecar、附件缺失或无效时，会在写入 Session 前拒绝。转换完成后由常规归档恢复流程逐项报告失败；部分导入仍明确显示为部分结果，可通过归档 journal 重试。

文件附件通过公开的 `saveFileStream` 写入，图片通过 `saveImage` 写入。在写入任何 Session 之前，导入器会验证这些常规保存操作能否精确重建每个归档引用。如果图片规范化或 provider 行为改变了引用，导入会在创建 Session 前停止；已保存的内容寻址对象可能留待 provider 的保留清理机制回收。

### 恢复行为

导入会先预检归档路径、ZIP 结构、清单条目、当前 Session 格式、摘要、附件引用和 Session ID 冲突，再修改存储。随后先保存并验证全部附件，再逐个导入 Session：创建后一次性 append 完整事件批次、flush，并读回核对已验证的规范 Session 内容。包自有 journal 位于 `$DSH_HOME/session-archive/imports`，记录逐项进度，并跨进程串行化同一归档的导入；仅当已有 Session 日志与该内容一致时，重试才会跳过它。不完整的已有 Session 会被拒绝，需通过 provider 级方式人工恢复，因为公开 persistence API 没有归档专用回滚。跨 Session 或跨 provider 均无事务；部分结果会明确报告，不能当作完整导入。

导入请求成功后，bundle 详情页会刷新 Host 权威会话列表，使新恢复的会话无需重开应用即可显示。如果刷新失败，页面会分别报告导入结果并提示重新载入会话列表；无需因此重试归档导入。

目标位置已有相同归档 ID 的 Session 时会拒绝导入，不合并也不覆盖。每次成功导入都通过当前 provider API 创建归档中的逻辑 Session 记录；不会替换 provider 数据库文件，也不会翻译旧私有 schema。

导入后，包会将每个 Session 关联到已注册且规范路径与 Session header `cwd` 一致的 Workspace。Workspace Registry 不会重新扫描新建的 Session header，因此归档 journal 会单独记录关联结果，并在重复导入时重试。没有 `cwd`、目录不存在或目录尚未注册为 Workspace 的 Session 会保持已导入但未归属，并使结果标记为部分成功；导入器不会创建目录或 Workspace。请创建或打开已存在的匹配 Workspace 后重试；没有 `cwd` 的 Session 需手动归属。

<a id="further-exploration"></a>
## 延伸阅读

- [Session 持久化 API](../../session/session-persistence/README.zh.md)
- [本地附件 provider](../../attachment/attachment-local/README.zh.md)
- [Session 归档格式实现](src/archive.ts)
- [可选 profile patch](cordis.patch.yml)

## 已知限制与延期工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

<a id="known-limitations-and-deferred-work"></a>

这些限制描述归档与恢复 provider 的运维约束。

- **不支持跨 provider 事务**——后续失败前已保存的内容寻址对象可能不可达，由 provider 的保留清理机制管理。Session 写入失败不会回滚或盲目重试。
- **必须精确复现引用**——如果目标 provider 将归档图片规范化为不同字节或元数据，导入会在写入任何 Session 前拒绝。
- **配置备份独立处理**——归档仅包含 Session 日志和附件，不包含插件与 Skill 设置、凭据或密钥。
- **离线 SQLite 转换范围有限**——仅接受包含可安全续跑 Session-v3 历史的已关闭 schema-2 备份；存在 WAL/SHM sidecar、其他数据库代际、附件缺失或无效、无法安全续跑的历史都会被拒绝。转换只能通过 Plugins 页面显式操作或库调用触发，不会在启动时自动迁移。

<a id="dev-note"></a>
## 开发备注

定向 Host 测试使用临时 `DSH_HOME` 根目录和本地 JSONL、附件 provider，不访问用户配置的数据目录。
