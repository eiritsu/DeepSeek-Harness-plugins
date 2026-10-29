# @deepseek-ai/dsh-im-integration

English | [中文](README.zh.md)

## Quick Start

1. **Select Platform**: Switch between IM platforms (Feishu/Lark, DingTalk, WeCom, WeChat, QQ, Telegram, Discord, WhatsApp) using the tabs above.
2. **Enter Credentials**: Fill in your App ID, Bot Token, or App Secret for the chosen platform, or follow the QR code authorization prompt. Secrets write through Host credentials; the Settings page never reads them back.
3. **Access & Moderation**:
   - **Whitelist**: Enable to restrict agent access to authorized User IDs or Open IDs; disable to allow all incoming users.
   - **Moderation**: Enable to inspect and approve sensitive commands; disable for full agent autonomy.
4. **Enable**: Toggle the master switch and save. Connection status streams from Host (`imStatus.watch`); it is not a Client-local badge.

## WeChat authorization

Scan the ClawBot QR code through the Host proxy (`/api/im.weixin.*`). On success the Client calls `imSetup.commitWeixinAuthorization` once; Host persists `WEIXIN_BOT_TOKEN` (JSON payload), sets `weixinEnabled`, and reconciles status to `connected`. The token never returns on the Remote result.

## Official CLI tools

Turn on **Allow Agent to execute official CLI tool**, then enable the channel switch. `lark_cli` is on by default once an App ID is set. `wecom_cli` and `dingtalk_cli` stay off until their switches are enabled, and DingTalk also needs a client id. The first call downloads the pinned official binary, checks it against the hash shipped in this package, and reuses that verified copy. Login goes through `im_cli_auth`, which returns a Lark URL, a WeCom QR image path, or a DingTalk device code for the agent to show the user. Secrets are not placed in command arguments. If `@deepseek-ai/dsh-lark-integration` is loaded as well, this plugin does not register `lark_cli`.

## Conversation Workspaces

Each IM channel conversation opens only after an independent Workspace exists for that conversation under `~/.dsh/workspaces/im/<platform>/`. Channels never share a working directory; Host code must call `openImConversation` (or `ensureImConversationWorkspace`) before creating or resuming a Session.

## Model Experience

### Official CLI tools

#### What the model sees

When the switches are on, the model can call `lark_cli`, `wecom_cli`, `dingtalk_cli`, and `im_cli_auth`. Each CLI tool takes an `arguments` array. `im_cli_auth` takes `channel` and returns `url`, `deviceCode`, `userCode`, `qrCodePath`, and `pending`.

#### Token effect

A registered tool adds its description and parameter text to the tool list for every later turn until the switch turns it off. A call appends the capped stdout and stderr from that command.

#### KV Cache effect

The tool list is part of the repeated request prefix, so enabling or disabling a CLI tool changes that prefix and prevents reuse of the previous cache. A command's output is appended after the prefix and does not rewrite earlier turns.

## Known Limitations and Deferred Work

- Live inbound/outbound message bridges for DingTalk, WeCom, QQ, Telegram, Discord, and WhatsApp are not shipped yet. Status reports credential readiness (`connected` once identity and secrets are present).
- WhatsApp Web / Baileys QR pairing is not implemented; only Cloud API identity fields are accepted.
- Dedicated Lark private-chat ingress remains `@deepseek-ai/dsh-lark-integration`. Do not load that plugin together with this plugin's `lark_cli`: this plugin skips `lark_cli` when the other plugin is loaded.
- Phone-side WeChat “网络错误” during Connect can still come from Tencent iLink (see openclaw-weixin#242). This package matches the official QR long-poll headers and client version; upstream outages remain outside Host control.
- WeCom QR login must be confirmed against the configured bot on a real account. DingTalk device login output and macOS keychain isolation (`DWS_DISABLE_KEYCHAIN`) still need a manual check on a machine that can reach those services.
