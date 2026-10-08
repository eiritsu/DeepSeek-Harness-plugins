---
description: "An optional Web or Desktop profile bundle for searching SkillsMP, previewing skills, and installing a selected commit."
kind: "package-bundle"
---

# @deepseek-ai/dsh-community-skill-catalog

English | [中文](README.zh.md)

## Summary

This optional bundle adds a SkillsMP skill directory to Web and Desktop UI profiles. Search requires a task query; results can be filtered and previewed before installing the selected commit. The directory does not run skill files, and installed skills remain manageable in the Plugins page.

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

Install the bundle in a Web or Desktop UI profile when users need to find SkillsMP skills, preview their contents, and install a selected skill. Add or remove it through the official Plugin Manager, or run `dsh plugin --profile <name> add @deepseek-ai/dsh-community-skill-catalog` and the matching `remove` command. No shipped profile includes this optional bundle.

The sidebar directory searches non-empty task queries and supports localized category, occupation, content-language, and sort filters. Emptying the query box returns it to the opening state: the committed search, its results, and its notices are dropped, a search still running is cancelled and its late response ignored, and the common use cases return; editing a non-empty query searches only once submitted. The occupation field opens a menu anchored to it that drills from major group to occupation group to occupation, or searches the whole directory by name; the field then shows the chosen occupation's localized path while the filter carries its slug. The taxonomy can be refreshed on demand. Each result shows its author, content language, GitHub stars, and update date. Stars describe GitHub popularity and do not measure skill quality.

### SkillsMP credentials

Anonymous search uses SkillsMP's published request limit. To use an API key, set `skillsmpCredentialKey` to a DSH Credentials reference; the key is sent only to SkillsMP search requests. SkillsMP source manifests and GitHub-hosted raw skill files do not use this key.

### Host configuration

| Field | Default | Meaning |
|---|---|---|
| `skillsmpCredentialKey` | empty | Optional DSH Credentials reference for the SkillsMP API key |
| `timeoutMs` | `15000` | Deadline for one HTTP request in milliseconds |
| `operationTimeoutMs` | `120000` | Overall deadline for detail and install operations in milliseconds |
| `maxResponseBytes` | `1048576` | Limit for JSON responses |
| `maxFileBytes` | `512000` | Limit for one installed file; the manifest protocol caps files at 512000 bytes |
| `maxFiles` | `100` | Maximum files in one manifest |
| `maxTotalBytes` | `5242880` | Maximum total installed file size |
| `cacheTtlMs` | `300000` | Search result cache lifetime in milliseconds |
| `maxCacheEntries` | `100` | Maximum recent search pages, source identities, and reviewed manifests retained by Host |
| `metadataCacheTtlMs` | `3600000` | Taxonomy cache lifetime in milliseconds |
| `maxTaxonomyEntries` | `2048` | Maximum categories and occupations accepted from the taxonomy |
| `skillRoot` | `<DSH_HOME>/skills` | Directory used for installed skills |

Category and occupation filters use localized SkillsMP documentation, occupation-page labels, and leaf-group metadata. The occupation menu orders each level by its source SOC code and lists every leaf occupation, including the ones SkillsMP reports with zero skills; internal taxonomy nodes support search without appearing as duplicate choices. A drilled group's header commits that whole group instead of its occupations. The Host validates parent links and leaf coverage before caching a taxonomy; manual refresh bypasses the configured cache, which defaults to one hour. Taxonomy requests do not send the SkillsMP search API key. Search-page results expire after `cacheTtlMs`; source identities and reviewed manifests remain in bounded Host LRU caches until eviction or Host disposal.

A detail view links to the SkillsMP source page and the GitHub repository, and shows the manifest file inventory, commit SHA, and `SKILL.md` as plain text. Installation requires a separate confirmation that names the skill, commit, file count, and global DSH skills folder. The **Plugins → Skills** page lists installed directories containing `SKILL.md`; removal requires confirmation and permanently deletes the selected skill directory.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle patch inserts the Host plugin, which provides the `skillsMpCatalog` Remote, and a dynamic Client plugin for the Web UI. The Remote searches SkillsMP and resolves a selected skill through its SkillsMP source manifest; installation receives the manifest commit SHA. The same Remote lists and removes directories in the global skills root.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Inserts the optional Host plugin |
| [`src/index.ts`](src/index.ts) | Registers the Host plugin |
| [`src/client/index.ts`](src/client/index.ts) | Mounts the Remote and registers UI slots |
| [`src/client/SkillCatalogPanel.tsx`](src/client/SkillCatalogPanel.tsx) | Search, detail review, and install confirmation |
| [`src/client/InstalledSkillsPage.tsx`](src/client/InstalledSkillsPage.tsx) | Lists and removes installed global skills |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read the [bundle package map](../README.md) for the other installable profile layers.

See the [SkillsMP GitHub installation note](../../../.agents/notes/implemented/architecture/2026-10-08-skillsmp-github-immutable-installation.md) for the install, source validation, and outbound HTTPS policy.

-----

<a id="model-experience"></a>
## Model Experience

None, as the directory is Client UI only and does not add Agent input, tools, or Session content.

#### KV Cache effect

No model request context is changed.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The bundle requires a Web or Desktop UI profile and network access to SkillsMP and GitHub. Search uses SkillsMP and has no SkillHub or local catalog fallback.
- The Host sends HTTPS requests only to SkillsMP and GitHub raw content, and rejects every redirect. The optional SkillsMP API key is used for search only. Direct requests pin DNS results and reject non-public addresses except `198.18.0.0/15`, which is allowed only for these origins to support TUN DNS. A configured proxy resolves the origin without local DNS lookup.
- Anonymous SkillsMP search is subject to the provider's published rate limits. Search does not run until a non-empty query is submitted.
- The Host rejects incomplete SkillsMP manifests and cannot install files omitted by the source's manifest limits.
- SkillsMP's web download endpoints do not have a stability guarantee. If their response format changes, source review and installation fail closed; the bundle has no GitHub API or other source fallback.
- Stars are provider metadata and are not an assessment of skill quality or safety.
- Existing SkillHub-installed directories remain in the global skills root and stay manageable; switching the catalog does not migrate, reinstall, or change their files.
- `skillRoot` controls installation, listing, and removal. If a custom root is outside the official skill-filesystem roots, configure the same path in `skill-filesystem.customSkillDirs` for the agent to discover and load installed skills. The catalog can list an installation without making it available to the agent.
- The installed skill manager covers directories in the configured global DSH skills root; it does not manage project skills or Agent skills.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
