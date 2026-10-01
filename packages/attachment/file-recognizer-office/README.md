---
description: "A profile bundle for local Office attachment extraction and configurable scanned-PDF OCR."
kind: "package-bundle"
---

# @deepseek-ai/dsh-file-recognizer-office

English | [中文](README.zh.md)

## Summary

This profile bundle adds local text extraction for DOCX, PPTX, XLSX, and OpenDocument attachments. It also extracts existing PDF text locally and can send scanned PDF pages to a configured OCR endpoint. Optional audio transcription and video understanding use separate configured OpenAI-compatible endpoints. The same package archive contains the Host parser and its Files Settings Client. The original FileBlock stays in the logged user message, and extracted text is logged beside it. Remote recognition is disabled until its endpoint and model are configured.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### Install into a profile

Add the optional layer to a profile that already provides durable attachments and the Agent loop:

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-file-recognizer-office
dsh plugin --profile <name> remove @deepseek-ai/dsh-file-recognizer-office
```

The bundle resolves from the installed dsh packages or the configured npm registry. Its archive contains both the Host recognizer and the bundle detail page Client. Adding it inserts the Host row; the runtime loads the package's `./client` entry, which renders its editable fields on the bundle's Plugins detail page. Removing a profile-installed package withdraws the Host row.

### What you get

Office text is parsed on the Host before the admitted user message is logged. Searchable PDF text is extracted locally. A page without a text layer is a genuine capability gap, so it takes the route the turn's model can actually use: a model declaring image input receives the rendered page as an image and no OCR call happens, while a text-only model falls back to OCR when an endpoint and model are configured. Audio transcription and video understanding run only when their own endpoint and model are configured. While this Host plugin is active, the bundle's **Plugins detail page** edits parser limits and all recognition endpoints, models, and credentials through the same Shared Settings form every other bundle uses.

| Field | Default | Meaning |
|---|---|---|
| `maxInputBytes` | `33554432` | Maximum input bytes buffered for extraction. |
| `maxUncompressedBytes` | `134217728` | Maximum uncompressed bytes in one Office ZIP archive. |
| `maxZipEntries` | `4000` | Maximum entries in one Office ZIP archive. |
| `maxExtractedChars` | `200000` | Maximum extracted characters appended for one file. |
| `maxPdfPages` | `20` | Maximum PDF pages inspected for text or sent to OCR. |
| `maxPdfPagePixels` | `4000000` | Maximum raster pixels for one OCR page. |
| `maxPdfRenderScale` | `2` | Maximum PDF render scale for OCR. |
| `ocrEndpoint` | unset | OpenAI-compatible API base URL such as `https://host/v1`, or a full `/chat/completions` URL. A versioned base gets `/chat/completions` appended; a full operation URL is preserved. Unset disables OCR. HTTPS is required except for loopback hosts. |
| `ocrModel` | unset | Vision model id required with `ocrEndpoint`. |

The Settings page stores the OCR, audio, and video keys through `ctx.credentials` under `DSH_FILE_OFFICE_OCR_API_KEY`, `DSH_FILE_OFFICE_AUDIO_API_KEY`, and `DSH_FILE_OFFICE_VIDEO_API_KEY`; secrets do not enter the settings document or form response. The Host Config declaration is in [`src/index.ts`](src/index.ts).

The standard composer routes selected, dropped, and pasted DOCX, PPTX, XLSX, OpenDocument, and PDF files through its ordinary attachment rail. Audio and video extensions use that route only while the Host-accepted settings contain both an endpoint and model. The composer keeps its standard FileCard, progress, remove, retry, and send behavior. Manual `@` mentions, directories, images, and unrecognized native-path files retain their existing behavior.

This Client integration requires the `nativeFileUploadPolicies` API exported by this distribution's `@deepseek-ai/dsh-client-ui-conversation/client`; that API is not part of unmodified upstream rc.2. A standalone Files installation on an application without the API cannot route native-path files through the standard composer and does not install a separate sender as fallback.

Credentials are resolved when a remote recognition request runs. A configured endpoint does not make the local parser depend on the Credentials service during startup; if the service or its key is unavailable, only that remote request reports an error and the original attachment remains available.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host plugin uses `agent/pre-step` to inspect the claimed user messages. It reads durable bytes through `ctx.attachments.readFileStream()`, adds extraction as text to the same message, and retains the original FileBlock. The Agent loop then records both parts in its ordinary `user/message` event. A first-step surface replacement carries that admitted content forward and marks the pre-step payload so this plugin does not parse the same files again. A supported file that exceeds a limit, cannot be parsed, or needs unavailable OCR gets a visible explanation beside the retained FileBlock; unsupported extensions pass through unchanged.

Office ZIP archives are checked for entry count, expanded byte total, encrypted members, and unsafe member paths before parsing. The PDF path uses PDF.js to extract page text and rasterize pages below the text threshold. Only those page images are sent to the configured OCR URL; each request resolves the credential reference at call time. Audio attachments use multipart `audio/transcriptions` requests. Video attachments are sent as `video_url` content to `chat/completions`.

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | Config validation, archive checks, text extraction, and the Agent lifecycle listener. |
| [`cordis.patch.yml`](cordis.patch.yml) | Optional Host row; the package also exports its bundled `./client` entry. |
| — | No runtime invariant companion is published; the plugin owns no separately observable registry relationship. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Attachment subsystem](../../../docs/subsystems/attachment.md) — durable FileBlock storage and upload receipts.
- [Agent package](../../core/agent/README.md) — the `agent/pre-step` event and admitted message batch.
- [Settings forms](../../client/ui-settings/README.md) — persisted plugin Config forms and UI slots.
- [Office conversion](../../document/office-to-pdf/README.md) — local Office-to-PDF conversion for preview workflows.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `user/message` content admitted by the Agent loop. Files added through the standard composer are submitted with the ordinary Session prompt. When extraction succeeds, that admitted message contains the original FileBlock and a text block beginning with `[Extracted from <filename>]`; a PDF extraction labels each included page. Preprocessing failures add a visible explanation to that message while retaining the original file handle.

#### KV Cache effect

Extraction adds logged user content to the request before its first model call and can increase token use according to document content. The extracted text stays stable for replay because it is part of the admitted message; changing parser settings affects later messages only.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Legacy Office formats are not parsed** — `.doc`, `.xls`, and `.ppt` remain available as file attachments but need another reader.
- **Media recognition requires explicit endpoints** — audio transcription and video understanding use user-configured services and send uploaded media outside the Host process.
- **OCR requires a configured remote vision endpoint** — only scanned PDF page images are sent, and the endpoint must accept OpenAI-compatible chat-completions requests with image data URLs. Configure either a versioned API base such as `/v1` or the complete `/chat/completions` URL.
- **The OCR endpoint must protect the credential in transit** — HTTPS is required except for loopback HTTP hosts such as `localhost`.
- **Page and output limits apply** — PDFs beyond `maxPdfPages` are not inspected, and extracted text beyond `maxExtractedChars` is truncated.
- **`@` references remain references** — manual mentions are not parsed as attachments, and unsupported native-path files retain the official reference route. Only supported files added to the standard composer become FileBlocks for `agent/pre-step` processing.
- **The composer integration requires the distribution's Client API** — the native-file upload policy registry is an added `ui-conversation` extension, not an upstream rc.2 API. An application without it needs an updated `ui-conversation` package before this Client feature can route native paths as attachments.
- **Media routing uses the filename extension** — durable FileBlock metadata does not preserve a MIME type. Ambiguous containers such as `.mp4` and `.webm` are routed as video.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
