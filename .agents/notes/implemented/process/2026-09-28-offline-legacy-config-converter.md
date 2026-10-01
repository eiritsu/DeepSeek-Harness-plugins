# Agent Note: Offline legacy configuration converter

Status: implemented

English | [中文](2026-09-28-offline-legacy-config-converter.zh.md)

## Problem

Legacy profile configuration has fields that cannot be safely mapped by matching names alone. Users need a reviewable path into the current backup importer without scanning or changing a live profile.

## Decision

The converter also maps only `ui-settings.enabled` and seven current-schema-validated `ui-settings-account` onboarding fields; account contact settings and unknown fields remain pending.

The repository-owned converter reads only explicitly selected legacy input files and writes a version-1 archive accepted by the optional Configuration and Skills Backup bundle. It never scans a profile, installs a package, or applies converted configuration. The user imports the archive through the bundle's existing preview and confirmation flow.

The old patch is authoritative for an id it contains; settings fill only ids absent from the patch. The converter maps the current pi-ai provider route/model fields, the default provider/model/effort selection, the old welcome acknowledgement, and the exact subagent model-selection fields. A current general-settings patch row takes precedence over the old onboarding alias. The subagent archive row carries the exact current Config entry name, including its `/model-selection-settings` export. Subagent routes must be non-empty provider/model pairs, and an enabled selection without routes remains pending. Fields outside that explicit set remain out of the archive and appear in a value-free report. Permission and preset selections remain pending unless an explicitly reviewed current selection context proves matching semantics. Credential material is written only to a separate private review file, never the archive or report; applying credentials remains a user operation through official settings.

## Alternatives considered

**Import legacy YAML directly into a profile:** rejected because it would bypass current schema validation and could restore disabled or unknown plugin configuration.

**Treat matching preset names as equivalent:** rejected because a preset id does not prove equivalent permissions or agent composition.

**Put credentials in the backup archive:** rejected because archive files are portable and credential values must remain outside them.

## Consequences

The tool is run from a repository checkout against user-selected copies. It does not read `~/.dsh` or write a profile. Unknown values remain available only in the original selected files; the report records their ids, field names, and fixed reasons without copying their values. Credential review output is separate and must be handled privately.

## Verification

Synthetic Node tests exercise source priority, selection holdback, archive compatibility fields, secret separation, and output file permissions. No real profile or credential file is used.
