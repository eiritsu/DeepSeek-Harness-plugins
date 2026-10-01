# Agent Note：持久化 Session surface 替换操作

Status: implemented

[English](2026-09-27-durable-session-surface-replacement.md) | 中文

## Problem

通过内存队列替换模型可见历史，无法区分已提交的输入与可能已经发送到外部模型的工作；它也可能与普通 inbox 修改竞争，或在重启后重放状态不确定的请求。

## Decision

`Agent.replaceSurface()` 会将请求写入 Session 日志，并在循环接纳替换工作前刷新日志。循环为该操作预留 Inbox 修改权，随后将替换内容提交为 `user/message`，其 `surfaceOp` 和 `sourceEventSeqs` 标明精确范围。首次外部模型调用前，循环会刷新 `request-started` 事件，并记录一个终态结果。

`surfaceReplacement` projection 将这些事实与实际提交的用户消息一起折叠。没有输入或启动标记的请求在恢复后仍可安全启动；已提交输入但没有启动标记的请求可以继续处理而不重复追加。存在启动标记但没有终态结果的请求属于状态不确定，绝不会自动重放。相同 payload 重用 request ID 时按幂等处理；payload 不同则拒绝。

此操作要求 Agent 空闲、Inbox 为空，并且请求范围与当前 surface 完全一致。调用方负责准入策略。该通用方法并不保证范围是最新的普通用户 turn、没有工具副作用，或适合面向用户的编辑并重发操作。启动标记阻止自动重复调用，但无法保证外部模型服务恰好执行一次。

## Alternatives considered

- 仅在内存中保存待替换输入，无法跨重启恢复，也不能证明请求已刷新。
- 重启后重放已启动请求，可能重复一个响应丢失的外部调用。
- 添加面向单一界面的 Controller 专用方法，会将 Agent API 与某个用户界面耦合，而不是暴露 Session 层级的操作。

## Consequences

`dsh-agent` 拥有请求和 Session 事件类型。`dsh-agent-loop` 拥有同步 Inbox 预留、持久化 projection、请求准入、刷新顺序和恢复状态。Session 事件映射及生成的持久化目录记录这三种操作事件。未来 UI 插件必须单独执行产品准入规则，并向用户说明状态不确定的操作。
