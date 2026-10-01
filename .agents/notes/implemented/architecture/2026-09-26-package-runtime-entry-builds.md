# Agent Note: Build package runtime entries from TypeScript output

Status: implemented

English | [中文](2026-09-26-package-runtime-entry-builds.zh.md)

## Problem

Workspace source and its declaration output can contain a new public export while the package's published `lib/*.js` entry remains from an older build. A consumer's named ESM import then fails during module linking, before Cordis can activate the package or advertise its client module.

## Decision

Every workspace package that publishes root runtime entries defines a package-local `tsdown.config.ts` for those entries. The root build first emits TypeScript under `lib/types`, then tsdown creates the files named by `package.json` exports and `files`. The workspace package config includes both its root and invariant entry when both are published.

Desktop's packaged runtime smoke checks Host readiness injections for the session controller and its Web UI rows; this catches a failed Host module link as a missing Web boot entry. The ESM import from the rebuilt API Session Controller is also checked against the newly emitted workspace package entry.

## Alternatives considered

**Manually copy or edit emitted JavaScript.** Rejected because generated runtime code must come from the TypeScript project output, and a later build would overwrite the manual repair.

**Trust package manifests or profile bundle rows as evidence of activation.** Rejected because neither proves that Node can link the package's runtime exports.

## Consequences

The repository build refreshes the workspace package runtime entry before release packing. A stale entry can no longer hide behind valid source types, bundle metadata, or a profile patch; the prepared Desktop smoke also checks the downstream Web entry graph.
