---
description: "通过桌面 profile 自己的层，把会话保存在单个 SQLite 数据库中，而不是 JSONL 文件。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-app

[English](README.md) | 中文

## 概述

这个 bundle 是桌面 profile 的第三层补丁，应用于 `dsh-base` 和 `dsh-web-app` 之后。它把会话持久化从所有已发布 profile 都写的 JSONL 文件，改到桌面 home 下的单个 SQLite 数据库，并且是唯一做这件事的一层。没有其它已发布 profile 选中它，因此 web、headless、ACP、SDK 和 minimal profile 继续保留各自的 JSONL 日志。

## 目录

- [理解这个包](#understand-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟的工作](#known-limitations-and-deferred-work)
- [开发者备注](#dev-note)

-----

<a id="understand-this-package"></a>
## 理解这个包

Electron 应用通过 `desktop` profile 模板选中这个 bundle。仍然声明已退役的 `[dsh-base, dsh-web-app]` 元组的桌面 profile，会在应用准备 release 时被改写为当前模板，因此已有安装无需手动编辑即可获得 SQLite 数据库。任何其它 bundle 列表——自定义顺序、第三方 bundle 或不同的元组——都逐字节保持不变。

`dsh` 启动器拒绝 `dsh --profile desktop`：桌面 profile 的 package 工程和生命周期归 Electron 应用所有，而且已发布的 `dsh` CLI 无法解析这个 bundle。请使用 Electron 应用来提供这个 profile。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 —— 点击展开</summary>

这个补丁禁用 base 层的 `session-persistence-jsonl` 行，并在同一层插入 `session-persistence-sqlite`。两个后端都注册 `ctx.sessionPersistence`，所以这两行必须一起改；在别处禁用 JSONL 会让这个 profile 同时有两个提供者或一个都没有。

| 文件 | 作用 |
|---|---|
| [cordis.patch.yml](cordis.patch.yml) | 禁用 JSONL 行并插入 SQLite 行。 |
| [src/index.ts](src/index.ts) | 声明的补丁 bundle 入口。 |

</details>

<a id="further-exploration"></a>
## 进一步探索

- [SQLite 持久化](../../session/session-persistence-sqlite/README.zh.md) —— schema、迁移和查询接口。
- [profile bundle](../../bundle/README.zh.md) —— profile 各层及其归属。

<a id="model-experience"></a>
## 模型体验

没有，因为这个 bundle 改变的是会话记录的存放位置，而不是模型读写的内容。

#### KV 缓存影响

没有。加入或移除这个 bundle 都不会改变任何 prompt 文本、工具定义或消息内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与推迟的工作

没有发布运行时 invariant 配套文件，因为这个包没有可独立观察、可能发生偏离的运行时关系。

- 这个补丁无条件禁用 JSONL 行。把这个 bundle 加入一个已经有其它 `ctx.sessionPersistence` 提供者的 profile，会让该 profile 有两个提供者。
- 已有 JSONL 会话日志不会迁移进 SQLite 数据库；桌面应用改为读取桌面数据库，JSONL 文件留在原地。
- `desktop` 模板无法从 `dsh` CLI 到达，因此携带这个 bundle 的 profile 只能由 Electron 应用提供。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

这个包是公开实验包，而不是 `packages/bundle/` 下的 release 成员，因为 `desktop` 模板选中了它，而被已发布模板选中的 release 成员无法使用可选 bundle 例外。私有 `apps/desktop-host` 包把它声明为运行时依赖，这正是它进入已打包 Electron 闭包的原因。

</details>
