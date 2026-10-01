# Agent Note: Native file uploads in the Conversation composer

Status: implemented

English | [中文](2026-09-27-composer-native-file-upload-policies.zh.md)

## Problem

Desktop file selection exposes a native path, so the standard composer treats non-image files as `@` references even when an installed feature owns a parser for that file type. A separate sender bypasses the composer attachment rail and its upload lifecycle.

## Decision

`ui-conversation` exposes an additive `nativeFileUploadPolicies` registry to Client plugins. Each registration receives the original `File` and accepts or declines it; any acceptance sends that file through the existing composer attachment queue. Directories, images, pathless files, and manual `@` input keep their existing routes. Duplicate registration ids fail, and effect disposal removes only the registration that created it.

DeepSeek-Files registers Office and PDF extensions unconditionally. It registers audio and video extensions only by reading the current accepted Host settings snapshot and requiring both endpoint and model. The native extension map is shared by Host extraction and Client intake. The standard picker, drop, paste, attachment cards, upload retry, removal, and send continue to be owned by the Conversation composer.

This Client API is a distribution addition and is not an unmodified upstream rc.2 extension point. A standalone Files package requires an application whose `ui-conversation` exports this registry; it has no separate-sender fallback.

## Alternatives considered

**Session-header sender:** rejected because it creates a second upload and submission lifecycle instead of adding files to the standard composer.

**Replace native paths with a cloned `File` or rewrite `@` handling:** rejected because it discards path identity or changes official reference semantics outside the parser's supported formats.

## Consequences

The `ui-conversation` Client surface gains one general opt-in registry, and applications must ship that version before this Files Client can route native paths as uploads. Unsupported paths and directory references remain available through existing behavior. Settings changes affect later file intake through the accepted ConfigForm snapshot; unsaved drafts do not alter routing.
