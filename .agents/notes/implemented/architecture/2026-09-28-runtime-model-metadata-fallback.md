# Agent Note: Runtime model metadata fallback

Status: implemented

English | [中文](2026-09-28-runtime-model-metadata-fallback.zh.md)

## Problem

Adapters that do not know about an external model catalog cannot use its facts even when the catalog is registered through the official LLM runtime API.

## Decision

The runtime resolves adapter metadata first, then asks registered external sources only when context capacity or input modalities are missing. Adapter values remain authoritative. It keys the lookup by exact provider route and model id, propagates operation cancellation, reuses a resolver result already requested by that adapter during the same operation, and ignores ordinary source failures so an optional catalog cannot disable an otherwise usable adapter. Invalid values and conflicting declarations from separate sources fail explicitly; a source that cannot identify one upstream model returns no metadata.

The generic runtime does not apply catalog `reasoningEfforts` or `maxOutputTokens` to executable call capability. An adapter must validate reasoning identifiers against its provider request implementation; an output ceiling needs an adapter-owned policy before it can constrain call configuration.

## Alternatives considered

**Require each adapter to call the resolver.** This keeps metadata policy with each adapter, but third-party adapters remain unaware of the official catalog API and duplicate the same integration work.

**Apply every catalog field to every adapter.** Catalog facts do not establish provider route executability. Treating reasoning identifiers or output limits as authoritative could expose unusable controls or reject calls the provider accepts.

## Consequences

Adapters can inherit verified context and input-modality fallbacks without changing their integration. Adapter metadata stays authoritative, while ambiguous external facts and invalid capacities cannot silently win by registration order. Generic resolution intentionally leaves reasoning and output-limit policy to adapters because the runtime lacks a provider-specific executable descriptor.
