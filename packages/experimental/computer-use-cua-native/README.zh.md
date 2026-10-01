---
description: "通过显式可选层将官方 Cua Driver native computer-use provider 加入 profile。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-computer-use-cua-native

[English](README.md) | 中文

## 概述

此可选层会将官方 computer-use service 和 Cua Driver native provider 加入 Web profile。随附 profile 均不包含它。仅当启动应用已获得所需桌面权限，并且 profile 应向模型开放桌面控制工具时才启用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 安装到 profile

通过官方 Plugin Manager 或 profile 命令添加或移除此组合包：

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-computer-use-cua-native
dsh plugin --profile <name> remove @deepseek-ai/dsh-experimental-computer-use-cua-native
```

Desktop profile 可从 dsh 安装目录获取此组合包。添加后会插入 service 和 provider 行；移除或停用组合包会从 profile composition 中移除这些行。

### 可用能力

官方 `computerUse` service 和 native Cua Driver provider 会公开上游 driver 发现的工具。Provider 负责 native runtime 初始化和桌面操作；此组合包不添加 UI、设置页面或权限授予。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Patch 会先插入 `computer-use` service，再插入 `computer-use-cua-driver-native`。依赖声明让 profile resolution 能找到两条配置行，并将 provider 纳入 Desktop package closure。Provider 本身保持不变，只有启用 profile 行时才初始化 native SDK。

| 文件 | 用途 |
|---|---|
| [cordis.patch.yml](cordis.patch.yml) | 两条可选 Host 行。 |
| [src/index.ts](src/index.ts) | 声明的 patch bundle 入口。 |

</details>

<a id="further-exploration"></a>
## 延伸阅读

- [Native provider](../computer-use-cua-driver-native/README.zh.md)——主机权限、平台限制和模型可见工具。
- [Profile 组合包](../../bundle/README.zh.md)——可选 profile 层及其所有者。

<a id="model-experience"></a>
## 模型体验

间接通过插入的 provider 影响模型；provider 启用时会添加 Cua Driver 发现的工具定义和固定 computer-use 指引。

#### KV Cache 影响

只有 provider 行启用时，其工具目录和指引才会影响模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

- Provider 与 Host 共用进程，并要求启动 dsh 的应用已获得桌面访问权限。
- 包管理器会根据目标平台选择 native optional dependencies；除非执行对应平台的 package smoke，本仓库只验证当前构建主机。
- 添加组合包本身不会请求或授予操作系统权限。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
