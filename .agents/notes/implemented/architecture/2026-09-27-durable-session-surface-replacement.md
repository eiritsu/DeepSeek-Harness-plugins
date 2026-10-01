# Agent Note: Durable Session surface replacement operations

Status: implemented

English | [中文](2026-09-27-durable-session-surface-replacement.zh.md)

## Problem

Replacing model-visible history through an in-memory queue cannot distinguish a committed prompt from work that may already have reached an external model. It can also race ordinary inbox mutations and replay an uncertain request after restart.

## Decision

`Agent.replaceSurface()` records a request in the Session log and flushes it before the loop admits replacement work. The loop reserves Inbox mutation for the operation, then commits the replacement as a `user/message` whose `surfaceOp` and `sourceEventSeqs` identify the exact range. It flushes a `request-started` event before the first external model call and records one terminal outcome.

The `surfaceReplacement` projection folds those facts with the actual committed user message. A request without a prompt or start marker remains safe to start after recovery; a committed prompt with no start marker may resume without appending it again. A start marker without a terminal outcome is uncertain and is never replayed automatically. Reusing a request ID with the same payload is idempotent; reusing it with another payload is rejected.

The operation requires an idle Agent, an empty Inbox, and an exact current surface range. Callers own eligibility policy. The generic method does not establish that a range is the latest ordinary user turn, free of tool side effects, or suitable for a user-facing edit-and-resend action. The start marker prevents automatic duplicate calls, but it cannot guarantee exactly-once behavior for an external model service.

The first `agent/pre-step` for a replacement carries a `surfaceReplacement` field. Consumers may skip transformations whose results already appear in the persisted replacement message; policy listeners still run. The edit-and-resend bundle replaces only the first text block and carries later text blocks and attachments forward, so Office extraction is not discarded or repeated.

## Alternatives considered

- An in-memory pending replacement cannot survive restart or prove that the request was flushed.
- Replaying a started request after restart can duplicate an external call whose response was lost.
- A feature-specific Controller method would couple the Agent API to one user interface instead of exposing the Session-level operation.

## Consequences

`dsh-agent` owns the request and Session event types. `dsh-agent-loop` owns synchronous Inbox reservation, the durable projection, request admission, flush ordering, and recovery status. The Session event map and generated persistence catalog describe the three operation events. A future UI plugin must separately enforce its product eligibility rules and explain uncertain operations to the user.
