# Agent Note: Self-contained Desktop profile migration bundle

Status: implemented

English | [中文](2026-09-27-standalone-desktop-profile-migration.zh.md)

## Problem

The explicit migration page was packaged as a thin bundle depending on unpublished split Host and Client packages, so installing its tarball did not provide a complete feature-selection flow. The page is not an importer for old settings or credentials.

## Decision

`@deepseek-ai/dsh-desktop-profile-migration-bundle` contains its Host migration Remote, generated Typert graph, browser Settings Client, and profile patch in one optional package. The patch inserts only the migration plugin. The Client lists already installed candidates and enables each confirmed choice through the official Plugin Manager; profile selections are applied sequentially, re-read after failure, and never rolled back. The Host records completion only after the expected saved selection contains every chosen candidate. Existing and retired selections remain untouched.

The standalone build uses the official `WorkspaceTypertGenerator` against the package's Host face because the package's local TypeScript solution is not the workspace root consumed by the workspace-mode generator.

## Alternatives considered

- **Keep split Host and Client packages as runtime dependencies:** rejected because the migration bundle would not be installable from its tarball without publishing and installing both private packages.
- **Add migration methods to the shared Plugin Manager Remote:** rejected because the migration state and marker belong to this optional feature, while the official generic `setBundleEnabled` operation already applies each user's choice.
- **Enable candidate bundles automatically when the migration package is installed:** rejected because installation of the migration tool is not consent to enable any feature package.

## Consequences

The bundle can be installed and removed as one profile package without adding candidates to shipped defaults. Candidate packages still must be installed before selection. The curated list excludes Firecrawl, which requires a separate external-service credential, and the configuration backup utility, which can be installed separately. Partial enable failures retain successful operations and require the user to retry; this is not a multi-package transaction.

## Verification

Package face tests cover existing selection preservation, explicit completion, and sequential partial outcomes. The tarball smoke boots the packed Host entry through the official Loader in a temporary profile and checks that reading the offer leaves the profile manifest unchanged.
