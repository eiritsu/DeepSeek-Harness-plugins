# Agent Note: Optional feature integrations remain independent profile bundles

Status: implemented

English | [中文](2026-09-26-independent-feature-profile-bundles.zh.md)

## Problem

Optional product extensions need to be testable and removable independently while preserving the official Web profile as their foundation.

## Decision

Lark with its Settings Client, Firecrawl, the community catalogs, Office recognition, Copy Session ID, turn-process shimmer, Session archive, and Desktop migration remain independently installable bundles; Lark starts with its Host row disabled and Firecrawl inserts only its Host tool because the official Web tool presenter already renders tool results. The official Cua Driver native provider is composed by a separate opt-in package that is installed into a profile explicitly; it stays out of app runtime dependencies and shipped optional bundle lists because it loads native code in the Host process and can operate the launching application's desktop. Fresh Desktop profiles select only the model catalog after `dsh-base` and `dsh-web-app`. Web and other profile templates remain unchanged, and profile initialization never replaces an existing `package.json`, so upgrades preserve saved bundle choices. No custom integration is injected into an existing profile automatically; a separately installed migration bundle can offer explicit choices. Plugin Manager can disable each selected bundle; installation-owned package files remain in the application resources.

`scripts/optional-feature-bundles.spec.ts` parses each bundle patch, checks each inserted package is a direct dependency, and verifies independent and combined composition over the official Web layers.

## Alternatives considered

- **Put all extensions in one bundle:** rejected because users could not independently enable or remove features, and a bundle requiring Lark credentials would also install unrelated UI behavior.
- **Insert the rows into the shipped Web profile:** rejected because the official baseline must stay free of optional integrations and cosmetic replacements.
- **Add a Firecrawl Client presenter:** rejected because the official Web tool UI already presents the Host tool's calls and results.
- **Enable native CUA in a default profile:** rejected because mounting the provider initializes native desktop access inside the Host and expands the model's available desktop-control tools.

## Consequences

- A clean custom Web profile can install and toggle each feature bundle independently without changing the shipped Web profile template.
- Fresh Desktop profiles select model metadata; other self-developed features require explicit profile installation and selection.
- Desktop recovery still returns to the baseline Web bundles and does not re-enable independent feature bundles.
- The Lark Settings Client and Host plugin travel together, while the Host remains inactive until explicitly enabled.
- Firecrawl uses the same tool presentation as other official Web tools; it does not create a second results UI.

## Verification

`pnpm exec vitest run scripts/optional-feature-bundles.spec.ts` verifies patch parsing, dependencies, independent inclusion, and combined composition. `pnpm run verify-translation-pairing --write` maintains the bilingual README and Agent Note pairs.
