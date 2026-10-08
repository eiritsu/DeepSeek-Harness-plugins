---
kind: upgrade-guide
description: "The community skill catalog Remote changes from SkillHub releases to SkillsMP search and GitHub commit installation."
---

# The community skill catalog moves to SkillsMP and GitHub

English | [中文](guide.zh.md)

## Change

In v0.2.0-rc.2, `@deepseek-ai/dsh-community-skill-catalog` exposes the `skillHubCatalog` Remote for SkillHub search, version details, ZIP downloads, and installation. The next release exposes `skillsMpCatalog` for SkillsMP search and GitHub skill directories pinned to a reviewed 40-character commit SHA. The package name and `community-skill-catalog` Cordis row ID stay the same; custom callers of the Remote and profile rows with the old Host Config keys are affected.

Existing installed skill directories remain in place and continue to appear in the Plugins → Skills page. The new installer does not migrate or delete skill folders or `.skillhub` data; each installation still requires confirmation of the reviewed commit.

## Migration

1. Keep the `community-skill-catalog` row and package entry. Remove old Host Config keys `endpoint`, `downloadTimeoutMs`, `maxArchiveEntries`, `maxArchiveBytes`, and `maxMetadataBytes`; there is no SkillHub fallback or archive download.
2. If needed, set `skillsmpCredentialKey` to a DSH Credentials reference that contains the SkillsMP API key. The key is optional and is sent only to SkillsMP search requests. Source manifests use SkillsMP's web download endpoints and raw GitHub file URLs; there is no GitHub API credential or fallback. Tune `operationTimeoutMs`, `maxResponseBytes`, `maxFileBytes`, `maxFiles`, `maxTotalBytes`, `cacheTtlMs`, or `maxCacheEntries` within the manifest caps of 100 files, 512000 bytes per file, and 5242880 total bytes. `cacheTtlMs` applies to search pages; source identities and reviewed manifests stay in bounded LRU caches until eviction or Host disposal. Taxonomy metadata is cached for one hour by default; `metadataCacheTtlMs` changes that lifetime and `maxTaxonomyEntries` bounds the accepted taxonomy. The directory UI can refresh taxonomy on demand, which bypasses the cache.
3. Update Remote callers to search with a non-empty query, use `githubUrl` for `detail`, and pass the reviewed `commitSha` with `githubUrl` to `installSkill`. Configure a custom `skillRoot` at the same path in `skill-filesystem.customSkillDirs` when it is outside the official provider's default roots, so the agent can discover and load installed skills. SkillsMP's web download endpoint has no stability guarantee; format changes fail closed without a GitHub API fallback. Confirm that search and detail work and that the installation result reports the reviewed commit SHA.
