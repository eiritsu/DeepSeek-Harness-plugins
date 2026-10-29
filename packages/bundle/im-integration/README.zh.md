# @deepseek-ai/dsh-im-integration

[English](README.md) | 中文

## 快速上手

1. **选择平台**：在上方标签页中切换你要配置的聊天平台（飞书/Lark、钉钉、企业微信、微信、QQ、Telegram、Discord、WhatsApp）。
2. **填写凭证**：根据所选平台的提示填入 App ID / Token / Secret，或使用二维码扫码授权。密钥经 Host credentials 写入，设置页不会回读明文。
3. **访问与安全控制**：
   - **授权白名单**：开启后仅允许指定 User ID / Open ID 调用 Agent；关闭则完全开放给所有对话者。
   - **内容安全审核**：开启后拦截或审批敏感词操作；关闭则完全放行 Agent 自主执行。
4. **启用插件**：打开总开关并保存。连接状态由 Host 流式推送（`imStatus.watch`），不是 Client 本地写死的徽标。

## 微信授权

通过 Host 代理（`/api/im.weixin.*`）扫 ClawBot 二维码。成功后 Client 调用一次 `imSetup.commitWeixinAuthorization`；Host 落盘 `WEIXIN_BOT_TOKEN`（JSON）、打开 `weixinEnabled`，并将状态调和为 `connected`。Remote 返回值不包含 token。

## 官方命令行工具

打开「允许 Agent 调用官方命令行工具」，再打开对应渠道开关。配置了 App ID 后，`lark_cli` 默认开启。`wecom_cli` 和 `dingtalk_cli` 默认关闭，钉钉还需要 Client ID。第一次调用会下载固定版本的官方二进制，用本包内置的哈希校验，并复用已校验的同一份文件。登录走 `im_cli_auth`，它返回飞书链接、企业微信二维码路径或钉钉设备码，由 Agent 转给用户。密钥不会出现在命令参数里。若同时加载了 `@deepseek-ai/dsh-lark-integration`，本插件不再注册 `lark_cli`。

## 会话工作区

每个 IM 渠道在连接后发起会话前，都会先为该会话创建独立 Workspace（目录位于 `~/.dsh/workspaces/im/<platform>/`）。不同渠道、不同会话不共享工作目录；Host 侧必须通过 `openImConversation`（或 `ensureImConversationWorkspace`）完成工作区准备后再创建或恢复 Session。

## 模型体验

### 官方命令行工具

#### 模型看到的内容

开关打开后，模型可以调用 `lark_cli`、`wecom_cli`、`dingtalk_cli` 和 `im_cli_auth`。每个 CLI 工具接收 `arguments` 数组。`im_cli_auth` 接收 `channel`，并返回 `url`、`deviceCode`、`userCode`、`qrCodePath` 和 `pending`。

#### 令牌影响

已注册的工具会把说明和参数文本放进之后每一轮的工具列表，直到开关关闭。一次调用会附上该命令被截断后的 stdout 和 stderr。

#### KV Cache 影响

工具列表属于重复请求的前缀。打开或关闭某个 CLI 工具会改变这个前缀，使之前的缓存不能复用。命令输出追加在前缀之后，不会改写更早的轮次。

## 已知限制与未完成工作

- 钉钉、企业微信、QQ、Telegram、Discord、WhatsApp 的实时收发桥尚未交付；状态表示凭证是否就绪（身份与密钥齐全时为 `connected`）。
- WhatsApp Web / Baileys 扫码尚未接入真实握手，仅支持 Cloud API 身份字段。
- 飞书/Lark 私聊接入仍由 `@deepseek-ai/dsh-lark-integration` 负责。不要把它和本插件的 `lark_cli` 同时启用：检测到该插件已加载时，本插件会跳过 `lark_cli`。
- 手机微信点「连接」出现「网络错误」仍可能来自腾讯 iLink（见 openclaw-weixin#242）。本包已对齐官方长轮询头与客户端版本；上游故障不在 Host 可控范围。
- 企业微信二维码需要在真实账号上确认会绑定到已配置的机器人。钉钉设备登录的输出，以及 macOS 钥匙串隔离（`DWS_DISABLE_KEYCHAIN`），仍需要在能访问对应服务的机器上人工确认。
