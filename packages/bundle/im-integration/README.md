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

## Conversation Workspaces

Each IM channel conversation opens only after an independent Workspace exists for that conversation under `~/.dsh/workspaces/im/<platform>/`. Channels never share a working directory; Host code must call `openImConversation` (or `ensureImConversationWorkspace`) before creating or resuming a Session.

## Known Limitations

- Live inbound/outbound message bridges for DingTalk, WeCom, QQ, Telegram, Discord, and WhatsApp are not shipped yet. Status reports credential readiness (`connected` once identity and secrets are present).
- WhatsApp Web / Baileys QR pairing is not implemented; only Cloud API identity fields are accepted.
- Dedicated Lark private-chat ingress remains `@deepseek-ai/dsh-lark-integration`; this bundle's Lark tab stores shared identity fields for multi-platform Settings only.
- Phone-side WeChat “网络错误” during Connect can still come from Tencent iLink (see openclaw-weixin#242). This package matches the official QR long-poll headers and client version; upstream outages remain outside Host control.
