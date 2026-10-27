---
description: "Optional profile layer for multi-platform IM integration (Feishu/Lark, DingTalk, WeCom, WeChat, QQ, Telegram, Discord, WhatsApp) and Settings Client page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-im-integration

English | [中文](README.zh.md)

## Overview

This bundle provides unified multi-platform instant messaging (IM) integration for DeepSeek Harness. You can connect authorized user direct messages or channel messages into persistent Harness Sessions, and configure platform credentials across tabbed pages in the Plugins detail view.

Supported platforms:
- Feishu / Lark (long connection and direct messaging)
- DingTalk (Stream mode and `dws` CLI)
- WeCom (bot communications and `@wecom/cli`)
- WeChat (secure QR-code authorization and direct messaging)
- QQ (Tencent QQ Open Platform WebSocket Gateway)
- Telegram (Telegram Bot API Long-Polling)
- Discord (Discord Gateway WebSocket)
- WhatsApp (QR-code pairing and messaging)

## Table of contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further exploration](#further-exploration)
- [Model experience](#model-experience)
- [Known limitations and deferred work](#known-limitations-and-deferred-work)
- [Dev note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install the bundle into a target profile through Plugin Manager or `dsh plugin --profile <name> add @deepseek-ai/dsh-im-integration`. In the **Plugins** detail page, select the platform tab and fill in credentials or scan the authorization code.

<a id="understand-the-implementation"></a>
## Understand the implementation

The package contains a unified IM Ingress Router, individual platform adapters, and a tabbed Client configuration page. Secrets are managed by the Host credentials store and never exposed in plaintext to the browser.

<a id="further-exploration"></a>
## Further exploration

- [Profiles and bundles](../../../docs/architecture.md#profiles-and-bundles) — Bundle composition and profile ownership.

<a id="model-experience"></a>
## Model experience

Produces indirect effects through the inserted IM Host plugins, which own model-visible Session turns.

#### KV Cache impact

Only requests initiated by enabled IM integrations impact the model context.

<a id="known-limitations-and-deferred-work"></a>
## Known limitations and deferred work

Publishes no companion invariant module because it has no independently observable diverging relationships.

- Requires Web profiles for the Client settings page.
- Responds only to configured authorized users.

<a id="dev-note"></a>
### Dev note

Build Host and Client: `pnpm --filter @deepseek-ai/dsh-im-integration run bundle`.
