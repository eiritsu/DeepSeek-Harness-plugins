# Agent Note: Configuration and skills backup

Status: implemented

English | [中文](2026-09-27-configuration-and-skills-backup.zh.md)

## Problem

Users need to carry profile configuration and skill files between installations without placing credential values or Session data in a portable file. The feature must not make custom backup behavior part of the default profile or core runtime.

## Decision

The optional `@deepseek-ai/dsh-configuration-and-skills-backup` bundle owns a versioned JSON archive and a localized Settings section. It snapshots active ConfigEditor rows through their loaded schemas and the official `redactSecrets` helper, records selected bundle names, and reads only skill roots explicitly selected by the user. It rejects unknown configuration fields, unsupported schemas, symbolic links, special files, unsafe paths, overlapping roots, and files that exceed configured limits. Disabled plugin schemas are not dynamically imported; their configuration rows are reported as unsupported.

The archive retains credential references but not values marked `secret`. On import, the active destination schema must match the archived package identity. Existing destination secret values remain in place. Bundle selection uses the official PluginManager operation and never installs packages. Skill roots require an explicit destination mapping when their source ids are not present in the destination profile.

Import previews each item before writes. The user confirms selected ready or conflicting items. Each item applies independently and the profile-local journal is updated after each result. A later failure does not roll back successful items. Reimporting the same archive is safe for identical skill hashes and already-enabled bundles; replaced skill files retain their previous bytes beside the destination file.

## Alternatives considered

- **Add a core archive or restoration API:** rejected because the feature is optional and its filesystem behavior belongs to its own bundle; core does not need to own custom backup formats or writes.
- **Copy all profile YAML verbatim:** rejected because profile configuration may contain credentials and disabled plugin schemas are not loaded for safe interpretation.
- **Dynamically import disabled plugins to recover their schemas:** rejected because backup would execute code that the profile has not enabled.
- **Claim one transaction across configuration, bundles, and files:** rejected because the official editors and Node filesystem do not share a commit protocol; the journal reports partial outcomes instead.

## Consequences

The bundle does not archive Sessions, attachments, account state, or secret values. Fields without schema secret markers cannot be identified as credentials. Missing destination plugins and unknown schemas remain visible as unsupported items rather than being silently skipped. Import can leave a partially restored profile, and its journal supports inspection and retry rather than global rollback.

## Verification

Archive tests cover path traversal, duplicate paths, file-directory collisions, content hashes, archive and expanded-size limits, schema secret redaction, unknown fields, symlink roots, atomic file replacement, partial import, journal outcomes, retries, and symlinked profile-home rejection.
