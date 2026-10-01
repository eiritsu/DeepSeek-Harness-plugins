---
description: "一个可选 profile bundle，用于在原 Session 中编辑并重发最新已完成的普通用户回合。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-session-message-edit-resend

[English](README.md) | 中文

## 概述

这个可选 profile bundle 会在最新已完成的普通用户消息上增加“编辑并重发”操作。现有输入框会继续使用同一 Session，并将原附件和已提取的附件文本带入替换后的提示，但不会把派生文本填入编辑草稿。包含工具活动的回合不可编辑；状态不确定的请求不会自动重试。必须显式安装并启用此 bundle；已发布 profile 默认不包含它。

替换生命周期依赖仅存在于本发行版匹配包中的 `@deepseek-ai/dsh-agent` 与 `@deepseek-ai/dsh-agent-loop` rc.2 Host Agent API；请从同一发行版安装这两个包。

## 目录

- [使用此 package](#use-this-package)
- [实现方式](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制和待处理工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此 package

通过 profile 的 Plugin Manager 将 `@deepseek-ai/dsh-session-message-edit-resend` 添加到 profile，启用 bundle；如果应用提示重启，则重启 profile。

在最新且符合条件的用户消息上选择“编辑并重发”，然后在现有输入框中修改文本并正常提交。替换后的提示会作为新的用户消息行显示；当它仍是最新且符合条件的回合时，可以再次编辑。当前可编辑的替换消息会显示“已编辑”标记；较早的替换行和原消息仍作为历史显示。Session 日志保留全部原事件并记录每次替换操作。

-----

<a id="understand-the-implementation"></a>
## 实现方式

Host 会在输入框提交时重新检查 Session 投影和当前可见历史。core Agent 会保留 Inbox、在发送前刷新替换意图，并记录首个外部请求是否已经启动。恢复时只继续已知尚未启动的操作；状态不确定时要求用户检查 Session，不会冒险重复模型调用。

Client 为持久化替换消息注册会话渲染定义，在官方会话消息操作区提供一个操作，并在官方输入框显示状态行。它复用官方用户消息 renderer，不改写或隐藏原 transcript 行。现有 action slot 只提供最新可编辑消息的投影，因此更早的替换历史行不会单独带标记。没有编辑状态时，普通提交行为保持不变。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Profile bundles](../../../docs/architecture.zh.md#profiles-and-bundles)：可选 profile layer。
- [Agent Loop](../../../packages/core/agent-loop/README.zh.md#understand-the-implementation)：Session 输入和请求生命周期。

-----

<a id="model-experience"></a>
## Model Experience

### 编辑并重发的用户回合

#### What the model sees

替换后的文本、原有非文本内容块与先前提取的附件文本会成为同一 Session 中新请求的模型输入。原请求仍在 Session 日志中，但 `surfaceOp: 'replace'` 事件会将其从当前可见历史中移除。首个 replacement pre-step 会带有标记，让附件消费者保留已持久化的提取文本而不重复处理相同字节。

#### Token effect

替换文本与保留的附件提取内容会作为普通用户回合内容进入下一个请求；不添加任何额外 schema 或指令。

#### KV Cache effect

替换后的可见历史会开始新的请求系列；已替换回合的模型回答不会继续作为当前对话上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和待处理工作

- 只能编辑最新的、已完成且没有工具活动的普通用户回合。
- 编辑时不能添加新附件；请取消编辑后单独发送新附件。
- 外部调用状态不确定时不会自动重试。
- 此 bundle 为可选功能，已发布 profile 默认不会启用。

<a id="dev-note"></a>
### 开发备注

此 bundle 自带 Host Remote 和 Client 控件。持久化替换事件及 Agent reservation 由 Host core 提供；只有编辑状态激活时，bundle 才会改变默认输入框提交路由。
