# Agent Note: 提供方无关模型元数据

Status: implemented

[English](2026-09-25-model-metadata-catalog.md) | 中文

## 问题

models.dev 模型元数据需要补充适配器能力，同时避免把本地 provider 路由误认为上游模型身份，也不能声称目录未描述的传输支持。

## 决策

可选的 `dsh-model-catalog` bundle 通过 `dsh-llm` 上 effect-scoped resolver 提供 models.dev 事实。身份使用精确 canonical 模型 ID 和已知上游 owner；缺少 owner 时，可使用精确 provider API endpoint 区分声明。本地路由名称不定义身份。

目录还会对 last-good 内存缓存注册 effect 生命周期内的同步 snapshot resolver。请求计量可无网络 I/O 读取缓存 modalities；禁用或卸载目录会撤销该来源。DeepSeek 将 `maxOutputTokens` 保留为独立于配置请求默认值的模型能力上限：未指定的请求上限受两者约束，显式超限则在 provider I/O 前失败。

适配器 profile 事实优先。pi-ai 适配器将目录中的推理等级应用到 dispatch 使用的精确描述符，并保留声明的 wire 拼写。目录无法证明 endpoint 的传输支持，因此不支持的传输参数仍会产生运行时错误。

存在歧义的记录仅提供相交的显式列表事实和保守容量。缺少输入或推理声明表示未知，不会抹除其他 provider 的显式事实。输入模态只在明确的输入列表之间取交集；受支持模态的空交集保持为空。`reasoning: false` 和明确为空的 effort values 会拒绝所有标准等级；空 `reasoning_options` 列表不构成等级声明。解析、缓存和元数据解析会保留非空的源推理等级 ID，包括提供方自定义 ID。runtime 将这些声明交给适配器处理；适配器只公开其配置路由能执行的 ID。pi-ai 使用 SDK 六档，DeepSeek Messages 使用 `low`、`high` 和 `max`。通用 runtime fallback 见[runtime 元数据说明](2026-09-28-runtime-model-metadata-fallback.zh.md)。持久化快照会记录来源 URL，只有与当前配置 URL 相同的快照才能满足刷新间隔；更换 URL 会强制刷新，若请求失败，旧快照仍保留为 last-good，但不会被标记为新来源的 fresh 数据。缺少来源 URL 的旧快照仍可读取并会触发刷新。客户端只列出确切所选模型支持的 Default 和推理等级；当前元数据中缺失的已保存等级会作为禁用的历史行保留，且不能再次提交。

## 考虑过的替代方案

**根据本地路由名称或部分 endpoint 匹配推断身份。** 这些值无法确定上游模型身份，可能会选中无关声明；因此 resolver 使用精确模型 ID，并且仅在缺少 owner 身份时通过精确 provider API endpoint 消除歧义。

**把目录元数据当作传输支持证据，或将提供方自定义 ID 作为可选等级。** 目录不描述 endpoint 传输能力，来源声明也不能证明适配器可编码该 ID；适配器负责传输和推理等级执行，目录保留来源声明。

## 影响

resolver 可以补充模型能力，而无需接管适配器路由或传输行为。含糊的目录记录会保持保守，网络刷新失败时仍可使用最近一次成功的元数据。
