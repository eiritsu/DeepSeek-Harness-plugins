---
description: "Ready-made dsh profile bundles for the shared core, browser GUI, one-shot task, ACP, and SDK application surfaces."
kind: "package-group"
---

# bundle/ — profile plugin bundles

English | [中文](README.zh.md)

## Summary

This group maps the installable patch layers used by `dsh --profile`. Each package declares `dsh.bundle.patch`; the launcher stacks those patch documents to assemble a named profile. The `web`, `headless`, `acp`, and `sdk` profiles build on `dsh-base`, while `sdk-minimal` supplies its complete tree in one bundle. Domain packages can declare additional layers outside this directory.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`base`](base/README.md) | Shared core for base-backed profiles | — (patch only) |
| [`acp-app`](acp-app/README.md) | Automation-only ACP stdio application over base | mounts the ACP bridge |
| [`web-app`](web-app/README.md) | Browser application layer over base | mounts Web rows |
| [`headless`](headless/README.md) | One-shot command-line task application over base | `headless-runner` |
| [`sdk-app`](sdk-app/README.md) | SDK JSON-RPC stdio application over base | mounts the SDK server |
| [`sdk-minimal`](sdk-minimal/README.md) | Standalone minimal SDK application without base or Web | — (complete patch tree) |
| [`community-plugin-catalog`](community-plugin-catalog/README.md) | Optional community plugin directory for a profile | Adds its own Host Remote and Client entry |
| [`community-skill-catalog`](community-skill-catalog/README.md) | Optional SkillHub discovery and reviewed skill installation | Adds its own Host Remote and Client entry |
| [`lark-integration`](lark-integration/README.md) | Optional Lark/Feishu private-chat integration and Settings page | Adds a disabled Host row and its Client page |
| [`copy-session-id`](copy-session-id/README.md) | Optional conversation-header Session ID action | Adds a Client plugin row |
| [`turn-process-shimmer`](turn-process-shimmer/README.md) | Optional Web running-process text treatment | Replaces the keyed Client renderer |

In-box bundles resolve from the dsh installation; out-of-tree bundles install into a profile through `dsh plugin --profile <name> add <package>`.

<a id="related-documentation"></a>
## Related documentation

- [dsh app](../../apps/cli/README.md) — the `dsh` command that starts a profile.
- [app-boot](../boot/app-boot/README.md) — how profiles are resolved, layered, and customized.
- [Profile plugin bundles note](../../.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md) — the profile and bundle composition design.
- [Generated composition graph](../../apps/cli/composition.md) — the exact composition each shipped profile uses.

<a id="dev-note"></a>
## Dev Note

None.
