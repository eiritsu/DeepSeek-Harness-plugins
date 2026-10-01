# Agent Note：Lark 私聊 Host 入站

Status: implemented

[English](2026-09-25-lark-private-chat-host.md) | 中文

## 问题

操作者需要让一个获准的 Lark 或飞书私聊创建持久化 Harness Agent 轮次，同时拒绝其他发送者，并在重启后保留消息身份。

## 决策

`@deepseek-ai/dsh-lark-integration` 是可选 Host 与 Client 组合包。Host 使用维护中的 Lark Channel 长连接，并通过 `ctx.credentials` 解析配置的应用密钥。Typert Loader 会随 Host entry 注册该包生成的 `./typert` contribution；直接挂载插件时，仅当 Loader 尚未登记该 contribution 才由插件入口注册。快速连接通过官方 channel SDK 注册应用；已有应用路径接收应用身份与只写密钥。两种路径都通过官方 device-code 流程授权当前用户。Host 将 device code 保存在凭据中，只接受官方账号来源，从官方 CLI 状态读取授权用户的 Open ID，并在报告成功前通过 `configEditor` 写入。应用注册截止时间是经过校验的可配置项。Host 仅接受该用户的私聊 Open ID，根据应用与聊天派生稳定 Session ID，恢复已持久化 Session，并在再次提交平台消息前检查 Session 中已记录的 Lark 消息 ID。收到的图片和文件会转换为附件引用；assistant 文本和图片会回复到来源消息。Cordis effect 清理会停止入站、等待已接收操作、断开 Channel 并释放其持有的 Agent handle。

组合包的 Client 会在 Host 配置行启用时，把配置挂到官方 Plugin Manager 上该组合包自己的页面，按包名索引到 `plugins.bundle.config` slot。普通设置通过共享 Settings form 编辑，应用密钥通过 credentials Remote 写入；页面不会读回已保存密钥。授权与配置操作调用组合包自有的 `larkSetup` Remote 方法，Host 注册与配置写入通过 `larkStatus` 流返回。页面区分 Host 可能上报的三种状态：用户授权未完成显示为待办步骤，密钥缺失或长连接失败才显示为错误。跳转到官方授权页面的链接是主操作，之后的「我已完成授权」是次级操作，必须先做的那一步才承载视觉重心。三个控件共用 `Button` 的控件度量——盒模型、gap、36px 高度、圆角、字体与左右内边距——宽度则由各自文案自然决定，因为度量不一致的一排控件读起来像三个互不相干的链接。取消会丢弃一次进行到一半的授权，因此保留 `outline` 形状但改用 error token。页面样式只使用 `--dsw-alias-*` 设计 token；该命名空间之外的 token 会让声明静默失效，使控件看起来像普通文本。可选模型 CLI 默认关闭，除精确只读 allowlist 外均需审批。冻结版私有 CLI launcher 与独立持久化格式不保留；授权仅通过 `ctx.subprocess` 调用官方 CLI 包。

现有 Session snapshot harness 启动 ACP 场景，无法注入 Lark Channel 事件；因此 bridge 和 Cordis composition 测试不能证明录制的 Lark 模型轮次。通过普通单 profile snapshot 注入实现受支持的测试，需要单独决定 harness 改动。候选方案是在现有 snapshot suite 增加输入步骤，并由 shipped profile 的场景 overlay 仅在进程内提供 fake Channel provider；不得新增第二个 CLI 入口或生产用 test-only 开关。

## 考虑过的替代方案

- **保留冻结的私有 CLI launcher 与直接写入 device-code 凭据** — 拒绝，因为它绕过当前 Host 凭据和 ConfigEditor API。当前组合包只通过 `ctx.subprocess` 调用官方 CLI 包，并通过 `configEditor` 写入确认后的身份。
- **只使用内存中的去重记录** — 拒绝，因为进程重启后，已持久化的平台消息可能再次创建 Session 轮次。
- **新增第二个 snapshot 命令或场景可执行文件** — 拒绝，因为 snapshot 必须通过 `dsh` 和 shipped profile 启动；额外入口会绕开该约束。

## 后果

Host transport、注册/授权编排与 Settings 凭据处理无需真实 Lark 账户或 Secret 即可测试，而生产启用仍需显式配置且默认关闭。Session identity 与去重依赖现有 Session persistence，能够跨进程重启保留。组合包为一位当前用户授权私聊；群聊、多授权用户、权限管理和 Lark 特定的 model-visible replay 仍未覆盖。
