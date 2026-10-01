---
description: "Canonical models.dev metadata for model resolution, refreshed on startup when this bundle is installed."
kind: "package-bundle"
---

# @deepseek-ai/dsh-model-catalog

English | [中文](README.zh.md)

## Summary

This profile bundle adds canonical model metadata from the public models.dev catalog to `dsh-llm`. Install it only in profiles that should refresh this catalog. Its Host refreshes catalog metadata over the network on startup and at the configured interval. It adds no model choices or selector; adapters own routes and transport behavior.

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

This is an optional package installed separately from the `dsh` application. The commands install or remove it in the selected profile from the configured package registry.

```text
dsh plugin --profile <name> add @deepseek-ai/dsh-model-catalog
dsh plugin --profile <name> remove @deepseek-ai/dsh-model-catalog
```

### What you get

The patch inserts the `model-catalog` row alongside the profile's existing `dsh-llm` and `dsh-storage-domain` rows. The bundle adds metadata resolution; it does not add model choices, a selector, or transport support.

The package declares `dsh-llm` and `dsh-storage-domain` as peers. A `dsh` profile resolves these shared services from its selected Bundle dependency graph, preserving the installation's service instances. Load the plugin through `dsh`; a bare Node import from an isolated package directory bypasses profile resolution and is not supported.

The plugin persists a bounded upstream snapshot with the URL that produced it, refreshes it after `refreshIntervalMs`, and keeps the last successful facts when a refresh fails. A changed `catalogURL` forces a refresh even when the previous URL's snapshot is less than one interval old; old facts remain available as last-good data but are not treated as fresh for the new source. Failed requests do not update the cached URL or timestamp. Responses with the wrong document format or no valid canonical records fail without replacing that snapshot. `catalogURL`, `requestTimeoutMs`, and `maxResponseBytes` configure the document source and resource limits. `modelMappings` explicitly maps a local model ID, optionally paired with `ownedBy`, to a qualified canonical ID such as `zhipuai/glm-5.3-flash` when a route uses an alias; duplicate case-insensitive mapping identities are rejected when the plugin activates.

The resolver first applies a configured `modelMappings` entry, then matches a case-insensitive qualified canonical ID, then accepts an unqualified ID only when its canonical basename is unique. Ambiguous basenames return no catalog metadata; declarations from different providers are never merged. Canonical model records supply input modalities and token limits, so third-party channels use the same canonical values without being narrowed by their own limits. Missing canonical fields remain unknown. Provider-specific reasoning levels are added only from the explicitly selected canonical namespace; `reasoning: false` and an explicitly empty effort declaration deny every standard level, while missing effort metadata remains unknown. `reasoning: true` alone does not imply support for every level.

Parsing, cache persistence, and metadata resolution retain valid source-declared effort IDs, including provider-specific IDs. The runtime does not treat these declarations as executable choices. Each adapter exposes only levels it can encode on its configured provider route; pi-ai accepts its standard six levels, while the DeepSeek Messages adapter accepts `low`, `high`, and `max`. Other declared IDs remain unavailable until an adapter implements and verifies their wire behavior. The catalog also contributes input modalities supported by the adapter and capacities. Explicit adapter profile facts take precedence. Metadata never triggers silent downgrade. Wire transport capability is owned by the adapter and cannot be established by models.dev alone.

<a id="understand-the-implementation"></a>
## Understand the implementation

The plugin stores canonical model records and namespace-scoped effort declarations in a bounded snapshot. The pi-ai adapter uses catalog fields only where its profile does not provide them. Explicit mappings preserve local aliases without treating route names or gateways as upstream identity.

<a id="further-exploration"></a>
## Further Exploration

- [LLM capability group](../README.md) — shared model-call service and provider adapters.
- [LLM package](../llm/README.md) — route resolution and request preparation.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the adapter resolving exact-model catalog metadata before request preparation.

#### KV Cache effect

The plugin adds no prompt text. Refreshed context capacity or reasoning metadata can change later request limits or provider options; the existing compaction and provider layers own their effects on reuse.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

- **Catalog metadata is advisory** — it is not a transport probe, and missing or conflicting facts remain unknown rather than being guessed.
- **Refresh can be stale** — a failed refresh retains last-good data and logs a warning; it does not disable existing metadata or prevent the plugin from mounting.
- **Canonical refresh is required after the cache-format change** — the earlier provider-shaped snapshot is not used for model resolution; if the canonical refresh fails, the resolver contributes no old-format metadata until a successful refresh stores a canonical snapshot.

<a id="dev-note"></a>
### Dev Note

Run `pnpm --filter @deepseek-ai/dsh-model-catalog run test:packed-artifact` to pack and extract this package, then import it through the profile runtime resolver. The smoke checks that `dsh-storage-domain` comes from the selected Bundle dependency graph rather than a package-local copy.
