---
description: "Add the official Cua Driver native computer-use provider to a profile through an explicit optional layer."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-computer-use-cua-native

English | [中文](README.zh.md)

## Summary

This optional layer adds the official computer-use service and Cua Driver native provider to a Web profile. No shipped profile includes it. Enable it only when the launching application has the required desktop permissions and the profile should expose desktop-control tools to the model.

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

### Install into a profile

Add or remove this bundle with the official Plugin Manager or the profile command:

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-computer-use-cua-native
dsh plugin --profile <name> remove @deepseek-ai/dsh-experimental-computer-use-cua-native
```

The bundle is available from the dsh installation in Desktop profiles. Adding it inserts the service and provider rows; removing or disabling it removes those rows from the profile composition.

### What you get

The official `computerUse` service and native Cua Driver provider expose the upstream driver's discovered tools. The provider owns native runtime initialization and desktop operations; this bundle adds no UI, settings page, or permission grant.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch inserts the `computer-use` service before `computer-use-cua-driver-native`. Its package dependencies make both rows available to profile resolution and include the provider in the Desktop package closure. The provider remains unchanged and initializes the native SDK only when the profile row is enabled.

| File | Role |
|---|---|
| [cordis.patch.yml](cordis.patch.yml) | The two optional Host rows. |
| [src/index.ts](src/index.ts) | Declared patch-bundle entry. |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Native provider](../computer-use-cua-driver-native/README.md) — host permissions, platform limits, and model-visible tools.
- [Profile bundles](../../bundle/README.md) — optional profile layers and their owners.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the inserted provider, which adds discovered Cua Driver tool definitions and fixed computer-use guidance while enabled.

#### KV Cache effect

The provider's tool catalog and guidance affect requests only while the provider row is enabled.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

- The provider shares the Host process and requires desktop access granted to the application that launches dsh.
- Native optional dependencies are selected by the package manager for its target platform; this repository validates only the current build host unless a platform-specific package smoke is run.
- Adding the bundle does not itself prompt for or grant operating-system permissions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
