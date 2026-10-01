---
description: "SQLite Session persistence for opt-in deployments that need one authoritative database."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-persistence-sqlite

English | [中文](README.zh.md)

## Summary

This provider stores Session headers and event rows in one SQLite database. Appends update event rows and listing metadata in one durable transaction. It is opt-in and does not replace the JSONL provider in any shipped profile.

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

Mount this provider after the Session service and give it the path of one authoritative database.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-persistence-sqlite'
  config:
    path: /absolute/path/to/sessions.sqlite
```

| Field | Default | Meaning |
|---|---|---|
| `path` | required | SQLite database file; `:memory:` is intended for tests |

The provider creates the current schema only in an empty, unversioned database. It refuses unknown layouts and future schema versions. Session headers and events must use the current logical Session format; unknown required event types fail closed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

SQLite uses WAL mode, `synchronous=FULL`, foreign keys, contiguous event sequence keys, and monotonic `PRAGMA user_version`. Writer leases are stored in the database so a different process cannot append to the same Session concurrently; abandoned leases are reclaimed only after their recorded process exits.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session persistence service](../session-persistence/README.md)
- [JSONL provider](../session-persistence-jsonl/README.md)

-----

<a id="model-experience"></a>
## Model Experience

### Resumed conversation history

#### What the model sees

SQLite contributes no prompt text. A resumed lifecycle restores the same validated current-format `SessionEvent` history as another conforming persistence provider.

#### Token effect

Zero live-request tokens beyond the restored conversation history and current request envelope.

#### KV Cache effect

Storage choice does not change request prefixes. Cache reuse depends on reconstructed history, the current envelope, and the selected model route.

## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

<a id="known-limitations-and-deferred-work"></a>

- The provider does not migrate an existing non-SQLite store or import JSONL files.
- Writer lease liveness is host-local because it uses process IDs; place the database on a local filesystem shared by processes on the same host.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
