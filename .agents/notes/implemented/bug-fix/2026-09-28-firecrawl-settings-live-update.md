# Agent Note: Make Firecrawl settings editable and live

Status: implemented

English | [中文](2026-09-28-firecrawl-settings-live-update.zh.md)

## Problem

The Tools & connections card exposed settings only for Brave and Tavily even though the bundle documented Firecrawl configuration. Firecrawl config values were volatile but copied once into the tool registration, so later saves did not change endpoint, limits, credential reference, or timeout.

## Decision

Expose Firecrawl enablement, credential reference and secret, endpoint, timeout, response-byte limit, and Markdown-code-point limit through the existing ConfigForms page. Keep API key text exclusively in the credentials service. On `loader/volatile-update`, dispose the current Firecrawl tool registration and register a replacement from the committed config values; this updates the registration-level timeout as well as execution settings.

## Consequences

Firecrawl settings take effect after save without remounting the bundle. Registration replacement uses the normal tool registry disposer, and bundle disposal removes the last active registration. The established volatile-config event and disposer lifetimes are described in the Loader documentation.

## Alternatives considered

**Apply settings only after remounting the bundle.** Rejected because saving the ConfigForms values would leave the registered tool using stale endpoint, limits, credential reference, and timeout.

**Read every setting during tool execution while keeping the registration.** Rejected because the tool registry captures its timeout at registration, so execution-time reads would leave timeout changes unapplied.

## Verification

`node node_modules/vitest/vitest.mjs run packages/bundle/tools-connections/tests/controller.client.spec.ts packages/bundle/tools-connections/tests/apply.client.spec.ts packages/bundle/tools-connections/tests/firecrawl.spec.ts` passes. Host and Client project references typecheck with `tsc -b`; `pnpm --filter @deepseek-ai/dsh-tools-connections run bundle` and `test:packed-artifact` verify both packed faces and the published Host entry through Cordis Loader. Translation pairing passes. Targeted Oxlint still reports existing diagnostics in controller and Firecrawl parsing/test lines.
