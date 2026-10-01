---
description: "Package map for durable attachments and optional local Office and PDF text extraction."
kind: "package-group"
---

# attachment/ — durable attachment capability family

English | [中文](README.zh.md)

## Summary

The `attachment/` group provides durable file and image attachments plus an optional local Office and PDF text extractor. The shipped `dsh` composition enables image attachments with no setup; the Office recognizer is an opt-in profile layer. Stored attachments survive restarts and are not deleted automatically.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The attachment packages provide durable storage, and the optional recognizer consumes durable file references before messages are logged.

| Package | Role | ctx key |
|---|---|---|
| [`attachment/`](attachment/README.md) | Image attachments for prompts and commands that persist and come back in history | `ctx.attachments` |
| [`attachment-local/`](attachment-local/README.md) | Stores your attached images on this machine below `DSH_HOME` | registers on `ctx.attachments` |
| [`file-recognizer-office/`](file-recognizer-office/README.md) | Adds Office document extraction and optional scanned-PDF OCR for uploaded FileBlocks | `agent/pre-step` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the service contract, then the capability-seam table and the configuration surface of the local backend.

- [Attachment subsystem reference](../../docs/subsystems/attachment.md) — service contract, payload types, and the `ctx.attachments` Cordis surface.
- [Capability seams](../../docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this family follows.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-attachment-local) — every accepted field of the local backend.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
