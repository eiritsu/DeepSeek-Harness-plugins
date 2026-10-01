---
description: "Provider-neutral export and restore of complete durable Sessions with their referenced attachments."
kind: "package-bundle"
---

# session-archive

English | [中文](README.zh.md)

## Summary

`session-archive` exports and restores durable Sessions through public persistence and attachment services. V1 stores current V4 JSONL, a SHA-256 manifest, and referenced attachments; restore validates before writing, preserves IDs, and rejects conflicts. An explicit offline converter accepts frozen Desktop schema-2, Session-v3 SQLite backups plus an explicit attachment root, producing the same archive without writing to a destination provider. This archive is logical data, not a SQLite copy, and excludes plugin or Skill settings, credentials, and secrets.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Installation

This is an independent optional bundle. Install it in a profile through Plugin Manager or `dsh plugin --profile <name> add @deepseek-ai/dsh-session-archive`, then enable or disable it from the profile's Plugins page. Its bundle patch mounts Session archive controls on this bundle's Plugins detail page and registers the authenticated `/api/session.archive`, `/api/session.archive/sqlite-backups`, and `/api/session.archive/sqlite-import` routes.

### Transfer limits

| Config | Default | Meaning |
|---|---:|---|
| `compressionLevel` | `6` | ZIP compression level, from 0 through 9 |
| `maxArchiveBytes` | `256 MiB` | Maximum compressed archive size accepted for import or produced by export |
| `maxExpandedBytes` | `1 GiB` | Maximum total expanded import size |
| `maxSessionLogBytes` | `128 MiB` | Maximum size of one Session log |
| `maxImageAttachmentBytes` | `16 MiB` | Maximum size of one image attachment accepted for import or included in export |
| `maxSourceBytes` | `1 GiB` | Maximum SQLite source file size accepted by offline conversion |
| `maxSessionCount` | `10,000` | Maximum Sessions accepted by offline conversion |
| `maxEventCount` | `1,000,000` | Maximum event rows accepted by offline conversion |
| `maxInputJsonBytes` | `256 MiB` | Maximum combined stored header and event JSON text accepted by offline conversion |

### Offline SQLite conversion

The explicit converter has separate source and row-count caps in addition to the archive byte limits.

| Limit | Default |
|---|---:|
| `maxSourceBytes` | `1 GiB` |
| `maxSessionCount` | `10,000` |
| `maxEventCount` | `1,000,000` |
| `maxInputJsonBytes` | `256 MiB` |
| `maxExpandedBytes` | `1 GiB` |
| `maxArchiveBytes` | `256 MiB` |
| `maxSessionLogBytes` | `128 MiB` |
| `maxImageAttachmentBytes` | `16 MiB` |

The converter checks Session and event row counts plus the combined UTF-8 byte length of header and event JSON text before retaining row records, iterates event rows, and refuses SQLite files with WAL or SHM sidecars. `maxInputJsonBytes` bounds stored JSON text; it is separate from output expansion limits and does not promise an exact bound on memory used by decoded objects. The limits can be overridden per call with `SqliteBackupArchiveLimits`.

The bundle's Plugins detail page also offers an explicit legacy Desktop import. Choose the directory containing the backup, select one regular `.sqlite` file, then choose its attachment root. The importer reads a private copy and leaves the selected database and any `-wal` or `-shm` sidecars unchanged; it never checkpoints or removes them. It accepts frozen schema-2 backups with Session-v3 headers and only converts histories that can safely continue. Unsupported histories, WAL/SHM sidecars, and missing or invalid attachments are rejected before Session writes. After conversion, the regular archive restore reports per-item failures; partial imports remain partial and can be retried through the archive journal.

File attachments use the public `saveFileStream` operation; images use `saveImage`. Before any Session is written, the importer verifies that these normal save operations reproduce every archived reference exactly. If image normalization or provider behavior changes a reference, import stops before Session creation; already saved content-addressed objects may remain unreachable until provider retention cleanup.

### Restore behavior

Import preflights archive paths, ZIP structure, manifest entries, current Session format, digests, attachment references, and Session ID conflicts before modifying stores. It saves and verifies all attachments before importing Sessions. Each Session is created, appended with one complete event batch, flushed, and read back against the validated canonical Session content. A package-owned journal under `$DSH_HOME/session-archive/imports` records per-item progress and serializes imports of the same archive across processes; retry skips a Session only when its existing log matches that content. An incomplete existing Session is refused for manual provider-level recovery because the public persistence API has no archive-specific rollback. There is no cross-Session or cross-provider transaction; partial outcomes are reported and must not be treated as a completed import.

After a successful import request, the bundle detail page refreshes the Host-authoritative Session list so newly restored Sessions can appear without reopening the app. If that refresh fails, the page reports the import result separately and asks the user to reload the Session list; retrying the archive is not required for that refresh failure.

Identical archived IDs already present in the destination are rejected rather than merged or overwritten. Each successful import creates the archived logical Session records through the active provider APIs; it never replaces provider database files or translates older private schemas.

After import, the package attaches each Session to an already registered Workspace whose canonical path matches the Session header's `cwd`. The Workspace Registry does not rescan new Session headers, so the archive journal records attachment separately and retries it on a repeated import. A Session without `cwd`, a missing directory, or a directory without a registered Workspace remains imported but unassigned and makes the result partial; the importer never creates directories or Workspaces. Create or open the existing matching Workspace and retry, or assign a Session without `cwd` manually.

<a id="further-exploration"></a>
## Further Exploration

- [Session persistence API](../../session/session-persistence/README.md)
- [Local attachment provider](../../attachment/attachment-local/README.md)
- [Session archive format implementation](src/archive.ts)
- [Optional profile patch](cordis.patch.yml)

## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

<a id="known-limitations-and-deferred-work"></a>

These limits describe operational constraints of the archive and restore providers.

- **No cross-provider transaction** — content-addressed objects already saved before a later failure may remain unreachable; provider retention cleanup owns them. A Session write failure is never rolled back or silently retried.
- **Exact reference reproduction required** — providers that normalize an archived image to different bytes or metadata are rejected before any Session write.
- **Configuration backup is separate** — this archive contains Session logs and attachments only; plugin and Skill settings, credentials, and secrets are excluded.
- **Offline SQLite conversion is narrow** — only closed schema-2 backups containing supported Session-v3 histories are accepted; WAL sidecars, other database generations, missing or invalid attachments, and histories that cannot safely continue are rejected. Conversion requires an explicit Plugins page action or library call and never runs during startup.

<a id="dev-note"></a>
## Dev Note

The focused Host tests use temporary `DSH_HOME` roots and local JSONL and attachment providers. They never access a user's configured data directory.
