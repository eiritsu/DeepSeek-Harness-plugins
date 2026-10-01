# Agent Note: Provider-neutral Session archives

Status: implemented

English | [中文](2026-09-26-provider-neutral-session-archives.zh.md)

## Problem

Users need to move complete Session history between installations without replacing a provider's database file or relying on private provider layouts. Session logs can reference immutable image and file objects that must travel with the log.

## Decision

The optional `session-archive` package writes a versioned ZIP containing current V4 Session JSONL, a manifest with byte counts and SHA-256 digests, and all referenced attachments. It uses public Session persistence and attachment services, validates the entire archive before writes, preserves Session IDs, and rejects conflicts. The package is enabled only through an opt-in profile overlay. It does not include plugin configuration or secrets.

Import uses the public `saveImage` and `saveFileStream` operations and verifies that each produces the archived immutable reference before creating any Session. Each archive fingerprint has a cross-process journal lock; Session writes remain independent and are never rolled back. A later failure can leave verified attachments or earlier Sessions in place, and the journal reports those outcomes for retry.

After each Session write, import resolves an existing Workspace by the header's canonical `cwd` and calls its public `attachSession` operation. Workspace attachment has its own journal outcome and retry path because the registry does not rebuild its accounted Session IDs after import. Missing `cwd`, directory, or Workspace leaves the Session unassigned; import never creates a directory or Workspace.

The importer reads entries from the ZIP central directory, stages them with bounded streams, and checks expanded sizes and CRCs. Stored attachments that contain ZIP data remain one outer entry.

## Alternatives considered

**Copy or replace the v0.1.21 SQLite file.** Rejected because that file is not the rc2 persistence contract and would bypass provider APIs and schema ownership.

**Archive Session logs without referenced attachments.** Rejected because those logs would retain unresolved attachment references and could not be described as full Session archives.

**Enable the feature in the default Web profile.** Rejected because Session archive UI and routes are opt-in extensions, not official default behavior.

## Consequences

Destination attachment providers must reproduce archived references exactly through their normal save operations. The export stream enforces compressed-archive, per-Session log, and per-image limits; the import path also enforces expanded-size limits. Import is not atomic across attachments or Sessions. Plugin and Skill settings require a separate configuration backup feature.
