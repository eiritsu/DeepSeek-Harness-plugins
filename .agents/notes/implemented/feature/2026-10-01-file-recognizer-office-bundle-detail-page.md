# Agent Note: File-recognizer-office bundle detail page

Status: implemented

English | [中文](2026-10-01-file-recognizer-office-bundle-detail-page.zh.md)

## Problem

The optional `@deepseek-ai/dsh-file-recognizer-office` package exposed its parser limits, OCR / audio / video endpoints, and credential badges through a standalone `settings.section` registration with id `file-recognizer-office`. The official Plugin Manager detail page for the same package listed the package and its components, but the editable controls only appeared on the standalone Files section, so users had to leave the Plugins page to edit them. Other opt-in bundles (`lark-integration`, `tools-connections`, `configuration-and-skills-backup`) already register their editable fields under the keyed `plugins.bundle.config` slot keyed by package name, so the Plugin Manager renders them on the bundle's own page.

## Decision

`@deepseek-ai/dsh-file-recognizer-office` moves its Client registration from `settings.section` to `plugins.bundle.config` keyed by `@deepseek-ai/dsh-file-recognizer-office`. The renderer keeps the same `OfficeRecognitionCard` component, the same `OfficeRecognitionCardController`, and the same `ctx.configForms.whileServed([OFFICE_RECOGNITION_NS], ...)` gate that other bundles use, so a deployment that has the row active still sees every parser and recognition control on the bundle's Plugins detail page. The Host plugin entry, the Host `apply` function, the credential references, the composer `nativeFileUploadPolicies` registration, and the credential invalidation listener are unchanged. The `Settings` sidebar section is no longer contributed by this package; the Plugins detail page supplies the same editor surface. The `dsh.client.inject` declaration adds `@deepseek-ai/dsh-client-ui-plugin-manager` so the Client bundle resolves the keyed-slot render path, and the Client tsconfig references the package's `tsconfig.client.json`. The README and bilingual docs now point at the bundle's Plugins detail page rather than the standalone Files section.

## Alternatives considered

**Keep the standalone Files section and add a non-actionable stub to `plugins.bundle.config`.** Rejected because it duplicates the editor and the credential badges, breaks the visual contract shared with other bundles, and leaves users toggling between the Plugins page and a separate Settings sidebar section for the same fields.

**Reuse the `settings.section` slot from a separate package.** Rejected because the standalone Files section has no consumer outside this bundle, and shipping a separate settings package would re-introduce the same `ui-settings-*` coupling the existing `cordis.patch.yml` already rejected for this archive.

## Consequences

The bundle detail page now exposes every editable field and credential badge that the standalone Files section used to host. The Plugin Manager list and detail pages own the entry as they already do for `lark-integration`, `tools-connections`, and `configuration-and-skills-backup`. Composer file intake for Office, PDF, and configured media still uses `ctx.nativeFileUploadPolicies`. Any installation that depended on the standalone Files section sees the editor under Plugins → this bundle → its detail page, not under the Settings sidebar. Settings persistence, Host Config validation, and the recorded-session snapshot of `user/message` admission are unaffected.
