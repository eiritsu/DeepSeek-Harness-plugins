---
description: "Standalone optional profile bundle that adds a Session ID copy action to the conversation header utilities."
kind: "package-bundle"
---

# @deepseek-ai/dsh-copy-session-id

English | [中文](README.zh.md)

## Summary

This optional package adds a Session-scoped Copy Session ID action to a Web profile's conversation header utilities. Its single tarball contains the Loader entry, Client bundle, and profile patch; it is installed and enabled by the user, not included in shipped profile defaults.

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

Install `@deepseek-ai/dsh-copy-session-id` in the target profile through Plugin Manager or `dsh plugin --profile <name> add @deepseek-ai/dsh-copy-session-id`, then enable or disable the bundle from the profile's Plugins page.

The action appears as a copy icon in the conversation header utilities and copies the current Session identifier through the host clipboard. It requires the official Web Client conversation header.

<a id="understand-the-implementation"></a>
## Understand the implementation

The patch inserts one root Host row, `ui-copy-session-id`, for this package. Its `dsh.client` manifest declares the browser dependencies, and the official Client loader resolves the same package's `./client` entry. The action registers directly in `conversation.session.header.utilities`.

<a id="further-exploration"></a>
## Further Exploration

- [Profile composition](../../../docs/architecture.md#profiles-and-bundles) — bundle ordering and profile ownership.

<a id="model-experience"></a>
## Model Experience

None, as the bundle only copies a Session identifier in the browser and adds no model context.

#### KV Cache effect

No model request context is added or changed.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

- The bundle requires the Web profile and its conversation header Client.
- Clipboard access remains controlled by the Host; denied or unavailable writes report failure.

<a id="dev-note"></a>
### Dev Note

None.
