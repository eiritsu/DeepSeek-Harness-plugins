# Agent Note: Provider-neutral model metadata

Status: implemented

English | [中文](2026-09-25-model-metadata-catalog.zh.md)

## Problem

Model metadata from models.dev must enrich adapter capabilities without confusing a local provider route with the upstream model identity or claiming transport support that the catalog does not describe.

## Decision

The opt-in `dsh-model-catalog` bundle contributes models.dev facts through an effect-scoped resolver on `dsh-llm`. Identity uses an exact canonical model id and known upstream owner; when the owner is absent, an exact provider API endpoint may disambiguate declarations. Local route names do not define identity.

The catalog also registers an effect-scoped synchronous snapshot resolver over its last-good in-memory cache. Request measurement can read cached modalities without network I/O; disabling or unloading the catalog withdraws this source. DeepSeek keeps `maxOutputTokens` as a model capability ceiling separate from its configured request default: omitted caps are bounded by both, while explicit caps above capacity fail before provider I/O.

Adapter profile facts take precedence. The pi-ai adapter applies catalog reasoning levels to the exact descriptor used for dispatch and preserves declared wire spellings. The catalog cannot establish endpoint transport support, so unsupported transport parameters remain runtime errors.

Ambiguous records contribute only intersecting explicit list facts and conservative capacity values. Missing input or reasoning declarations are unknown and do not erase another provider's explicit facts. Explicit input lists intersect only with other explicit lists; an empty supported intersection remains empty. `reasoning: false` and an explicit empty effort-value list deny all standard levels; an empty `reasoning_options` list makes no effort declaration. Parsing, cache persistence, and metadata resolution retain nonempty source-declared effort IDs, including provider-specific IDs. The runtime leaves those claims to adapters, which expose only identifiers their configured route can execute; pi-ai uses its six SDK levels, while DeepSeek Messages uses `low`, `high`, and `max`. The generic runtime fallback is defined in the [runtime metadata note](2026-09-28-runtime-model-metadata-fallback.md). The persisted snapshot records its source URL. Only a snapshot for the configured URL can satisfy the refresh interval; changing the URL forces a refresh, and an old snapshot remains last-good but is not relabeled fresh if that request fails. Earlier snapshots without a source URL remain readable and are refreshed. The client lists Default and effort levels supported by the exact selected model; a persisted level missing from current metadata remains visible as a disabled historical row and cannot be resubmitted.

## Alternatives considered

**Infer identity from local route names or partial endpoint matches.** These values do not establish the upstream model identity and can select unrelated declarations; the resolver therefore uses exact model IDs and only uses an exact provider API endpoint to disambiguate when owner identity is absent.

**Treat catalog metadata as proof of transport support or offer provider-specific IDs as choices.** The catalog does not describe endpoint transport capability, and a source declaration does not prove that an adapter can encode that ID; adapters own transport and effort execution while the catalog preserves source declarations.

## Consequences

The resolver can enrich model capabilities without taking ownership of adapter routes or transport behavior. Ambiguous catalog records remain conservative, and network refresh failure leaves the last successful metadata available.
