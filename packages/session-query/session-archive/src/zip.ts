/** Bounded streaming ZIP writer owned by the Session archive package. */

import { Zip, ZipDeflate } from 'fflate'
import type { SessionArchiveZipEntry } from './session-log.ts'

/** Accepted ZIP DEFLATE levels. */
export type SessionArchiveCompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
/** Default compression level for Session archives. */
export const DEFAULT_SESSION_ARCHIVE_COMPRESSION_LEVEL: SessionArchiveCompressionLevel = 6

const PUSH_CHUNK_CODE_UNITS = 1 << 16
const PUSH_CHUNK_BYTES = 1 << 16
const RESPONSE_HIGH_WATER_MARK_BYTES = 1 << 16

class ResponseCapacityGate {
  private releasePending: (() => void) | undefined

  async wait(controller: ReadableStreamDefaultController<Uint8Array>, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (controller.desiredSize === null || controller.desiredSize > 0) return
    await new Promise<void>((resolve) => {
      const release = (): void => {
        this.releasePending = undefined
        signal.removeEventListener('abort', release)
        resolve()
      }
      this.releasePending = release
      signal.addEventListener('abort', release, { once: true })
    })
    signal.throwIfAborted()
  }

  pulled(): void { this.releasePending?.() }
}

async function pushContent(
  deflate: ZipDeflate, content: string, controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate, signal: AbortSignal,
): Promise<void> {
  const encoder = new TextEncoder()
  let offset = 0
  let finalChunk: boolean
  do {
    signal.throwIfAborted()
    let end = Math.min(offset + PUSH_CHUNK_CODE_UNITS, content.length)
    if (end < content.length && end - offset > 1) {
      const last = content.charCodeAt(end - 1)
      if (last >= 0xd800 && last <= 0xdbff) end -= 1
    }
    finalChunk = end >= content.length
    deflate.push(encoder.encode(content.slice(offset, end)), finalChunk)
    offset = end
    await capacity.wait(controller, signal)
  } while (!finalChunk)
}

async function pushData(
  deflate: ZipDeflate, data: Uint8Array, controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate, signal: AbortSignal,
): Promise<void> {
  let offset = 0
  do {
    signal.throwIfAborted()
    const end = Math.min(offset + PUSH_CHUNK_BYTES, data.byteLength)
    deflate.push(data.subarray(offset, end), end >= data.byteLength)
    offset = end
    await capacity.wait(controller, signal)
  } while (offset < data.byteLength)
}

async function pushChunks(
  deflate: ZipDeflate, chunks: AsyncIterable<Uint8Array>, controller: ReadableStreamDefaultController<Uint8Array>,
  capacity: ResponseCapacityGate, signal: AbortSignal,
): Promise<void> {
  for await (const chunk of chunks) {
    signal.throwIfAborted()
    if (chunk.byteLength === 0) continue
    deflate.push(chunk, false)
    await capacity.wait(controller, signal)
  }
  signal.throwIfAborted()
  deflate.push(new Uint8Array(), true)
  await capacity.wait(controller, signal)
}

/**
 * Encode ordered Session archive entries without buffering the full ZIP.
 * @param entries - archive entries in central-directory order.
 * @param level - deflate compression level for every entry.
 * @param signal - aborts both the producer and the returned stream's readers.
 * @returns a Web stream of the encoded ZIP bytes.
 */
export function streamSessionArchiveEntries(
  entries: AsyncIterable<SessionArchiveZipEntry>, level: SessionArchiveCompressionLevel, signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const consumerAbort = new AbortController()
  const producerSignal = AbortSignal.any([signal, consumerAbort.signal])
  let zip: Zip | undefined
  let terminated = false
  const capacity = new ResponseCapacityGate()
  const terminate = (): void => {
    if (zip === undefined || terminated) return
    terminated = true
    zip.terminate()
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const archive = new Zip((error, data, final) => {
        if (error !== null) { controller.error(error); return }
        if (data.byteLength > 0) controller.enqueue(data)
        if (final) controller.close()
      })
      zip = archive
      void (async () => {
        try {
          for await (const entry of entries) {
            producerSignal.throwIfAborted()
            const deflate = new ZipDeflate(entry.path, { level })
            archive.add(deflate)
            if ('content' in entry) await pushContent(deflate, entry.content, controller, capacity, producerSignal)
            else if ('data' in entry) await pushData(deflate, entry.data, controller, capacity, producerSignal)
            else await pushChunks(deflate, entry.chunks, controller, capacity, producerSignal)
          }
          archive.end()
        } catch (error: unknown) {
          terminate()
          controller.error(error instanceof Error ? error : new Error(String(error)))
        }
      })()
    },
    pull() { capacity.pulled() },
    cancel(reason) {
      consumerAbort.abort(reason instanceof Error ? reason : new Error('Session archive stream cancelled'))
      terminate()
    },
  }, { highWaterMark: RESPONSE_HIGH_WATER_MARK_BYTES, size: chunk => chunk.byteLength })
}
