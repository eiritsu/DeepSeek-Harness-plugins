# Agent Note: Community catalog delegates installation to Plugin Manager

Status: implemented

English | [中文](2026-09-25-community-plugin-catalog.zh.md)

## Problem

The public community catalog publishes plugin metadata and command-like install strings, but a catalog browser must not acquire a second package-management path or treat community metadata as trusted code.

## Decision

The optional `dsh-community-plugin-catalog` package contains a read-only Host Remote and a Web sidebar overlay in one installable bundle. The Host bounds its HTTPS request and response size, forwards the site's live filters, and exposes only HTTPS GitHub repository links. It treats install text as untrusted data, reduces each value to one supported npm or GitHub spec, drops unsupported values, and requires a GitHub target to match the listing's repository. The Client passes that normalized spec to the official Plugin Manager dialog. The official install operation remains authoritative for inspection, compatibility checks, cancellation, package-manager work, and persistent install-script approval; a successful install stays disabled until the user enables it.

The official Plugin Manager remains authoritative for install behavior. Its Git handling validates the spec but does not audit a remote manifest. The catalog does not execute catalog-provided commands, grant build scripts without confirmation, or change a profile's default composition. This extends the [profile bundle composition decision](2026-08-05-profile-plugin-bundles.md) and [current-profile plugin management decision](2026-09-14-current-profile-plugin-management.md).

## Alternatives considered

**Execute the site's install command or maintain a separate package-manager implementation.** This gives remote metadata an execution path and duplicates package-manager policy and safety checks. The existing Plugin Manager Remote already owns those operations.

**Add the catalog to the shipped Web bundle.** The directory is community-maintained and not required for core use. An opt-in bundle keeps shipped profiles unchanged and lets profile owners choose the added network dependency.

## Consequences

Catalog discovery can fail independently without affecting the profile's existing plugins. A listing with an unsupported spec or a GitHub target that differs from its displayed repository is omitted. Supported specs receive the Plugin Manager's install checks and explicit user confirmation; users must not interpret that flow as source review or a GitHub manifest security audit.
