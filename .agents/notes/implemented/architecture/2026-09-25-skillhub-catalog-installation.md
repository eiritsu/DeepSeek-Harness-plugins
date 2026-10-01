# Agent Note: SkillHub Skill Installation

Status: implemented

English | [中文](2026-09-25-skillhub-catalog-installation.zh.md)

## Problem

SkillHub is a separate skill directory, while installed skills are discovered and activated by the official skill registry and filesystem provider.

## Decision

The opt-in `dsh-skillhub-catalog` Host Remote consumes SkillHub's catalog, detail, file inventory, and exact-version ZIP download API. It streams the ZIP to private staging, validates `_meta.json`, archive paths and CRCs, and checks every inventoried file's size and SHA-256 before replacing an existing skill. The caller must explicitly confirm the exact version. The official filesystem provider remains the authority for installed skill discovery and loading.

SkillHub's catalog listing supplies a namespace-qualified `canonicalName`, but its documented detail and file routes accept only slugs. The Remote verifies that a slug currently has exactly one listing and that its `canonicalName` matches before reading detail, before fetching files, and again before committing the downloaded tree. A duplicate slug, missing identity, or returned canonical-name mismatch stops the operation; the listing row remains visible. Install directories use the URI-encoded canonical name so separate publishers cannot replace one another's directory. The Remote does not infer ownership of pre-existing bare-slug directories and leaves them unchanged.

The installer does not execute package managers or install plugins. The API's 1 MiB file limit applies only to file previews; installation uses the exact-version ZIP endpoint. Configurable local budgets limit compressed bytes, expanded bytes, archive entries, installed files, metadata bytes, and download time. Redirects must remain credential-free HTTPS and resolve exclusively to public IP addresses. Cancellation stops work before directory commit, and Host disposal waits for active installs to clean their staging. Concurrent installs for one canonical identity are rejected. If the new directory commits but old-backup cleanup fails, installation remains successful and the result includes the retained backup path.

The Plugins → Skills page lists non-hidden direct child directories in the configured global DSH skill root only when `SKILL.md` is a regular file. Removal accepts only a listed direct-child name, requires explicit confirmation, rechecks the root and skill file, then removes that directory. Project roots, `~/.agents`, flat Markdown files, and bundled skills stay outside this operation. The view reads the filesystem and keeps no second installed-skill registry.

## Alternatives considered

**Reuse the Tencent `@tencent/skillhub` installer.** Its exposed Host functions are model tools rather than a reusable catalog Remote, and its installation implementation does not provide the required bounded, rollback-safe transaction.

**Install the catalog skill through the plugin manager.** SkillHub skills belong to the official local skill root and are discovered by the official skill filesystem; they are not plugins.

**Let the Client write directly into the skill root.** The Host owns filesystem access and performs validation and staging so browser code cannot bypass those checks.

**Manage every provider result through `ctx.skills`.** That registry merges project, user, bundled, and non-filesystem providers; its catalog entries do not identify one global directory that the Host can safely remove.

## Consequences

The optional directory can install skills whose archives and expanded content fit the configured local budgets; file size is not constrained by the preview endpoint's 1 MiB cap. A failed download or staging operation leaves the prior directory untouched. An old backup that could not be removed remains at the returned path for inspection or manual cleanup; the new version is already present in the configured skill root. The official skill filesystem owns skill discovery and activation; the Plugins page adds a confirmed removal action for directory skills in the global DSH root without indexing other providers or roots.

## Testing

`packages/bundle/community-skill-catalog/tests/egress.spec.ts` covers installation from an exact-version ZIP containing a file larger than 1 MiB, inventory hash mismatch and invalid archive rejection without replacing an existing skill, configured budget rejection, and Host disposal waiting for canceled stream cleanup. The same tests exercise catalog identity checks and proxy routing. `packages/bundle/community-skill-catalog/tests/catalog.host.spec.ts` covers replacement rollback, retained backups, installed-skill enumeration, and confirmed removal. Client tests cover exact-version install confirmation, removal acknowledgement, and the Plugins page composition.
