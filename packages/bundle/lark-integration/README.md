---
description: "Opt-in profile layer for a Lark or Feishu private-chat Host integration and its Plugins detail configuration page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-lark-integration

English | [中文](README.zh.md)

## Summary

You can route private messages from one authorized Lark or Feishu user into durable Harness Sessions and configure the connection on the bundle's Plugins detail page. The integration starts disabled until you enable it after configuration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install `@deepseek-ai/dsh-lark-integration` in the target profile through Plugin Manager or `dsh plugin --profile <name> add @deepseek-ai/dsh-lark-integration`. Open the bundle's page in **Plugins** and choose **Quick connect** to register an app, or **Use an existing app** to enter an application ID and write-only secret. Both paths use official device authorization for the current user; the Host obtains that user's Open ID from the official CLI status command. Enable the connection after setup succeeds.

The bundle accepts private-chat messages only from the configured user. Quick connect creates an app with the bundle's private-chat scopes; existing-app setup does not change that app's permissions. The model-facing CLI is a separate, disabled-by-default setting and starts only when the agent calls `lark_cli`.

<a id="understand-the-implementation"></a>
## Understand the implementation

The profile patch inserts one `lark` Host row with both the private-chat connection and `lark_cli` disabled. The package contains its Host wrapper, private-chat implementation, official Lark CLI launcher, and Client entry; the Client entry registers the bundle detail page only while the Host configuration is served. The Typert Loader registers the package's `./typert` contribution with the Host entry; direct plugin mounts register it only when the Loader has not already done so. App registration uses the official channel SDK. User device authorization and identity lookup use the official CLI through `ctx.subprocess`; the application secret is sent through stdin, never argv or environment variables, and device codes stay in the Host credential store. Only exact read-only commands in the bundle allowlist run without approval; other CLI commands request the official tool approval flow. Use `lark_cli` with `auth status` or `auth status --json` to inspect this bundle's CLI configuration, and use `im +chat-list` with supported read-only filters such as `--types p2p`, `--sort active_time`, `--page-size 5`, and `--format json` to list chats. A rejected approval means the requested operation did not run and gives no information about configuration. Connection state uses the existing `larkStatus` Remote from `dsh-lark`; setup actions use the bundle's separate `larkSetup` Remote.

Load this package as the only Host owner of the Lark integration. Do not load the separate `@deepseek-ai/dsh-lark` Host entry in the same profile; duplicate descriptor ownership fails explicitly. The standalone package remains the implementation source used by this bundle.

The first explicit CLI operation may download the upstream CLI binary; the embedded launcher verifies its SHA-256 against the package checksum manifest. Loading the bundle, opening its Plugins page, and enabling the private-chat connection do not start the launcher. Registration has a configurable deadline; authorization URLs are restricted to official Feishu and Lark account origins.

<a id="further-exploration"></a>
## Further Exploration

- [Lark Host plugin](src/host/lark/plugin.ts) — private-chat ingress and Session behavior.
- [Profile composition](../../../docs/architecture.md#profiles-and-bundles) — bundle ordering and profile ownership.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the inserted Lark Host plugin, which owns accepted private-chat turns visible to the model.

#### KV Cache effect

Only the requests made by the inserted Lark Host plugin can affect model context.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

- The bundle requires a Web profile; its configuration page is a browser Client surface.
- The Host accepts private chats from one configured user. Quick connect registers an app with the supported private-chat scopes; user authorization is limited to the official device-code flow and current-user identity needed by this integration.
- Permission-template management is not included; CLI write commands still require the official per-call tool approval flow.
- Group chats, multiple authorized users, and general application OAuth or permission administration are not supported. Existing-app setup does not alter permissions in the Lark developer console.

| Capability | Current coverage |
|---|---|
| Private-chat Session bridge | Included for one configured user. |
| Official Lark CLI | Included as an opt-in `lark_cli` tool; read-only commands are allowlisted and other commands request approval. |
| Quick app registration and user device authorization | Included for this integration's private-chat use. General OAuth setup and permission administration are not included. |
| Permission administration | Not included; approval of one CLI call is not Lark permission management. |

<a id="dev-note"></a>
### Dev Note

The packed-artifact smoke requires built Host and Client `lib/` entries. Build both faces first, then run `pnpm --filter @deepseek-ai/dsh-lark-integration run test:packed-artifact`; the regular source suite reports this artifact-only test as skipped.
