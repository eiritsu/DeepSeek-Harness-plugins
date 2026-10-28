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

## 会话工作区

每个 IM 渠道在连接后发起会话前，都会先为该会话创建独立 Workspace（目录位于 `~/.dsh/workspaces/im/<platform>/`）。不同渠道、不同会话不共享工作目录；Host 侧必须通过 `openImConversation`（或 `ensureImConversationWorkspace`）完成工作区准备后再创建或恢复 Session。

## 已知限制

- 钉钉、企业微信、QQ、Telegram、Discord、WhatsApp 的实时收发桥尚未交付；状态表示凭证是否就绪（身份与密钥齐全时为 `connected`）。
- WhatsApp Web / Baileys 扫码尚未接入真实握手，仅支持 Cloud API 身份字段。
- 飞书/Lark 私聊接入仍由 `@deepseek-ai/dsh-lark-integration` 负责；本包 Lark 标签仅保存多平台设置页共用的身份字段。
- 手机微信点「连接」出现「网络错误」仍可能来自腾讯 iLink（见 openclaw-weixin#242）。本包已对齐官方长轮询头与客户端版本；上游故障不在 Host 可控范围。
