---
description: "Standalone optional bundle for browsing and installing community plugin packages."
kind: "package-bundle"
---

# dsh-community-plugin-catalog

English | [中文](README.zh.md)

## Summary

This optional bundle adds a community plugin directory to a Web or Desktop UI profile. It is not selected by default. The catalog and its Host Remote ship in one package; Install passes the selected package spec to the official Plugin Manager dialog, which handles confirmation and installation. An installed package stays disabled until the owner enables it.

Install this bundle through Plugin Manager or `dsh plugin --profile <name> add @deepseek-ai/dsh-community-plugin-catalog`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Add the bundle to a Web or Desktop UI profile when its users need community plugin discovery; both surfaces load the same Web Client. A profile without the Web Client runtime, such as `headless` or `acp`, does not load the bundle.

The bundle's Host Remote reads the public DeepSeek Harness plugin catalog. It passes search, category, sort, page, and limit filters to the site's API and returns current listings and category metadata. Install text is untrusted: the Host reduces it to one supported npm or GitHub package spec, drops unsupported values, and requires a GitHub target to match the listing's repository. The Client passes the normalized spec to the official Plugin Manager, whose dialog requires the user's confirmation.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `endpoint` | `https://deepseek1024.com/api/v2/plugins` | HTTPS catalog API URL |
| `timeoutMs` | `15000` | Request timeout from 1000 through 60000 milliseconds |
| `maxResponseBytes` | `2097152` | Response limit from 1024 through 8388608 bytes |

<a id="understand-the-implementation"></a>
## Understand the implementation

The patch inserts one bundle row. Its package contains the Host catalog Remote and a dynamic Web Client. The Remote accepts listing links only when they use HTTPS on `github.com`, validates one install target per row, matches GitHub targets to the displayed repository, and enforces the configured response byte limit before parsing JSON. The Client opens the official Plugin Manager dialog with the normalized spec; that dialog owns confirmation, build-script approval, cancellation, compatibility checks, and installation. A successful install remains disabled until the profile owner enables it.

<a id="further-exploration"></a>
## Further Exploration

- [Plugin Manager](../../boot/plugin-manager/README.md) — package installation and profile lifecycle.

<a id="dev-note"></a>
### Dev Note

None.

<a id="model-experience"></a>
## Model Experience

### Browser-only directory

#### What the model sees

The bundle changes no model-visible instructions, tool schemas, or `Session` content for the `Agent`.

#### Token effect

None; the directory is browser-only.

#### KV Cache effect

None; the bundle does not change model request context.

## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

<a id="known-limitations-and-deferred-work"></a>

- The bundle requires a Web or Desktop UI profile and network access to the community catalog API; a profile without the Web Client runtime, such as `headless` or `acp`, cannot load it.
- Catalog inspection and installation do not audit the package's source code or install scripts.
