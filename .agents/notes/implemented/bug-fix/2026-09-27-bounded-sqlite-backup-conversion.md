# Agent Note: Bound offline SQLite Session backup conversion

Status: implemented

English | [中文](2026-09-27-bounded-sqlite-backup-conversion.zh.md)

## Problem

The explicit schema-2 SQLite converter loaded every metadata and event row before applying its Session-count limit. Its fixture omitted a protected system head and complete turn, so it could not establish that converted history survives a production Agent resume and a later persisted turn.

## Decision

The converter checks SQL Session and event counts plus the combined UTF-8 byte length of stored header and event JSON before retaining row records, reads event rows with an iterator, and accepts per-call row-count and `maxInputJsonBytes` bounds. The default input JSON limit is 256 MiB and is independent from expanded output limits; it does not promise an exact memory bound after JSON parsing. Source hashing streams from disk. Existing source-file, expanded-archive, per-log, per-image, and final ZIP limits remain independent.

The archive Settings page offers an explicit migration flow: the operator chooses a backup directory, one regular `.sqlite` file, and the matching attachment root through the Host directory picker. Conversion reads a private copy and neither checkpoints nor removes the source database's WAL/SHM sidecars. Conversion refusal occurs before Session writes; successful conversion enters the ordinary archive restore path, which reports per-item partial outcomes without claiming a cross-Session transaction.

The Host fixture uses synthetic schema-2 tables with complete V3 parent and child turns, a first system surface head, and content-addressed image and file objects. It restores through the archive importer, resumes the parent through the production AgentLoop with a scripted adapter, writes the next turn through JSONL persistence, and opens the committed history from a new context. Negative cases cover a missing child parent, invalid sequence density, WAL and SHM sidecars, malformed JSON, missing objects, and every configured limit including exact input JSON byte boundaries. Test contexts own and dispose their fibers before temporary roots are removed. No user profile or source database is read or changed.

## Alternatives considered

**Keep `.all()` and reject only after reading.** The configured Session limit would not bound rows already allocated by SQLite, and event result arrays would duplicate retained history.

**Stream directly from the selected database.** SQLite history restoration can create sidecars or alter source state. The converter continues to copy the explicitly selected closed database into a private temporary directory and verifies the source digest after conversion.

**Assert only that imported event JSON can be opened.** That misses a failure when production turn startup appends another system message and can falsely certify history that cannot resume. The test uses the production AgentLoop and JSONL provider instead.

## Consequences

Session and event counts fail before row materialization; event rows no longer create a second unbounded query array. The archive output remains buffered because the public API returns one complete ZIP byte array. Defaults and per-call overrides are documented in the [archive README](../../../../packages/session-query/session-archive/README.md). The frozen source schema, Session formats, and archive format remain unchanged.

## Verification

`node node_modules/vitest/vitest.mjs run packages/session-query/session-archive/tests/sqlite-backup.host.spec.ts` passes the converter fixtures and refusal cases. `node node_modules/typescript/bin/tsc -b packages/session-query/session-archive/tsconfig.host.json --pretty false` checks the shipped Host source.
