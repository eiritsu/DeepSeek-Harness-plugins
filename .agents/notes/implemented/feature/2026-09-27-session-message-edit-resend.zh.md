# Agent Note：可选的最新回合编辑并重发 bundle

Status: implemented

[English](2026-09-27-session-message-edit-resend.md) | 中文

## Problem

通用的持久化 surface 替换 API 刻意不包含产品准入规则或用户界面。面向用户的编辑操作必须只选择可安全替换的已完成回合，并且不能拦截普通输入框提交。

## Decision

`@deepseek-ai/dsh-session-message-edit-resend` 是一个可选 profile bundle。其 Host projection 只会提供最新的已完成普通用户回合，要求存在 assistant 回复且不含工具或其他不安全事件。用户通过现有输入框提交时，Host 会重新检查准入条件及精确 Session surface 范围。Client 在现有输入框中编辑，隔离保存该 Session 的草稿，并保留原附件块；编辑模式下拒绝新附件。

编辑模式之外，该 bundle 不改变普通输入框提交行为。已发布 profile 默认不包含它。外部调用状态不确定的替换会告知用户，绝不会自动重试。

## Alternatives considered

- 排队消息编辑修改的是尚未进入 Session surface 的输入，不能替换已经完成的回合。
- 使用独立对话框发送会绕开官方输入框，并重复实现附件和提交行为。
- 在所有 profile 中安装控件，会把可选且需要准入判断的操作变成默认产品界面。

## Consequences

该 bundle 拥有自己的 Host Remote、projection、Client 操作和本地化文案。`Agent.replaceSurface()` 仍是通用持久化操作，详见 [Session surface 替换说明](../architecture/2026-09-27-durable-session-surface-replacement.zh.md)。原始可编辑回合不能包含工具活动；新的替换回合仍可使用工具并正常完成后续步骤。
