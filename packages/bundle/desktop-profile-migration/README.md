---
description: "Optional profile bundle that offers existing Desktop profiles an explicit choice of installed feature bundles."
kind: "package-bundle"
---

# @deepseek-ai/dsh-desktop-profile-migration-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle adds a Settings page where an existing Desktop profile can choose installed feature bundles to enable. It preserves the profile's current selections, including selections no longer offered by the current app. It does not migrate old configuration values or credentials. It is installed and enabled explicitly; it is not included in shipped profile defaults and it does not install feature packages.

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

Install `@deepseek-ai/dsh-desktop-profile-migration-bundle` into a Desktop profile through Plugin Manager or `dsh plugin --profile <name> add @deepseek-ai/dsh-desktop-profile-migration-bundle`, then enable it from the profile's Plugins page.

The **Settings > Plugins > Desktop migration** page lists candidate packages already installed in the profile. Select a subset and confirm to enable those bundles through the official Plugin Manager. Keeping the current selection or closing the page does not change bundle choices. The list is limited to supported Desktop feature additions; Firecrawl requires a separate external-service credential, while configuration backup is a separate maintenance bundle. Install either separately through Plugin Manager when needed.

<a id="understand-the-implementation"></a>
## Understand the implementation

The tarball contains the migration Host Remote, its generated Typert descriptors, the Settings Client, and one profile patch. The patch inserts only this optional bundle; business candidates are never added automatically. The Client applies each selected bundle separately, re-reads the saved profile after a failure, and writes a completion marker only after every chosen operation succeeds.

<a id="further-exploration"></a>
## Further Exploration

- [Profile composition](../../../docs/architecture.md#profiles-and-bundles) — profile bundle installation and selection.

<a id="model-experience"></a>
## Model Experience

None, as the migration page changes profile bundle selection only and adds no model context or Session content.

#### KV Cache effect

No model request context is added or changed.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- Candidate feature packages must be installed in the profile first; this page only enables installed bundles. It does not import settings, credentials, or other profile data.
- Enabling is sequential, not atomic. If an operation fails, earlier successful selections remain and the page reports the current profile state for retry.
- A Plugin Manager result may require an application restart before the selected bundle is active.
- This page is available only in a Desktop profile.

<a id="dev-note"></a>
### Dev Note

This package publishes Host and Client together so a profile installation does not depend on private split packages.
