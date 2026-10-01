---
description: "An optional profile bundle for editing and resending the latest completed ordinary user turn in its existing Session."
kind: "package-bundle"
---

# @deepseek-ai/dsh-session-message-edit-resend

English | [中文](README.zh.md)

## Summary

This optional profile bundle adds an Edit and resend action to the latest completed ordinary user message. The composer keeps the same Session and carries the original attachments and already-extracted attachment text into the replacement prompt without putting derived text in the edit draft. Turns containing tool activity are not eligible, and an uncertain request is never retried automatically. Install and enable the bundle explicitly; shipped profile defaults do not include it.

The replacement lifecycle uses Host Agent APIs present only in this distribution's matching `@deepseek-ai/dsh-agent` and `@deepseek-ai/dsh-agent-loop` rc.2 packages; install them from the same distribution.

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

Add `@deepseek-ai/dsh-session-message-edit-resend` to a profile through its Plugin Manager, then enable the bundle and restart the profile if requested.

Choose **Edit and resend** on the latest eligible user message, change its text in the existing composer, and submit normally. The replacement appears as a new user row and remains eligible for another edit while it is the latest eligible turn. The current editable replacement is marked “Edited”; older replacement rows and the original messages remain visible as history. The Session log retains all original events and records each replacement operation.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

The Host checks the Session projection and current surface again when the composer submits. The core Agent reserves the Inbox, flushes a replacement intent before dispatch, and records whether the first external request started. Recovery resumes only an operation known not to have started; an uncertain operation requires the user to inspect the Session instead of risking a duplicate model call.

The Client contributes a transcript definition for durable replacement messages, one user-message action, and a status row in the official composer. It uses the official user renderer; it does not rewrite or hide the original transcript rows. Ordinary submissions remain unchanged when no edit is active.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Profile bundles](../../../docs/architecture.md#profiles-and-bundles) — optional profile layers.
- [Agent Loop](../../../packages/core/agent-loop/README.md#understand-the-implementation) — Session input and request lifecycle.

-----

<a id="model-experience"></a>
## Model Experience

### Edited and resent user turn

#### What the model sees

The replacement text, original non-text blocks, and previously extracted attachment text become the model-visible input for a new request in the same Session. The original request remains in the Session log but is removed from the current surface by the `surfaceOp: 'replace'` event. The first replacement pre-step is marked so attachment consumers can retain persisted extraction without processing the same bytes again.

#### Token effect

The replacement text and retained attachment extraction enter the next request as ordinary user-turn content; no additional schema or instructions are added.

#### KV Cache effect

The replacement starts a new request series over the updated surface; it does not reuse the replaced turn's model response as current conversation context.

## Known Limitations and Deferred Work

- Only the latest completed ordinary user turn with no tool activity can be edited.
- New attachments cannot be added while editing; cancel the edit to submit new attachments separately.
- A request whose external-call status is uncertain is not retried automatically.
- This bundle is optional and is not selected by shipped profile defaults.

<a id="dev-note"></a>
### Dev Note

The bundle owns its Host Remote and Client controls. The durable replacement event and Agent reservation are provided by the Host core; the bundle does not alter the default composer route unless an edit is active.
