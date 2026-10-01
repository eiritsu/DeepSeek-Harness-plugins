# Agent Note: Optional turn-process shimmer renderer

Status: implemented

English | [中文](2026-09-26-turn-process-shimmer.zh.md)

## Problem

The rc2 running-turn label has no shimmer, while the frozen client stylesheet records a distinct brand-blue moving highlight. Restoring that treatment in `ui-chat` or a default profile would make an optional visual preference affect the official client.

## Decision

An independent Client plugin replaces the `conversation.chat.node` keyed renderer registered as `turn-process`. It adds a CSS text shimmer only while the owning turn is running and retains the official label state, duration, disclosure, click, aria, and localization behavior. Reduced-motion users receive a static brand-blue label. The plugin is not part of the default profile or shipped Web bundle.

## Alternatives considered

- **Change the official `ui-chat` renderer:** rejected because it would make an optional visual treatment the default and modify an official package.
- **Copy the frozen component structure:** rejected because the frozen version is only a visual reference and does not own rc2's current slot and interaction behavior.
- **Register a separate renderer beside the official key:** unavailable because the keyed slot has one renderer per key; replacement is the supported registration behavior.

## Consequences

The plugin has a small local copy of duration and disclosure helpers to avoid a runtime dependency on another feature plugin. Consumers must opt in and ensure the plugin loads after the official renderer. Slot replacement means the official renderer is no longer selected for that key while the plugin is active; focused tests pin the retained behavior and presentation.
