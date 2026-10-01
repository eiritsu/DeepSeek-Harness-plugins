# Agent Note: Optional Office attachment extraction

Status: implemented

English | [中文](2026-09-25-office-attachment-extraction.zh.md)

## Problem

Office and scanned PDF attachments need locally extracted text in the model-visible user content, while uploads must remain durable and replayable. Audio and video attachments also need optional configured recognition. The repository has no file-recognizer registry in this release, and workspace `@file` references are path mentions rather than uploaded FileBlocks.

## Decision

The optional `file-recognizer-office` profile layer uses the existing `agent/pre-step` waterfall to extract text from uploaded FileBlocks before the Agent loop logs the admitted batch. The transformed `user/message` retains the original FileBlock and appends the extracted text, so replay has both the source reference and the exact text used by the model. Office and searchable PDF extraction run locally; scanned PDF OCR, audio transcription, and video understanding use separate optional endpoints and credentials. This uses the documented Agent extension point; it does not add a core recognizer registry. The [generic-file-upload decision](2026-08-26-generic-file-upload.md) owns durable FileBlock admission, while the [interception extension-points note](2026-06-30-interception-extension-points.md) owns loop timing.

Workspace `@file` references remain path mention text and do not enter this attachment parser. In rc2, `ctx.fileReferences` discovers paths but does not read content, and `agent/pre-step` receives admitted messages without an authorized resolver for Workspace references. Treating a mention like an uploaded file needs an upstream Agent-scoped API that validates the selected reference against the active Workspace authorization, returns bounded content or a read receipt, and lets Agent admission log the resolved content with the user message. The plugin does not interpret arbitrary prompt text as a path. Remote OCR, audio, and video requests are opt-in; their keys are written and resolved through the credentials capability, never stored in plugin Config.

## Alternatives considered

**Add a core attachment recognizer registry.** Rejected because `agent/pre-step` already admits a complete message batch before it is logged, so the optional behavior can live in a plugin without changing core or introducing another registry contract.

**Resolve workspace `@file` mentions as attachments inside this plugin.** Rejected because the extension API does not provide authorized content resolution for a selected reference. Parsing prompt text for paths would bypass Workspace authorization and durable upload admission.

## Consequences

The feature stays opt-in and affects uploaded FileBlocks only. Successful extraction is persisted in the same user event as its source reference; changing parser settings affects only later messages. Remote OCR, audio, and video require configured endpoints, use HTTPS except for loopback HTTP, and send page images or media outside the Host process. Ambiguous media containers are routed by filename extension because FileAttachmentRef does not retain MIME type.

## Verification

Host tests exercise DOCX extraction, audio multipart transcription, and video `video_url` requests through the Agent loop, then check that text and the original FileBlock share one admitted user event. Settings tests save and reopen all endpoints and model ids while verifying that OCR, audio, and video keys remain absent from client state.
