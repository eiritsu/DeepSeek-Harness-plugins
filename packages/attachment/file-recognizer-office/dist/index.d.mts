import z from "@deepseek-ai/schemastery";
import { Context } from "@deepseek-ai/cordis";

//#region src/index.d.ts
/** Limits and optional OCR endpoint used while admitting file messages. */
interface Config {
  /** Maximum attachment bytes parsed in memory. Default: 32 MiB. */
  maxInputBytes?: number;
  /** Maximum uncompressed bytes admitted for one Office ZIP archive. Default: 128 MiB. */
  maxUncompressedBytes?: number;
  /** Maximum entries admitted for one Office ZIP archive. Default: 4,000. */
  maxZipEntries?: number;
  /** Maximum extracted characters included for one attachment. Default: 200,000. */
  maxExtractedChars?: number;
  /** Maximum PDF pages inspected for text and OCR. Default: 20. */
  maxPdfPages?: number;
  /** Maximum raster pixels allocated for one PDF page. Default: 4,000,000. */
  maxPdfPagePixels?: number;
  /** Maximum raster scale for PDF OCR. Default: 2. */
  maxPdfRenderScale?: number;
  /** OpenAI-compatible chat-completions endpoint for scanned PDF pages. */
  ocrEndpoint?: string;
  /** Vision model accepted by the configured OCR endpoint. */
  ocrModel?: string;
}
/** Configuration schema with bounded parser and rendering resources. */
declare const Config: z<Config>;
/** Cordis Loader name. */
declare const name = "file-recognizer-office";
/** Durable bytes and model-visible message admission. */
declare const inject: string[];
/** Add parsed attachment text to the same durable user message that holds each file reference. */
declare function apply(ctx: Context, config: Config): void;
//#endregion
export { Config, apply, inject, name };
//# sourceMappingURL=index.d.mts.map