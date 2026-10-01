---
description: "Keep Desktop sessions in one SQLite database instead of JSONL files, through the Desktop profile's own layer."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-desktop-app

English | [中文](README.zh.md)

## Summary

This bundle is the third patch layer of the Desktop profile, applied after `dsh-base` and `dsh-web-app`. It moves session persistence from the JSONL files every shipped profile writes to a single SQLite database under the Desktop home, and it is the only layer that does so. No other shipped profile selects it, so web, headless, ACP, SDK, and minimal profiles keep their JSONL logs.

## Table of Contents

- [Understand this package](#understand-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="understand-this-package"></a>
## Understand this package

The Electron application selects this bundle through the `desktop` profile template. A stock Desktop profile that still names the retired `[dsh-base, dsh-web-app]` tuple is rewritten to the current template when the application prepares a release, so an existing installation gains the SQLite database without a manual edit. A profile with any other bundle list — a custom order, a third-party bundle, or a different tuple — is left byte-for-byte unchanged.

The `dsh` launcher refuses `dsh --profile desktop`: the Desktop profile's package project and lifecycle belong to the Electron application, and the published `dsh` CLI cannot resolve this bundle. Use the Electron application to serve this profile.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch disables the base `session-persistence-jsonl` row and inserts `session-persistence-sqlite` in the same layer. Both backends register `ctx.sessionPersistence`, so the two rows must be changed together; disabling JSONL anywhere else would leave the profile with two providers or none.

| File | Role |
|---|---|
| [cordis.patch.yml](cordis.patch.yml) | The JSONL disable and the SQLite insert. |
| [src/index.ts](src/index.ts) | Declared patch-bundle entry. |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [SQLite persistence](../../session/session-persistence-sqlite/README.md) — the schema, migrations, and query surface.
- [Profile bundles](../../bundle/README.md) — profile layers and their owners.

<a id="model-experience"></a>
## Model Experience

None, as the bundle changes where session records are stored, not what the model reads or writes.

#### KV Cache effect

None. No prompt text, tool definition, or message content changes when this bundle is added or removed.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

- The patch disables the JSONL row unconditionally. Adding this bundle to a profile that already has another `ctx.sessionPersistence` provider leaves that profile with two providers.
- Existing JSONL session logs are not migrated into the SQLite database; the Desktop application starts reading the Desktop database and leaves the JSONL files in place.
- The `desktop` template is not reachable from the `dsh` CLI, so a profile carrying this bundle can only be served by the Electron application.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package is a public experimental package rather than a release member under `packages/bundle/`, because the `desktop` template selects it and a release member that a shipped template selects cannot use the optional-bundle exception. The private `apps/desktop-host` package declares it as a runtime dependency, which is what carries it into the packaged Electron closure.

</details>
