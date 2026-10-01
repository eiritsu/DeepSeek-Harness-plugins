# Agent Note: Runtime 模型元数据回退

Status: implemented

[English](2026-09-28-runtime-model-metadata-fallback.md) | 中文

## Problem

不了解外部模型目录的 adapter 无法使用目录事实，即使目录已通过官方 LLM runtime API 注册。

## Decision

Runtime 先解析 adapter 元数据；只有缺少上下文容量或输入模态时，才查询已注册的外部来源。Adapter 自身的值始终优先。Runtime 按精确 provider route 和 model ID 查询并传播操作取消；若 adapter 在同一操作中已查询 resolver，则复用其结果；普通来源故障会被忽略，避免可选目录使原本可用的 adapter 失效。无效值和不同来源间互相冲突的声明会显式失败；无法识别唯一上游模型的来源不返回元数据。

通用 runtime 不会把目录的 `reasoningEfforts` 或 `maxOutputTokens` 应用为可执行调用能力。Adapter 必须先依据 provider 请求实现校验推理标识符；输出上限也必须有 adapter 自身的策略，才能约束调用配置。

## Alternatives considered

**要求每个 adapter 主动调用 resolver。** 这样元数据策略留在 adapter 内，但第三方 adapter 仍不了解官方目录 API，并且每个 adapter 都要重复集成。

**把所有目录字段应用到所有 adapter。** 目录事实无法证明 provider route 能执行这些能力。把推理标识符或输出限制当作权威信息，可能暴露不可用的控制项，或拒绝 provider 实际接受的请求。

## Consequences

Adapter 无需改动即可继承可信的上下文和输入模态回退，同时自己的元数据仍然优先；含糊的外部事实和无效容量不会按注册顺序静默胜出。由于 runtime 没有 provider 专属的可执行描述，推理和输出限制策略仍由 adapter 负责。
