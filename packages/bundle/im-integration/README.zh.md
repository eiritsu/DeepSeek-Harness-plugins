# @deepseek-ai/dsh-im-integration

[English](README.md) | 中文

## 快速上手

1. **选择平台**：在上方标签页中切换你要配置的聊天平台（飞书/Lark、钉钉、企业微信、微信、QQ、Telegram、Discord、WhatsApp）。
2. **填写凭证**：根据所选平台的提示填入 App ID / Token / Secret，或使用二维码扫码授权。
3. **访问与安全控制**：
   - **授权白名单**：开启后仅允许指定 User ID / Open ID 调用 Agent；关闭则完全开放给所有对话者。
   - **内容安全审核**：开启后拦截或审批敏感词操作；关闭则完全放行 Agent 自主执行。
4. **启用插件**：完成配置后点击右上角开关启用即可。

## 会话工作区

每个 IM 渠道在连接后发起会话前，都会先为该会话创建独立 Workspace（目录位于 `~/.dsh/workspaces/im/<platform>/`）。不同渠道、不同会话不共享工作目录；Host 侧必须通过 `openImConversation`（或 `ensureImConversationWorkspace`）完成工作区准备后再创建或恢复 Session。
