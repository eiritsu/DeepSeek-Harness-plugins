/** Add durable local text extraction for Office attachments, and send scanned pages as images to a model that reads them. */

import { Buffer } from 'node:buffer'
import { createCanvas } from '@napi-rs/canvas'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { parseOfficeAsync } from 'officeparser'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import yauzl from 'yauzl'
import type { Entry } from 'yauzl'
import type { ContentBlock, FileBlock } from '@deepseek-ai/dsh-llm'
import { AUDIO_EXTENSIONS, OFFICE_EXTENSIONS, VIDEO_EXTENSIONS, fileExtension } from './supported-file-types.ts'

import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'

/** One rendered page the turn's model can read without an OCR round trip. */
interface PageImage {
  readonly data: Uint8Array
  readonly name: string
}

/** One piece of what an attachment contributes, in the order the model reads it. */
type ExtractedSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'image'; readonly image: PageImage }

/**
 * What one attachment contributes. An attachment that produced no page image
 * keeps the single text block the model has always seen, so only a PDF whose
 * scanned pages became images changes the block structure a model reads.
 */
type Extracted =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'pages'; readonly segments: readonly ExtractedSegment[] }

function text(value: string): ExtractedSegment {
  return { kind: 'text', text: value }
}

const CREDENTIAL_REFS = {
  ocr: 'DSH_FILE_OFFICE_OCR_API_KEY',
  audio: 'DSH_FILE_OFFICE_AUDIO_API_KEY',
  video: 'DSH_FILE_OFFICE_VIDEO_API_KEY',
} as const

/** Limits and optional OCR endpoint used while admitting file messages. */
export interface Config {
  /** Maximum attachment bytes parsed in memory. Default: 32 MiB. */
  maxInputBytes: Volatile<number>
  /** Maximum uncompressed bytes admitted for one Office ZIP archive. Default: 128 MiB. */
  maxUncompressedBytes: Volatile<number>
  /** Maximum entries admitted for one Office ZIP archive. Default: 4,000. */
  maxZipEntries: Volatile<number>
  /** Maximum extracted characters included for one attachment. Default: 200,000. */
  maxExtractedChars: Volatile<number>
  /** Maximum PDF pages inspected for text and OCR. Default: 20. */
  maxPdfPages: Volatile<number>
  /** Maximum raster pixels allocated for one PDF page. Default: 4,000,000. */
  maxPdfPagePixels: Volatile<number>
  /** Maximum raster scale for PDF OCR. Default: 2. */
  maxPdfRenderScale: Volatile<number>
  /** OpenAI-compatible API base URL or chat-completions URL for scanned PDF pages. */
  ocrEndpoint: Volatile<string | undefined>
  /** Vision model accepted by the configured OCR endpoint. */
  ocrModel: Volatile<string | undefined>
  /** OpenAI-compatible base URL for audio transcription. */
  audioEndpoint: Volatile<string | undefined>
  /** Model accepted by the audio transcription endpoint. */
  audioModel: Volatile<string | undefined>
  /** OpenAI-compatible base URL for video understanding. */
  videoEndpoint: Volatile<string | undefined>
  /** Model accepted by the video understanding endpoint. */
  videoModel: Volatile<string | undefined>
}

/** Configuration schema with bounded parser and rendering resources. */
export const Config = z.object({
  maxInputBytes: z.number().step(1).min(1).max(256 * 1024 * 1024).default(32 * 1024 * 1024).volatile(),
  maxUncompressedBytes: z.number().step(1).min(1).max(1024 * 1024 * 1024).default(128 * 1024 * 1024).volatile(),
  maxZipEntries: z.number().step(1).min(1).max(10_000).default(4_000).volatile(),
  maxExtractedChars: z.number().step(1).min(1).max(1_000_000).default(200_000).volatile(),
  maxPdfPages: z.number().step(1).min(1).max(100).default(20).volatile(),
  maxPdfPagePixels: z.number().step(1).min(1).max(16_000_000).default(4_000_000).volatile(),
  maxPdfRenderScale: z.number().min(0.1).max(4).default(2).volatile(),
  ocrEndpoint: z.string().volatile(),
  ocrModel: z.string().volatile(),
  audioEndpoint: z.string().volatile(),
  audioModel: z.string().volatile(),
  videoEndpoint: z.string().volatile(),
  videoModel: z.string().volatile(),
})

type OfficeConfigSnapshot = { [K in keyof Config]: ReturnType<Config[K]['get']> }

/** Cordis Loader name. */
export const name = 'file-recognizer-office'
/** Durable bytes and model-visible message admission. */
export const inject = ['attachments']

function suffix(ref: FileAttachmentRef): string {
  return fileExtension(ref.name)
}

function validateConfig(config: OfficeConfigSnapshot): void {
  for (const [name, endpointValue, model] of [
    ['ocr', config.ocrEndpoint, config.ocrModel],
    ['audio', config.audioEndpoint, config.audioModel],
    ['video', config.videoEndpoint, config.videoModel],
  ] as const) {
    if (endpointValue === undefined || endpointValue.trim() === '') {
      if (model !== undefined && model.trim() !== '') throw new TypeError(`${name}Model requires ${name}Endpoint`)
      continue
    }
    const endpoint = new URL(endpointValue)
    const localHttp = endpoint.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
    if (endpoint.protocol !== 'https:' && !localHttp) {
      throw new TypeError(`${name}Endpoint must use HTTPS (HTTP is allowed only for loopback hosts)`)
    }
    if (model === undefined || model.trim() === '') {
      throw new TypeError(`${name}Endpoint requires a non-empty ${name}Model`)
    }
  }
}

function snapshotConfig(config: Config): OfficeConfigSnapshot {
  const snapshot = {
    maxInputBytes: config.maxInputBytes.get(),
    maxUncompressedBytes: config.maxUncompressedBytes.get(),
    maxZipEntries: config.maxZipEntries.get(),
    maxExtractedChars: config.maxExtractedChars.get(),
    maxPdfPages: config.maxPdfPages.get(),
    maxPdfPagePixels: config.maxPdfPagePixels.get(),
    maxPdfRenderScale: config.maxPdfRenderScale.get(),
    ocrEndpoint: config.ocrEndpoint.get(),
    ocrModel: config.ocrModel.get(),
    audioEndpoint: config.audioEndpoint.get(),
    audioModel: config.audioModel.get(),
    videoEndpoint: config.videoEndpoint.get(),
    videoModel: config.videoModel.get(),
  }
  validateConfig(snapshot)
  return snapshot
}

function configured(endpoint: string | undefined, model: string | undefined): endpoint is string {
  return endpoint !== undefined && endpoint.trim() !== '' && model !== undefined && model.trim() !== ''
}

function operationEndpoint(endpointValue: string, operation: string): string {
  const endpoint = new URL(endpointValue)
  const path = endpoint.pathname.replace(/\/+$/, '')
  if (/\/(?:api\/)?v\d+(?:\.\d+)?$/.test(path)) endpoint.pathname = `${path}/${operation}`
  return endpoint.toString()
}

function extensionMediaType(ref: FileAttachmentRef): string {
  const extension = suffix(ref)
  const mediaTypes: Record<string, string> = {
    mp3: 'audio/mpeg', mp4: 'video/mp4', mpeg: 'video/mpeg', mpga: 'audio/mpeg',
    m4a: 'audio/mp4', wav: 'audio/wav', webm: 'video/webm', flac: 'audio/flac',
    ogg: 'audio/ogg', oga: 'audio/ogg', mpg: 'video/mpeg', mov: 'video/quicktime',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo', m4v: 'video/x-m4v',
  }
  return mediaTypes[extension] ?? 'application/octet-stream'
}

function officeArchive(data: Uint8Array, maxEntries: number, maxBytes: number): Promise<boolean> {
  return new Promise((resolve) => {
    yauzl.fromBuffer(Buffer.from(data), { lazyEntries: true }, (error, archive) => {
      if (error !== null) {
        resolve(false)
        return
      }
      let entries = 0
      let expandedBytes = 0
      let settled = false
      const finish = (accepted: boolean): void => {
        if (settled) return
        settled = true
        archive.close()
        resolve(accepted)
      }
      archive.on('error', () => { finish(false) })
      archive.on('entry', (entry: Entry) => {
        entries += 1
        expandedBytes += entry.uncompressedSize
        const segments = entry.fileName.split('/')
        if (entries > maxEntries || expandedBytes > maxBytes
          || entry.fileName.startsWith('/') || entry.fileName.includes('\\')
          || segments.some(segment => segment === '..' || segment.includes('\0'))
          || (entry.generalPurposeBitFlag & 1) !== 0) {
          finish(false)
          return
        }
        archive.readEntry()
      })
      archive.on('end', () => { finish(true) })
      archive.readEntry()
    })
  })
}

async function readBytes(
  ctx: Context, config: OfficeConfigSnapshot, ref: FileAttachmentRef, signal: AbortSignal,
): Promise<Uint8Array> {
  const limit = config.maxInputBytes
  if (ref.bytes > limit) throw new Error(`file exceeds the ${limit}-byte extraction limit`)
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of ctx.attachments.readFileStream(ref, signal)) {
    signal.throwIfAborted()
    length += chunk.byteLength
    if (length > limit) throw new Error(`file exceeds the ${limit}-byte extraction limit`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), length)
}

function pageText(items: readonly unknown[]): string {
  return items.flatMap((item) => {
    if (typeof item !== 'object' || item === null || !('str' in item) || typeof item.str !== 'string') return []
    return [item.str]
  }).join(' ').trim()
}

function responseText(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  if ('text' in payload && typeof payload.text === 'string' && payload.text.trim() !== '') return payload.text.trim()
  if ('transcript' in payload && typeof payload.transcript === 'string' && payload.transcript.trim() !== '') return payload.transcript.trim()
  if (!('choices' in payload) || !Array.isArray(payload.choices)) return undefined
  const first: unknown = payload.choices[0]
  if (typeof first !== 'object' || first === null || !('message' in first)) return undefined
  const message: unknown = first.message
  if (typeof message !== 'object' || message === null || !('content' in message)) return undefined
  const content: unknown = message.content
  if (typeof content === 'string') return content.trim() || undefined
  if (!Array.isArray(content)) return undefined
  const text = content.flatMap((part: unknown) => {
    if (typeof part !== 'object' || part === null || !('text' in part) || typeof part.text !== 'string') return []
    return [part.text]
  }).join('\n').trim()
  return text || undefined
}

async function recognizePage(
  ctx: Context, config: OfficeConfigSnapshot, data: Uint8Array, pageNumber: number, signal: AbortSignal,
): Promise<string | undefined> {
  const endpoint = config.ocrEndpoint
  const model = config.ocrModel
  if (endpoint === undefined || model === undefined) return undefined
  const credential = await resolveCredential(ctx, CREDENTIAL_REFS.ocr, 'OCR')
  const content = [
    { type: 'text', text: `Extract all visible text from PDF page ${pageNumber}. Preserve reading order and do not summarize.` },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from(data).toString('base64')}` } },
  ]
  const response = await fetch(operationEndpoint(endpoint, 'chat/completions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${credential}`,
    },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
    signal,
  })
  if (!response.ok) throw new Error(`OCR endpoint returned HTTP ${response.status}`)
  return responseText(await response.json())
}

async function resolveCredential(ctx: Context, ref: string, label: string): Promise<string> {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) throw new Error(`${label} requires the credentials service`)
  const credential = await credentials.resolve(credentialRef(ref))
  if (credential === undefined) throw new Error(`${label} credential ${ref} is not configured`)
  return credential.value
}

async function recognizeMediaFile(
  ctx: Context, config: OfficeConfigSnapshot, ref: FileAttachmentRef, data: Uint8Array, kind: 'audio' | 'video', signal: AbortSignal,
): Promise<string | undefined> {
  const endpoint = kind === 'audio' ? config.audioEndpoint : config.videoEndpoint
  const model = kind === 'audio' ? config.audioModel : config.videoModel
  if (!configured(endpoint, model) || model === undefined) return undefined
  const key = await resolveCredential(ctx, CREDENTIAL_REFS[kind], kind === 'audio' ? 'Audio transcription' : 'Video understanding')
  let response: Response
  if (kind === 'audio') {
    const form = new FormData()
    form.set('model', model)
    form.set('file', new File([Uint8Array.from(data).buffer], ref.name, { type: extensionMediaType(ref) }))
    response = await fetch(operationEndpoint(endpoint, 'audio/transcriptions'), {
      method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form, signal,
    })
  } else {
    const mediaType = extensionMediaType(ref)
    const dataUrl = `data:${mediaType};base64,${Buffer.from(data).toString('base64')}`
    response = await fetch(operationEndpoint(endpoint, 'chat/completions'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: [
        { type: 'text', text: 'Describe and transcribe the important content of this video.' },
        { type: 'video_url', video_url: { url: dataUrl } },
      ] }] }),
      signal,
    })
  }
  if (!response.ok) throw new Error(`${kind} endpoint returned HTTP ${response.status} for model ${model}`)
  const text = responseText(await response.json())
  if (text === undefined) throw new Error(`${kind} endpoint returned no recognized text for model ${model}`)
  return `[${kind === 'audio' ? 'Audio transcript' : 'Video understanding'}: ${ref.name}]\n${text}`
}

/** Whether the turn's own model reads images, so a scanned page needs no OCR round trip.
 * @param ctx - Host context carrying the LLM service.
 * @param agent - the agent whose turn is being prepared.
 * @param signal - the turn's abort signal.
 * @returns whether the model declares image input. Unreadable metadata answers false so OCR stays available.
 */
async function modelReadsImages(ctx: Context, agent: Agent, signal: AbortSignal): Promise<boolean> {
  const { provider, model } = agent.options
  if (provider === undefined || model === undefined) return false
  // A profile without the LLM service cannot reach a model call at all, so it
  // never gains image input from this plugin.
  const llm = ctx.get('llm')
  if (llm === undefined) return false
  try {
    const metadata = await llm.resolveModelMetadata({ provider, model, signal })
    return metadata.inputModalities?.includes('image') ?? false
  } catch (error) {
    // A metadata source that fails must not disable OCR for the turn.
    if (signal.aborted) throw error
    ctx.logger.warn('file-recognizer-office: model modality lookup failed; scanned pages fall back to OCR')
    return false
  }
}

async function extractPdf(
  ctx: Context, config: OfficeConfigSnapshot, data: Uint8Array, ref: FileAttachmentRef, signal: AbortSignal, vision: boolean,
): Promise<Extracted | undefined> {
  const task = getDocument({ data: Uint8Array.from(data) })
  try {
    const document = await task.promise
    // `plain` reproduces the single text block the model saw before image pages
    // existed; `ordered` is used only when a page actually became an image.
    const plain: string[] = []
    const ordered: ExtractedSegment[] = []
    let imagePages = 0
    const limit = Math.min(document.numPages, config.maxPdfPages)
    const ocrConfigured = configured(config.ocrEndpoint, config.ocrModel)
    let scannedPages = 0
    let unrecognizedScannedPages = 0
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      signal.throwIfAborted()
      const page = await document.getPage(pageNumber)
      const extracted = pageText((await page.getTextContent()).items)
      if (extracted.length >= 20) {
        plain.push(`[PDF page ${pageNumber}]\n${extracted}`)
        ordered.push(text(`[PDF page ${pageNumber}]\n${extracted}`))
        continue
      }
      scannedPages += 1
      // The page has no text layer. A model that reads images takes it directly;
      // otherwise it needs the configured OCR endpoint, and without one the page
      // simply has no content this turn.
      const useImage = vision
      if (!useImage && !ocrConfigured) {
        unrecognizedScannedPages += 1
        continue
      }
      const original = page.getViewport({ scale: 1 })
      const pixels = config.maxPdfPagePixels
      const scale = Math.min(config.maxPdfRenderScale, Math.sqrt(pixels / (original.width * original.height)))
      const viewport = page.getViewport({ scale })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      try {
        const canvasContext = Object.assign(canvas.getContext('2d'), { drawFocusIfNeeded: () => {} })
        // pdf.js declares a DOM canvas context, while its supported NAPI path accepts this compatible native context.
        const renderTask = Reflect.apply(page.render.bind(page), page, [{
          canvas: null,
          canvasContext,
          viewport,
        }]) as ReturnType<typeof page.render>
        await renderTask.promise
        const png = canvas.toBuffer('image/png')
        if (useImage) {
          imagePages += 1
          const marker = `[PDF page ${pageNumber} has no text layer; its image follows.]`
          plain.push(marker)
          // The marker and the page it names are one adjacent pair, so a later
          // page's marker never precedes an earlier page's image.
          ordered.push(text(marker))
          ordered.push({ kind: 'image', image: { data: Uint8Array.from(png), name: `${ref.name} page ${pageNumber}` } })
          continue
        }
        const recognized = await recognizePage(ctx, config, png, pageNumber, signal)
        if (recognized !== undefined) {
          plain.push(`[PDF page ${pageNumber}]\n${recognized}`)
          ordered.push(text(`[PDF page ${pageNumber}]\n${recognized}`))
        } else unrecognizedScannedPages += 1
      } finally {
        canvas.width = 0
        canvas.height = 0
      }
    }
    // A page that yields nothing still reports itself, so an attachment is
    // only absent when it produced neither content nor a notice.
    if (plain.length === 0 && unrecognizedScannedPages === 0) return undefined
    if (scannedPages > 0 && document.numPages > limit) {
      plain.push(`[PDF page processing limited to the first ${limit} pages of ${document.numPages}.]`)
    }
    if (unrecognizedScannedPages > 0) {
      plain.push(`[${unrecognizedScannedPages} PDF page(s) had no selectable text${ocrConfigured ? '; OCR returned no text' : '; OCR is not configured'}.]`)
    }
    const joined = `[Extracted from ${ref.name}]\n${plain.join('\n\n')}`
    if (imagePages === 0) return { kind: 'text', text: joined }
    return { kind: 'pages', segments: [text(`[Extracted from ${ref.name}]`), ...ordered] }
  } finally {
    await task.destroy()
  }
}

function bounded(text: string, limit: number): string {
  const normalized = text.trim()
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}\n[Extracted text truncated.]`
}

async function extract(
  ctx: Context, config: OfficeConfigSnapshot, ref: FileAttachmentRef, signal: AbortSignal, vision: boolean,
): Promise<Extracted | undefined> {
  const extension = suffix(ref)
  if (VIDEO_EXTENSIONS.has(extension) && configured(config.videoEndpoint, config.videoModel)) {
    const data = await readBytes(ctx, config, ref, signal)
    const transcript = await recognizeMediaFile(ctx, config, ref, data, 'video', signal)
    return transcript === undefined ? undefined : { kind: 'text', text: transcript }
  }
  if (AUDIO_EXTENSIONS.has(extension) && configured(config.audioEndpoint, config.audioModel)) {
    const data = await readBytes(ctx, config, ref, signal)
    const transcript = await recognizeMediaFile(ctx, config, ref, data, 'audio', signal)
    return transcript === undefined ? undefined : { kind: 'text', text: transcript }
  }
  if (!OFFICE_EXTENSIONS.has(extension) && extension !== 'pdf') return undefined
  const data = await readBytes(ctx, config, ref, signal)
  if (extension === 'pdf') return extractPdf(ctx, config, data, ref, signal, vision)
  if (!await officeArchive(data, config.maxZipEntries,
    config.maxUncompressedBytes)) {
    throw new Error('file is not a valid Office archive or exceeds the configured archive limits')
  }
  const parsed = (await parseOfficeAsync(Buffer.from(data), { outputErrorToConsole: false })).trim()
  if (parsed === '') throw new Error('the Office file contains no extractable text')
  // No model reads a DOCX, PPTX, or XLSX archive directly, so parsing one is the
  // only route to its content rather than a fallback for a missing capability.
  return { kind: 'text', text: `[Extracted from ${ref.name}]\n${parsed}` }
}

function hasFile(block: ContentBlock): block is FileBlock {
  return block.type === 'file'
}

async function extractMessage(
  ctx: Context, config: OfficeConfigSnapshot, message: UserMessage, signal: AbortSignal, vision: boolean,
): Promise<UserMessage> {
  /** One emitted block, or a page whose image is stored after the loop. */
  type Slot =
    | { readonly ready: ContentBlock }
    | { readonly pending: PageImage }
  const slots: Slot[] = []
  for (const block of message.content) {
    if (!hasFile(block)) continue
    try {
      const result = await extract(ctx, config, block.attachment, signal, vision)
      if (result === undefined) continue
      if (result.kind === 'text') {
        slots.push({ ready: { type: 'text', text: bounded(result.text, config.maxExtractedChars) } })
        continue
      }
      // The character budget covers one attachment's text across all of its
      // segments, so interleaving an image never resets the limit.
      let budget = config.maxExtractedChars
      for (const segment of result.segments) {
        if (segment.kind === 'image') {
          slots.push({ pending: segment.image })
          continue
        }
        if (budget <= 0) continue
        const emitted = bounded(segment.text, budget)
        budget -= emitted.length
        slots.push({ ready: { type: 'text', text: emitted } })
        if (budget <= 0) slots.push({ ready: { type: 'text', text: '[Extracted text truncated.]' } })
      }
    } catch (error) {
      signal.throwIfAborted()
      ctx.logger.warn(`file-recognizer-office: extraction failed for ${block.attachment.name}`)
      ctx.logger.warn(error)
      const reason = error instanceof Error ? error.message : 'unknown extraction error'
      slots.push({
        ready: {
          type: 'text',
          text: `[DeepSeek-Files could not preprocess ${block.attachment.name}: ${reason}. The original file remains attached.]`,
        },
      })
    }
  }
  if (slots.length === 0) return message
  const pending = slots.filter((slot): slot is { readonly pending: PageImage } => 'pending' in slot)
  // Only a vision turn reaches the attachment service here; a text-only turn
  // must not require an image store to extract a document.
  const stored = pending.length === 0 ? [] : await ctx.attachments.saveImages(
    pending.map(slot => ({ data: slot.pending.data, mediaType: 'image/png', name: slot.pending.name })),
  )
  const appended: ContentBlock[] = []
  let next = 0
  for (const slot of slots) {
    if (!('pending' in slot)) {
      appended.push(slot.ready)
      continue
    }
    const attachment = stored[next++]
    if (attachment === undefined) {
      // The store returned fewer references than pages offered. The marker
      // already announced an image, so name the page rather than emit a block
      // with no reference behind it.
      ctx.logger.warn(`file-recognizer-office: no stored image reference for ${slot.pending.name}`)
      continue
    }
    appended.push({ type: 'image', attachment })
  }
  return { ...message, content: [...message.content, ...appended] }
}

/** Add parsed attachment text, and image pages the turn's model reads, to the same durable user message that holds each file reference. */
export function apply(ctx: Context, config: Config): void {
  snapshotConfig(config)
  ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const current = snapshotConfig(config)
    const decision = await next()
    if (decision.kind === 'reject') return decision
    if (payload.surfaceReplacement) return decision
    // One lookup per turn: every message in the step faces the same model.
    const vision = await modelReadsImages(ctx, payload.agent, payload.signal)
    const messages: UserMessage[] = []
    for (const message of decision.messages) messages.push(await extractMessage(ctx, current, message, payload.signal, vision))
    return { ...decision, messages }
  })
}
