/** Session archive's local canonical JSONL and attachment projection helpers. */

import type { FileAttachmentRef, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHandle, SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { sessionFormatLogFilename } from '@deepseek-ai/dsh-session-format'

/** Current generation's canonical JSONL filename. */
export const SESSION_LOG_FILENAME = sessionFormatLogFilename(SESSION_FORMAT_VERSION)

const SURFACE_EVENT_TYPES = new Set(['system/message', 'user/message', 'developer/message', 'assistant/message', 'tool/result'])

/** One ZIP entry produced by a Session archive. */
export type SessionArchiveZipEntry =
  | { readonly path: string; readonly content: string }
  | { readonly path: string; readonly data: Uint8Array }
  | { readonly path: string; readonly chunks: AsyncIterable<Uint8Array> }

/**
 * Serialize one validated Session log as canonical JSONL text.
 * @param header - the validated Session header that opens the log.
 * @param events - the validated events that follow the header, in log order.
 * @returns the header line and one JSON line per event, each terminated by a newline.
 */
export function serializeSessionLog(header: SessionHeader, events: readonly SessionEvent[]): string {
  const lines = [JSON.stringify({
    type: 'session',
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    ...header.cwd !== undefined ? { cwd: header.cwd } : {},
    ...header.parentSession !== undefined ? { parentSession: header.parentSession } : {},
    isSeeded: header.isSeeded,
    ...header.origin !== undefined ? { origin: header.origin } : {},
    delegationDepth: header.delegationDepth ?? 0,
    ...header.agentPreset !== undefined ? { agentPreset: header.agentPreset } : {},
  })]
  for (const event of events) lines.push(JSON.stringify(event))
  return `${lines.join('\n')}\n`
}

/** Refuse archive imports that the current AgentLoop cannot safely continue.
 * @param id - Session id used in the diagnostic.
 * @param events - Events already accepted by the current Session format validator.
 * @returns Nothing when the first surface event preserves the protected system head or the Session has no surface.
 */
export function assertSessionCanContinue(id: string, events: readonly { readonly type: string }[]): void {
  const firstSurface = events.find((event) => {
    if (SURFACE_EVENT_TYPES.has(event.type)) return true
    if (KNOWN_SESSION_EVENT_TYPES.has(event.type)) return false
    return Object.prototype.hasOwnProperty.call(event, 'surfaceOp')
  })
  if (firstSurface !== undefined && firstSurface.type !== 'system/message') {
    throw new Error(`session "${id}" cannot be safely continued because its first surface event is not system/message; this migration is unsupported and source data was not modified`)
  }
}

/** Read one committed log through the persistence API and serialize it.
 * @param persistence - the Session persistence service holding committed logs.
 * @param id - the Session whose log is read.
 * @param signal - cooperative cancellation for the open and read operations.
 * @returns the serialized log, or `undefined` when no committed log exists.
 */
export async function readSessionLogText(
  persistence: SessionPersistence,
  id: SessionId,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const options = signal === undefined ? {} : { signal }
  let handle: SessionHandle
  try {
    handle = await persistence.open(id, 'read', options)
  } catch (error: unknown) {
    if (error instanceof SessionPersistenceNotFoundError) return undefined
    throw error
  }
  try {
    const { events } = await handle.read(0, undefined, options)
    return serializeSessionLog(handle.header, events)
  } finally {
    await handle.close()
  }
}

/** Return the archive path for one image reference.
 * @param ref - the image reference carried by a Session message block.
 * @returns the archive-relative path for that image's bytes.
 */
export function sessionLogImageEntryPath(ref: ImageAttachmentRef): string {
  const extension: Record<ImageAttachmentRef['mediaType'], string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  }
  return `media/${String(ref.attachmentId)}.${extension[ref.mediaType]}`
}

/** Return a safe archive path for one verbatim file reference.
 * @param ref - the file reference carried by a Session message block.
 * @returns the archive-relative path for that file's bytes.
 */
export function sessionLogFileEntryPath(ref: FileAttachmentRef): string {
  const digest = String(ref.attachmentId).replace(/^sha256:/u, '')
  const name = ref.name.replace(/[\\/\u0000-\u001f\u007f]/gu, '_')
  const safeName = name === '.' || name === '..' || name === '' ? 'file' : name
  return `files/${digest.slice(0, 2)}/${digest}/${safeName}`
}

function collectContent(content: unknown, images: Map<string, ImageAttachmentRef>, files: Map<string, FileAttachmentRef>): void {
  if (!Array.isArray(content)) return
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { type?: unknown; attachment?: unknown }
    if (typeof block.attachment !== 'object' || block.attachment === null || Array.isArray(block.attachment)) continue
    if (block.type === 'image') {
      const ref = block.attachment as ImageAttachmentRef
      images.set(String(ref.attachmentId), ref)
    } else if (block.type === 'file') {
      const ref = block.attachment as FileAttachmentRef
      files.set(`${String(ref.attachmentId)}\u0000${ref.name}`, ref)
    }
  }
}

function collectEvent(value: unknown, images: Map<string, ImageAttachmentRef>, files: Map<string, FileAttachmentRef>): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  const event = value as { type?: unknown; data?: unknown }
  if (typeof event.data !== 'object' || event.data === null || Array.isArray(event.data)) return
  const data = event.data as {
    content?: unknown
    message?: { content?: unknown }
    inserted?: unknown
    summary?: unknown
    rawOutput?: unknown
    stream?: readonly { type?: unknown; chunk?: { type?: unknown; block?: unknown } }[]
  }
  switch (event.type) {
    case 'user/message': case 'tool/ptc-dispatch': collectContent(data.content, images, files); return
    case 'system/message': case 'developer/message': case 'tool/result': case 'team/message/queued':
      collectContent(data.message?.content, images, files); return
    case 'agent/inbox/spliced':
      if (Array.isArray(data.inserted)) for (const message of data.inserted) {
        if (typeof message === 'object' && message !== null && !Array.isArray(message)) {
          collectContent((message as { content?: unknown }).content, images, files)
        }
      }
      return
    case 'compaction/summary': collectContent(data.summary, images, files); collectContent(data.rawOutput, images, files); return
    case 'assistant/message': collectContent(data.message?.content, images, files); break
    case 'assistant/attempt': break
    default: return
  }
  for (const record of data.stream ?? []) if (record.type === 'chunk' && record.chunk?.type === 'block-end') {
    collectContent([record.chunk.block], images, files)
  }
}

/** Find the attachment references carried by declared Session event content fields.
 * @param content - serialized Session log text, one JSON event per line.
 * @returns the image and file references the log's message content declares, keyed by identity.
 * @throws SyntaxError when a line is not valid JSON.
 */
export function sessionLogAttachmentRefs(content: string): {
  readonly images: Map<string, ImageAttachmentRef>
  readonly files: Map<string, FileAttachmentRef>
} {
  const images = new Map<string, ImageAttachmentRef>()
  const files = new Map<string, FileAttachmentRef>()
  for (const line of content.split('\n')) {
    if (line === '') continue
    collectEvent(JSON.parse(line), images, files)
  }
  return { images, files }
}
