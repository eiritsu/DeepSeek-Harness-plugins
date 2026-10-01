# Agent Note: Explicit Office file submission

Status: implemented

English | [中文](2026-09-27-office-file-submission.zh.md)

## Problem

Some users need to submit one Office-readable attachment without changing the official composer's picker, drag-and-drop, or `@` reference semantics.

## Decision

The optional `file-recognizer-office` Client entry registers one Session-header utility. It uses the official `FileUploadService`, retains the current `ISession` through `ISessions.using`, registers an echo with `beginSubmission`, and sends text plus the upload receipt in one ordinary queued `Session.prompt`. The official Agent pre-step then extracts the admitted FileBlock as usual.

Only a known business refusal (`gateway/bad-request`, `session/not-found`, or `session/attachment-invalid`) leaves the staged receipt available for a user-triggered retry. Transport errors, cancellation, and unclassified failures are uncertain because Remote results fold carrier failures into `{ ok: false }`; the UI blocks resend. Once `prompt()` starts, it owns settlement of the submission echo and the caller does not abandon it. The official upload service has no receipt-discard operation; canceling after a successful upload can retain the staged receipt until Session disposal, and the durable attachment remains unreferenced.

## Alternatives considered

- **Modify the official composer or file-reference codec:** rejected because the existing picker, drag-and-drop, and `@` paths retain their current semantics.
- **Add a core prompt or upload API:** rejected because the public upload, Session-retention, echo, and prompt methods already support this independent action.
- **Send multiple files in one dialog:** deferred because partial upload failure can leave successful receipts staged without an admitted prompt.

## Consequences

The action submits one file and required text to the current Session; it does not alter the default composer. Prompt acceptance remains owned by the official Session API. A transport failure can leave admission uncertain, so the feature requires the user to inspect the conversation before any later send. Successful uploads canceled before admission remain scoped to the Session until the official service retires them or the Session ends.

## Verification

Focused tests verify one upload followed by one logged text-and-file prompt, explicit retry after a whitelisted business refusal without another upload, no duplicate retry after resolved or thrown uncertain transport, and cancellation after upload before echo creation.
