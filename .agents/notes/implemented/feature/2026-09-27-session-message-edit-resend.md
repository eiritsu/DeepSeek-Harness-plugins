# Agent Note: Optional latest-turn edit and resend bundle

Status: implemented

English | [中文](2026-09-27-session-message-edit-resend.zh.md)

## Problem

The generic durable surface replacement API deliberately has no product eligibility policy or user interface. A user-facing edit action needs to select only a safely replaceable completed turn and must not intercept ordinary composer submissions.

## Decision

`@deepseek-ai/dsh-session-message-edit-resend` is an optional profile bundle. Its Host projection offers only the latest completed ordinary user turn with an assistant response and no tool or other unsafe events. The Host rechecks that policy and the exact Session surface range when the existing composer submits. The Client edits in the existing composer, keeps the Session's draft isolated, and preserves the original attachment blocks; it rejects newly added attachments during edit mode.

The bundle leaves ordinary composer submission unchanged outside edit mode. It does not enter shipped profile defaults. A replacement with uncertain external-call status is reported to the user and is never automatically retried.

## Alternatives considered

- A queued-message editor changes input that has not entered the Session surface and cannot replace an already completed turn.
- A dialog with a separate send action would bypass the official composer and duplicate its attachment and submission behavior.
- Installing the controls in every profile would make an optional, policy-sensitive operation part of the default product surface.

## Consequences

The bundle owns its Host Remote, projection, Client action, and locale copy. `Agent.replaceSurface()` remains the generic durable operation described in [the Session surface replacement note](../architecture/2026-09-27-durable-session-surface-replacement.md). The eligible source turn must have no tool activity; a new replacement turn may use tools and complete its normal follow-up steps.
