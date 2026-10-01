---
description: "Optional profile layer that replaces the Web turn-process renderer with a reduced-motion-aware shimmer."
kind: "package-bundle"
---

# @deepseek-ai/dsh-turn-process-shimmer

English | [中文](README.zh.md)

## Summary

This optional layer enables the running-label shimmer in the Web conversation. It is not selected by profile defaults; users add it to a profile explicitly and can disable or remove it through Plugin Manager. Its Client plugin replaces only the official `turn-process` keyed renderer and retains the disclosure and accessibility behavior.

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

Install `@deepseek-ai/dsh-turn-process-shimmer` in the target profile through Plugin Manager or `dsh plugin --profile <name> add @deepseek-ai/dsh-turn-process-shimmer`, then enable or disable the bundle from the profile's Plugins page.

The bundle is opt-in for every profile family.

The bundle requires the Web conversation Client. The feature plugin honors reduced-motion preferences and changes no Host behavior.

<a id="understand-the-implementation"></a>
## Understand the implementation

The patch inserts one row, `ui-turn-process-shimmer`, for this package. Its tarball contains the Host entry and the Client module built from this package's own Client source; the Client module replaces the existing keyed renderer through the official slot.

<a id="further-exploration"></a>
## Further Exploration

- [ui-chat](../../client/ui-chat/README.md) — official chat-node presentation.
- [Profile composition](../../../docs/architecture.md#profiles-and-bundles) — bundle ordering and profile ownership.

<a id="model-experience"></a>
## Model Experience

None, as the bundle only replaces a browser renderer and adds no model context.

#### KV Cache effect

No model request context is added or changed.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

- The replacement requires the Web profile and its `turn-process` renderer.
- The effect is client-side only; no Session or agent state changes.

<a id="dev-note"></a>
### Dev Note

None.
