---
description: "为需要单一权威数据库的 opt-in 部署提供 SQLite Session 持久化。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-sqlite

[English](README.md) | 中文

## 概述

此 provider 将 Session header 和事件行存入一个 SQLite 数据库。每次追加会在同一持久事务中更新事件行与列表元数据。它需要显式启用，不会替换任何已发布 profile 中的 JSONL provider。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Session service 之后挂载此 provider，并指定一个权威数据库路径。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-sqlite'
  config:
    path: /absolute/path/to/sessions.sqlite
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | SQLite 数据库文件；`:memory:` 供测试使用 |

provider 只会在空的、未标记版本的数据库中创建当前 schema。未知布局和未来 schema 版本会被拒绝。Session header 和事件必须使用当前逻辑 Session 格式；未知的必需事件类型会被 fail closed 拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

SQLite 使用 WAL、`synchronous=FULL`、外键、连续事件序号主键和单调递增的 `PRAGMA user_version`。Writer lease 保存在数据库中，避免另一个进程同时追加同一 Session；仅在记录的进程退出后才回收遗留 lease。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Session persistence service](../session-persistence/README.zh.md)
- [JSONL provider](../session-persistence-jsonl/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 恢复的对话历史

#### 模型看到什么

SQLite 不会提供提示文本。恢复生命周期会还原与其他兼容 persistence provider 相同、经过验证的当前格式 `SessionEvent` 事件历史。

#### Token 影响

除了恢复的对话历史和当前请求 envelope，不增加实时请求 token。

#### KV Cache 影响

存储选择不会改变请求前缀。缓存重用取决于重建后的历史、当前 envelope 和所选模型路由。

## 已知限制与延后工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

<a id="known-limitations-and-deferred-work"></a>

- 此 provider 不会迁移现有的非 SQLite 存储，也不会导入 JSONL 文件。
- Writer lease 通过进程 ID 判断存活状态，因此仅适用于同一主机上的进程；数据库应位于本地文件系统。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
