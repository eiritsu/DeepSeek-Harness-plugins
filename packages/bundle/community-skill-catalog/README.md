---
description: "Opt-in Web or Desktop UI profile bundle for SkillHub discovery and exact-version skill installation."
kind: "package-bundle"
---

# dsh-community-skill-catalog

English | [中文](README.zh.md)

## Summary

This optional bundle adds a SkillHub skills directory to the Web or Desktop UI sidebar. Users can search, filter, inspect file inventories, and explicitly confirm an exact version for installation. It is not selected by default.

Install this bundle through Plugin Manager or `dsh plugin --profile <name> add @deepseek-ai/dsh-community-skill-catalog`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Install the bundle in a Web or Desktop UI profile when its users need SkillHub skill discovery and local installation; both surfaces load the same Web Client. A profile without the Web Client runtime, such as `headless` or `acp`, does not load the bundle. Enable or disable it through the official Plugin Manager.

The bundle's Host Remote reads the SkillHub catalog and exposes validated listing, detail, and exact-version file inventory data. Installation requires explicit confirmation, downloads the version-pinned ZIP, validates its metadata and every inventoried file, then commits the complete tree to the configured skill root; the official skill filesystem discovers installed skills.

The **Plugins → Skills** page lists directory skills under the global DSH skill root that contain a regular `SKILL.md`. Removing one requires a checked confirmation and permanently deletes that directory; project skills, Agent skills under `~/.agents`, flat Markdown files, and bundled skills are outside this page.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | `https://api.skillhub.cn` | Credential-free HTTPS SkillHub API origin |
| `timeoutMs` | `15000` | Per-request deadline from 1000 through 60000 milliseconds |
| `downloadTimeoutMs` | `120000` | ZIP download deadline from 1000 through 2147483647 milliseconds |
| `maxResponseBytes` | `1048576` | Maximum catalog or detail JSON response size |
| `maxFiles` | `4096` | Maximum inventoried files per release |
| `maxArchiveEntries` | `8192` | Maximum ZIP file and directory entries |
| `maxArchiveBytes` | `134217728` | Maximum compressed ZIP size |
| `maxTotalBytes` | `536870912` | Maximum expanded release size, including container metadata |
| `maxMetadataBytes` | `1048576` | Maximum parsed `_meta.json` size |
| `skillRoot` | `<DSH_HOME>/skills` | Directory scanned by the official skill-filesystem provider |

ZIP and expanded-size values are local resource budgets, not SkillHub format limits. The API's 1 MiB per-file limit applies to file previews; installation uses the exact-version ZIP download route.

<a id="understand-the-implementation"></a>
## Understand the implementation

The patch inserts one Host entry and one dynamic Client entry from this package. The UI carries SkillHub's namespace-qualified canonical identity through detail confirmation and installation; the Host rejects a slug when SkillHub's slug-only detail and download APIs cannot resolve exactly one publisher. Installation downloads an exact-version ZIP and verifies the release metadata, archive paths, file inventory, sizes, CRC values, and SHA-256 values before replacing a skill directory. Typed identity failures have localized explanations and end the detail loading state. The official skill filesystem remains responsible for skill discovery and loading. The Plugins page contribution queries and removes only regular directory skills in the configured global DSH root; it does not manage other roots. The bundle does not install plugins or execute third-party commands.

<a id="dev-note"></a>
## Dev Note

See [the SkillHub installation Agent Note](../../../.agents/notes/implemented/architecture/2026-09-25-skillhub-catalog-installation.md).

<a id="model-experience"></a>
## Model Experience

None, as the bundle adds no Agent input, tool schema, or Session content.

#### KV Cache effect

No model request context is changed; SkillHub catalog results remain in the browser UI.

<a id="known-limitations-and-deferred-work"></a>

## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

- The bundle requires a Web or Desktop UI profile and network access to SkillHub; a profile without the Web Client runtime, such as `headless` or `acp`, cannot load it.
- Archive size, expanded size, ZIP entry count, and file count are configurable local resource budgets; they are not SkillHub format limits.
- Slug collisions remain in the listing, but SkillHub's documented detail and download routes do not accept namespace identity; collided skills cannot be installed until SkillHub provides an unambiguous API route.
- Existing skill directories created under a bare-slug path are not migrated or replaced because they do not record a publisher identity.
- Category options use non-empty values observed in results during this panel instance. Source options include All, Official, Community, and sources observed in those results; neither list is an exhaustive SkillHub index.
- Flat Markdown skills, project skills, Agent skills, and bundled skills are not listed or removable from the Skills page; the page only manages directories under the configured global DSH skill root.
