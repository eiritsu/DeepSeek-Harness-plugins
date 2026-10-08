# Agent Note: SkillsMP GitHub Skill Installation

Status: implemented

English | [中文](2026-10-08-skillsmp-github-immutable-installation.zh.md)

## Problem

An optional skill directory needs to let users inspect community skills and install the exact files they reviewed while the official skill filesystem remains the authority for activation and discovery.

## Decision

The `@deepseek-ai/dsh-community-skill-catalog` bundle provides the `skillsMpCatalog` Host Remote. Its package name and `community-skill-catalog` Cordis row ID identify the same opt-in bundle. Search requires a non-empty query and retains a bounded, expiring page cache; detail accepts only a GitHub URL retained in the separate bounded source LRU.

Search-page results expire after `cacheTtlMs`. The Host separately retains source identities and reviewed manifests in bounded LRU maps keyed by `maxCacheEntries`; these entries survive search-page expiry until eviction or Host disposal. A detail request accepts a retained SkillsMP search result, POSTs its `skillId` and SkillsMP page URL to the token endpoint, then uses the returned target to request a source manifest. The Host requires the target owner and repository to match the search result's GitHub URL. For `/tree/<ref>/<path>` URLs, the target branch segments and path segments must match the entire URL tail; repository-root URLs require an empty target path. No ref splitting is guessed.

The Host validates the manifest commit SHA, complete-download flags, file count, per-file and total sizes, safe unique paths, and exact canonical raw URLs before downloading content. It reads every file at the manifest's raw URL, computes its Git blob SHA, and returns the root `SKILL.md` text for review. Installation rereads those same reviewed raw URLs and verifies the recorded size and blob SHA; it does not request a new token, manifest, branch, or tree. Before replacing an existing directory, the Host stages files under `.skillsmp` and asks the official `FileSystemSkillProvider` to list and load the staged skill. It commits only when the provider returns exactly one candidate and a definition. The transport accepts credential-free HTTPS requests only to `https://skillsmp.com` and `https://raw.githubusercontent.com`; it rejects every redirect. Direct requests resolve and pin public addresses. For those two origins only, it also accepts DNS answers in `198.18.0.0/15` for TUN routing while keeping the original hostname for TLS. A configured proxy route skips local origin DNS and uses the proxy's resolution. The optional SkillsMP credential is sent only to search. A short-lived download token is held in memory and sent only to the SkillsMP manifest endpoint; raw requests receive no credentials.

The taxonomy Remote reads localized category and occupation records from the SkillsMP docs page, occupations page, and leaf-groups endpoint. It validates category domains, occupation parent links, and complete level-four leaf coverage before caching the result. Locale maps, occupation-page anchors, and leaf labels supply localized names; missing group labels use the source's English name. The bounded metadata cache defaults to one hour, and `forceRefresh` bypasses it. Taxonomy requests do not resolve or send the SkillsMP search credential.

Installation stages files under `.skillsmp`, then atomically replaces the skill directory and retains the previous directory if replacement cleanup fails. Cancellation waits for install cleanup; Host disposal aborts and waits for active installs. Existing installed skill directories and `.skillhub` data stay in place; listing and confirmed removal continue to cover direct child directories with a regular `SKILL.md`. The catalog installs and lists at `skillRoot`; if that path is outside the official provider's default roots, configure the same path in `skill-filesystem.customSkillDirs` for agent discovery and loading. The catalog does not activate a skill by itself or execute downloaded files.

## Alternatives considered

**Keep SkillHub as a fallback.** A second catalog and release path would retain obsolete ZIP-specific configuration and leave callers with two incompatible review and installation identities.

**Download a repository archive or clone.** That transfers files outside the selected skill directory and does not give the Host a bounded per-file Git blob inventory before staging.

**Trust the Client's metadata or write files from the Client.** The Host keeps search identity, commit selection, file verification, filesystem policy, and transaction ownership together; a browser-supplied SHA or file list is not installation authority.

**Manage the install through `ctx.skills` or the plugin manager.** Those registries include providers and package types beyond direct directories in the global DSH skill root, while this operation must remove only a confirmed direct child directory.

## Consequences

SkillsMP search and source downloads can be rate limited or temporarily unavailable. The SkillsMP web download endpoints have no stability guarantee; response changes fail closed and the bundle has no GitHub API fallback. The manifest protocol caps a skill at 100 files, 512000 bytes per file, and 5242880 total bytes; Host configuration can lower those limits. The search-page TTL does not expire source identities or reviewed manifests. Those records remain available in bounded Host LRU maps until eviction or disposal; an evicted source requires a new search, and an evicted manifest requires a new detail review.

`packages/bundle/community-skill-catalog/tests/catalog.host.spec.ts` boots the real Loader composition and checks manifest validation, commit pinning, staged provider validation, install replacement, and filesystem effects. `packages/bundle/community-skill-catalog/tests/taxonomy.host.spec.ts` checks localized RSC parsing, hierarchy validation, cache refresh, and zero-count leaf groups. `packages/bundle/community-skill-catalog/tests/egress.spec.ts` mocks SkillsMP and raw GitHub HTTP while checking origin-scoped public-address and TUN DNS policy, proxy routing, token scoping, source statuses, and redirects. The opt-in directory has no session or model-visible effect.

## Related

The [upgrade guide](../../../../docs/upgrade-guide/v0.2.0-rc.2/skillsmp-skill-catalog/guide.md) lists the profile and Remote caller changes from v0.2.0-rc.2.

The [outbound proxy policy note](2026-08-27-outbound-proxy-policy.md) owns process-wide proxy routing.
