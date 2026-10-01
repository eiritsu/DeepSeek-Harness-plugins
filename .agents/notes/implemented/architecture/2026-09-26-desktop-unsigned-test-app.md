# Agent Note: Isolated unsigned macOS test application

Status: implemented

English | [中文](2026-09-26-desktop-unsigned-test-app.zh.md)

## Problem

Local GUI qualification needs a macOS application that can coexist with a release installation without using release signing credentials or the user's normal application identity.

## Decision

`package-target.ts --unsigned-test --dir` accepts only the macOS arm64 target and uses the fixed `com.deepseek.harness.unsignedtest` bundle ID and `DeepSeeK Harness` product name. Electron `extraMetadata.version` is fixed at `0.1.22` for this test mode only; the bundled dsh runtime keeps and independently verifies its manifest version. The packaging run record and smoke output label both versions separately. It excludes signing and upload credentials and `DSH_HOME`, stores mutable build state and output under the target's `unsigned-test` directory, skips signing, notarization, updates, and release completion records, and runs the packaged-runtime smoke. The normal product name, bundle ID, output paths, and signing flow remain unchanged.

The mode reads `.env.macos` only to obtain non-secret packaging configuration such as update-policy origins and the package registry; its child environment filters signing and upload fields. It does not install or launch the application into `/Applications` or a user profile.

## Alternatives considered

**Reuse the regular macOS bundle ID with ad-hoc signing:** rejected because the test app could replace or share identity with an installed release.

**Disable signing through the release packaging options:** rejected because it would expose a way to produce release-named artifacts without the release signing and notarization guarantees.

## Consequences

The test app has a separate macOS identity and build directory, but uses the normal packaged runtime assembly and smoke checks. The command still requires a local `.env.macos` file for non-secret settings. GUI launch and profile-isolation behavior require manual acceptance with the eventual test artifact.

## Verification

Focused packaging tests cover option restrictions, environment scrubbing, target path isolation, the separate test App and runtime versions, package configuration, and stage selection. Actual packaging is deferred until migrated plugin wiring is stable.
