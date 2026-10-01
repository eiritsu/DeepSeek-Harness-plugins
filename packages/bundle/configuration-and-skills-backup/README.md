---
description: "A standalone profile bundle that exports active non-secret plugin configuration, selected bundle names, and explicitly chosen physical skill directories for users restoring a profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-configuration-and-skills-backup

English | [中文](README.zh.md)

## Summary

This optional bundle exports active plugin configuration without credential values, selected bundle names, and explicitly chosen physical skill directories. Install it into a profile through Plugin Manager or `dsh plugin`; it is not part of a shipped profile default. Import previews conflicts and applies confirmed items independently, with a journal for retry. The archive contains no Session data.

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

### Install into a profile

Install `@deepseek-ai/dsh-configuration-and-skills-backup` through Plugin Manager or `dsh plugin --profile <name> add @deepseek-ai/dsh-configuration-and-skills-backup`, then enable its bundle. Disable or remove it from the same profile when it is no longer needed.

### What you get

The bundle's Plugins detail page exports the non-secret overrides of active plugins, currently selected bundle names, and only skill roots selected in the export form. The import preview lists each setting, bundle, and skill file as ready, identical, conflicting, missing, or unsupported. Identical and unsupported items are grouped in collapsed sections; unsupported values remain visible there. The user selects which ready or conflicting items to apply and maps archived skill roots to physical destination roots.

The importer applies items independently. A failure does not undo successful items; the result journal records each item, and retrying an archive is safe for hash-verified skill files and bundle selection. Replacing a skill file keeps the old file beside it with a `.previous` suffix. Configuration, bundle selection, and skill destinations remain unchanged until the user confirms an import item.

### Convert an old configuration backup

The converter also maps only `ui-settings.enabled` and the seven current-schema-validated onboarding fields in `ui-settings-account`; account contact settings and unknown fields remain pending.

The repository also provides an offline converter for explicitly selected copies of a legacy `cordis.patch.yml`, `settings.yaml`, and optional credentials YAML. Run it from a checkout; it does not scan `~/.dsh`, write a profile, install packages, or apply credentials:

```sh
pnpm --filter @deepseek-ai/dsh-configuration-and-skills-backup migrate:legacy-config -- --patch /path/to/copy/cordis.patch.yml --settings /path/to/copy/settings.yaml --credentials /path/to/copy/credentials.yaml --output-dir /tmp/dsh-migration-output
```

The output directory must not already exist. Import `dsh-configuration-and-skills-backup-v1.json` from that directory through this bundle's Plugins detail page. Review `migration-report.json` for fields held back. The converter maps current `llm-pi-ai` route fields (`apiKeyEnv`, display name, protocol, base URL, model list/overrides, and supported route defaults) plus model ids and capability fields. It maps `agent-default-model` provider, model, and reasoning effort, the old `ui-onboarding.welcomeNoticeVersion` acknowledgement, and only the exact `enabled`/`allowedModels` fields of `subagent-model-selection-settings`. The subagent row uses its current Config entry name, `@deepseek-ai/dsh-tool-subagent/model-selection-settings`, so the importer can match the active row. If a current `ui-settings-general` patch row already exists, the old onboarding alias remains pending rather than backfilling it. Subagent routes are copied only as non-empty provider/model pairs; an enabled selection without a valid non-empty route list remains pending. Headers, compatibility overrides, retry and transport tuning, and other fields outside this conversion set remain pending. Permission and Agent preset selections remain pending unless an explicit reviewed selection context proves a matching current target. When present, `credentials-to-review.yaml` is separate from the import archive and contains sensitive values; inspect it privately and enter needed credentials through the official credential settings. The converter does not apply it.

The legacy patch is authoritative for a plugin present in both inputs; legacy settings fill only plugin ids absent from the patch. Fields omitted from a patch row are not restored from settings. Unsupported or invalid fields appear in the report but are not copied, so retain the selected source files for review. Credential reference names can remain in converted config; their values are only written to the separate private credentials file. An optional `--selection-context FILE` supplies an explicitly reviewed current permission table and preset roster; the converter still requires matching semantics.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package registers an authenticated profile route and one localized Plugins detail page. It uses the active ConfigEditor rows and their loaded Config schemas, the official secret redactor, Plugin Manager bundle operations, and Node filesystem access for explicitly selected skill roots. Its patch inserts one Host row; the same tarball contains the Client page.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Profile composition](../../../docs/architecture.md#profiles-and-bundles) — bundle ordering and profile ownership.
- [Plugin settings](../../settings/README.md) — schema-backed configuration and secret fields.

-----

<a id="model-experience"></a>
## Model Experience

None, as the bundle transfers configuration and skill files without adding model input or Session content.

#### KV Cache effect

No model request context is added or changed.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The archive includes active plugin overrides whose loaded Config schemas can account for their values. Empty overrides have no content to restore and are omitted. Non-empty overrides without an available schema are listed as unsupported; their values are not dynamically loaded or copied.
- Credential values marked `secret` by the schema are redacted. Credential references remain, but fields without a schema secret marker cannot be identified as credentials.
- Skill roots are derived from active skill-filesystem configuration and shown without absolute paths. The user explicitly selects roots. Symbolic links, special files, unsafe paths, oversized files, and overlapping roots are rejected.
- Bundle names are restored only when the package is already installed and available in the destination profile. The backup does not install packages.
- Import is not atomic across configuration, bundle selection, and skill files. Successful items remain applied if another item fails.
- The archive excludes Sessions, attachment data, account state, and credential values.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
