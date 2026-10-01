# Agent Note: Lark private-chat Host ingress

Status: implemented

English | [中文](2026-09-25-lark-private-chat-host.zh.md)

## Problem

Operators need one authorized Lark or Feishu private chat to create durable Harness Agent turns without allowing arbitrary senders or losing message identity after restart.

## Decision

`@deepseek-ai/dsh-lark-integration` is an opt-in Host and Client bundle. Its Host uses the maintained Lark Channel long connection and resolves the configured app secret through `ctx.credentials`. The Typert Loader registers its generated `./typert` contribution with the Host entry; a direct plugin mount registers it only when the Loader has not already done so. Quick connect registers an app through the official channel SDK; existing-app setup accepts an app identity and write-only secret. Both use the official device-code authorization for the current user. The Host keeps device codes in credentials, accepts only official account origins, reads the authorized user's Open ID from official CLI status, and writes it through `configEditor` before reporting success. App registration has a validated configurable deadline. The Host accepts only that user's private-chat Open ID, derives a stable Session ID from the application and chat, resumes persisted Sessions, and checks the Lark message ids already recorded in the Session before submitting a platform message again. Incoming images and files become attachment references; assistant text and images are replied to the source message. Cordis effect cleanup stops ingress, drains accepted work, disconnects the Channel, and disposes owned Agent handles.

The bundle's Client contributes its configuration to the bundle's own page on the official Plugin Manager, under the `plugins.bundle.config` slot keyed by the package name, while the Host config row is served. It edits ordinary settings through the shared Settings form and writes app secrets through the credentials Remote; saved secrets are never read back. Setup operations call the bundle-owned `larkSetup` Remote methods, and the `larkStatus` stream carries Host registration and configuration writes. The page distinguishes the three states the Host can report: an unfinished user authorization reads as a pending step, while a missing credential or a failed long connection reads as an error. The link that leaves for the official authorization page is the primary action and confirming afterwards is secondary, so the required step is the one that carries the emphasis. The three controls share the `Button` control metrics — box model, gap, 36px height, radius, type, and inline padding — and take their natural width from their labels, because a row of mismatched controls reads as three unrelated links. Cancelling discards a half-finished authorization, so it keeps the `outline` shape in the error token rather than the neutral one. The page's stylesheet names only `--dsw-alias-*` design tokens; a token outside that namespace silently drops the declaration and leaves the control looking like plain text. The optional model-facing CLI remains disabled by default and requires approval except for its exact read-only allowlist. The frozen private CLI launcher and its separate persistence format are not retained; authorization uses the official CLI package through `ctx.subprocess`.

The existing Session snapshot harness starts ACP scenarios and cannot inject Lark Channel events; bridge and Cordis composition tests therefore do not establish a recorded Lark model turn. A supported single-profile snapshot injection extension requires a separate harness decision. A candidate is an input step in the existing snapshot suite paired with an in-process fake Channel provider supplied only by the shipped profile's scenario overlay; it must not add a second CLI entry point or a production test-only switch.

## Alternatives considered

- **Retain the frozen private CLI launcher and direct device-code persistence** — rejected because it bypasses current Host credential and ConfigEditor APIs. The shipped bundle instead uses the official CLI package only through `ctx.subprocess` and writes accepted identity through `configEditor`.
- **Use only in-memory duplicate tracking** — rejected because a restart would permit a previously persisted platform message to create another Session turn.
- **Add a second snapshot command or scenario executable** — rejected because snapshot owners must start through `dsh` with a shipped profile; a separate entry point would bypass that contract.

## Consequences

Host transport, registration/authorization orchestration, and Settings credential handling can be tested without a real Lark account or secret, while production activation remains explicitly configured and opt-in. Session identity and deduplication survive process restarts through existing Session persistence. The bundle authorizes one current user for private chat; group chat, multiple authorized users, permission administration, and Lark-specific model-visible replay remain uncovered.
