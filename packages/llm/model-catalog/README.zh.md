---
description: "安装此 bundle 后在启动时刷新的 models.dev canonical 模型元数据。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-model-catalog

[English](README.md) | 中文

## 概述

此 profile bundle 将公开 models.dev 目录中的 canonical 模型元数据提供给 `dsh-llm`。仅在需要刷新此目录的 profile 中显式安装。Host 会在启动时及配置的间隔通过网络刷新目录元数据。它不增加模型选项或选择器；路由与传输行为仍由适配器负责。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和待处理工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 安装到 profile

此可选包需与 `dsh` 应用分开安装。以下命令会从已配置的包 registry 安装或移除此 profile 中的包。

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-model-catalog
dsh plugin --profile <name> remove @deepseek-ai/dsh-model-catalog
```

### 安装内容

patch 会在 profile 已有的 `dsh-llm` 和 `dsh-storage-domain` 行旁插入 `model-catalog` 行。此 bundle 提供元数据解析，不会添加模型选项、选择器或传输支持。

本包将 `dsh-llm` 与 `dsh-storage-domain` 声明为 peer。`dsh` profile 会从所选 Bundle 的依赖图解析这些共享服务，确保使用安装中的同一服务实例。请通过 `dsh` 加载插件；在隔离包目录中直接使用原生 Node import 会绕过 profile resolver，因此不受支持。

插件会持久化有大小限制且记录来源 URL 的上游快照，在 `refreshIntervalMs` 后刷新；刷新失败时保留最近一次成功的事实。更换 `catalogURL` 会立即触发刷新，即使旧来源的快照尚未达到刷新间隔；旧事实仍可作为 last-good 数据使用，但不会被视为新来源的 fresh 数据。请求失败不会更新缓存 URL 或时间戳。文档格式错误或没有有效 canonical 记录的响应不会替换该快照。`catalogURL`、`requestTimeoutMs` 和 `maxResponseBytes` 分别配置目录来源与资源上限。路由使用别名时，可通过 `modelMappings` 显式将本地模型 ID（可选附带 `ownedBy`）映射到 `zhipuai/glm-5.3-flash` 这样的 qualified canonical ID；大小写不敏感的重复映射身份会在插件激活时被拒绝。

解析顺序为配置的 `modelMappings`、不区分大小写的 qualified canonical ID、以及唯一的非限定 basename。basename 有歧义时不返回目录元数据；不同提供方的声明绝不合并。输入模态和 token 上限来自 canonical 模型记录，因此第三方渠道使用相同的 canonical 值，不会被渠道自身较小的上限压低。canonical 字段缺失时保持未知。只有明确选定的 canonical namespace 才能提供提供方特有的推理等级；`reasoning: false` 和明确为空的 effort 声明会拒绝所有标准等级，缺失的 effort 元数据则保持未知。单独的 `reasoning: true` 不表示支持所有等级。

解析、缓存和元数据解析会保留有效的源推理等级 ID，包括提供方自定义 ID。runtime 不会把这些声明当作可执行选项。每个适配器只公开其配置的 provider route 能编码的等级；pi-ai 接受标准六档，DeepSeek Messages 适配器接受 `low`、`high` 和 `max`。其他已声明 ID 在适配器实现并验证对应 wire 行为之前仍不可用。目录还会提供适配器支持的输入模态和容量。适配器 profile 中显式配置的事实优先。元数据不会触发静默降级。传输能力由适配器负责，models.dev 本身无法证明。

<a id="understand-the-implementation"></a>
## 理解实现

插件会在有大小限制的快照中保存 canonical 模型记录和按 namespace 区分的推理等级。pi-ai 适配器仅在 profile 未提供字段时使用目录数据。显式映射让本地别名可解析，但不会把路由名或 gateway 当作上游身份。

<a id="further-exploration"></a>
## 延伸阅读

- [LLM 能力包组](../README.zh.md)——共享模型调用服务与提供方适配器。
- [LLM 包](../llm/README.zh.md)——路由解析与请求准备。

<a id="model-experience"></a>
## Model Experience

间接影响：适配器会在准备请求前解析精确模型目录元数据。

#### KV Cache effect

插件不添加 prompt 文本。刷新的上下文容量或推理元数据可能改变后续请求限制或提供方选项；现有压缩与提供方层负责其复用影响。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和待处理工作

本包没有可独立观察且可能发生分歧的运行时关系，因此不发布运行时不变量伴随模块。

- **目录元数据仅供参考** — 它不是传输探测；缺失或冲突的事实保持未知，不作猜测。
- **刷新可能滞后** — 刷新失败会保留最近一次成功数据并记录警告，不会禁用已有元数据或阻止插件挂载。
- **缓存格式升级需要刷新 canonical 目录** — 旧的按提供方分类快照不再用于模型解析；如果 canonical 刷新失败，解析器会暂不提供旧格式元数据，直到成功刷新并保存 canonical 快照。

<a id="dev-note"></a>
### 开发备注

运行 `pnpm --filter @deepseek-ai/dsh-model-catalog run test:packed-artifact`，会打包并解开本包，再通过 profile runtime resolver 导入。Smoke 会检查 `dsh-storage-domain` 来自所选 Bundle 的依赖图，而非包自己的副本。
