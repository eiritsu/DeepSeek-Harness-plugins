import { Buffer } from "node:buffer";
import { createCanvas } from "@napi-rs/canvas";
import z from "@deepseek-ai/schemastery";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { parseOfficeAsync } from "officeparser";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import yauzl from "yauzl";
//#region src/index.ts
/** Add durable local text extraction for Office and searchable PDF attachments. */
const OFFICE_EXTENSIONS = new Set([
	"docx",
	"pptx",
	"xlsx",
	"odt",
	"odp",
	"ods"
]);
const OCR_API_KEY_REF = "DSH_FILE_OFFICE_OCR_API_KEY";
/** Configuration schema with bounded parser and rendering resources. */
const Config = z.object({
	maxInputBytes: z.number().step(1).min(1).default(32 * 1024 * 1024),
	maxUncompressedBytes: z.number().step(1).min(1).default(128 * 1024 * 1024),
	maxZipEntries: z.number().step(1).min(1).default(4e3),
	maxExtractedChars: z.number().step(1).min(1).default(2e5),
	maxPdfPages: z.number().step(1).min(1).default(20),
	maxPdfPagePixels: z.number().step(1).min(1).default(4e6),
	maxPdfRenderScale: z.number().min(.1).default(2),
	ocrEndpoint: z.string(),
	ocrModel: z.string()
});
/** Cordis Loader name. */
const name = "file-recognizer-office";
/** Durable bytes and model-visible message admission. */
const inject = ["attachments"];
function suffix(ref) {
	const dot = ref.name.lastIndexOf(".");
	return dot < 0 ? "" : ref.name.slice(dot + 1).toLowerCase();
}
function validateConfig(config) {
	if (config.ocrEndpoint === void 0 && config.ocrModel !== void 0) throw new TypeError("ocrModel requires ocrEndpoint");
	if (config.ocrEndpoint !== void 0) {
		const endpoint = new URL(config.ocrEndpoint);
		const localHttp = endpoint.protocol === "http:" && [
			"localhost",
			"127.0.0.1",
			"[::1]"
		].includes(endpoint.hostname);
		if (endpoint.protocol !== "https:" && !localHttp) throw new TypeError("ocrEndpoint must use HTTPS (HTTP is allowed only for loopback hosts)");
		if (config.ocrModel === void 0 || config.ocrModel.trim() === "") throw new TypeError("ocrEndpoint requires a non-empty ocrModel");
	}
}
function officeArchive(data, maxEntries, maxBytes) {
	return new Promise((resolve) => {
		yauzl.fromBuffer(Buffer.from(data), { lazyEntries: true }, (error, archive) => {
			if (error !== null || archive === void 0) {
				resolve(false);
				return;
			}
			let entries = 0;
			let expandedBytes = 0;
			let settled = false;
			const finish = (accepted) => {
				if (settled) return;
				settled = true;
				archive.close();
				resolve(accepted);
			};
			archive.on("error", () => {
				finish(false);
			});
			archive.on("entry", (entry) => {
				entries += 1;
				expandedBytes += entry.uncompressedSize;
				const segments = entry.fileName.split("/");
				if (entries > maxEntries || expandedBytes > maxBytes || entry.fileName.startsWith("/") || entry.fileName.includes("\\") || segments.some((segment) => segment === ".." || segment.includes("\0")) || (entry.generalPurposeBitFlag & 1) !== 0) {
					finish(false);
					return;
				}
				archive.readEntry();
			});
			archive.on("end", () => {
				finish(true);
			});
			archive.readEntry();
		});
	});
}
async function readBytes(ctx, config, ref, signal) {
	if (ref.bytes > (config.maxInputBytes ?? 32 * 1024 * 1024)) return void 0;
	const chunks = [];
	let length = 0;
	for await (const chunk of ctx.attachments.readFileStream(ref, signal)) {
		signal.throwIfAborted();
		length += chunk.byteLength;
		if (length > (config.maxInputBytes ?? 32 * 1024 * 1024)) return void 0;
		chunks.push(chunk);
	}
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length);
}
function pageText(items) {
	return items.flatMap((item) => {
		if (typeof item !== "object" || item === null || !("str" in item) || typeof item.str !== "string") return [];
		return [item.str];
	}).join(" ").trim();
}
function responseText(payload) {
	if (typeof payload !== "object" || payload === null || !("choices" in payload) || !Array.isArray(payload.choices)) return void 0;
	const first = payload.choices[0];
	if (typeof first !== "object" || first === null || !("message" in first)) return void 0;
	const message = first.message;
	if (typeof message !== "object" || message === null || !("content" in message)) return void 0;
	const content = message.content;
	if (typeof content === "string") return content.trim() || void 0;
	if (!Array.isArray(content)) return void 0;
	return content.flatMap((part) => {
		if (typeof part !== "object" || part === null || !("text" in part) || typeof part.text !== "string") return [];
		return [part.text];
	}).join("\n").trim() || void 0;
}
async function recognizePage(ctx, config, data, pageNumber, signal) {
	const endpoint = config.ocrEndpoint;
	const model = config.ocrModel;
	if (endpoint === void 0 || model === void 0) return void 0;
	const credentials = ctx.get("credentials");
	if (credentials === void 0) throw new Error("OCR requires the credentials service");
	const credential = await credentials.resolve(credentialRef(OCR_API_KEY_REF));
	if (credential === void 0) throw new Error(`OCR credential ${OCR_API_KEY_REF} is not configured`);
	const content = [{
		type: "text",
		text: `Extract all visible text from PDF page ${pageNumber}. Preserve reading order and do not summarize.`
	}, {
		type: "image_url",
		image_url: { url: `data:image/png;base64,${Buffer.from(data).toString("base64")}` }
	}];
	const response = await fetch(endpoint, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${credential.value}`
		},
		body: JSON.stringify({
			model,
			messages: [{
				role: "user",
				content
			}]
		}),
		signal
	});
	if (!response.ok) throw new Error(`OCR endpoint returned HTTP ${response.status}`);
	return responseText(await response.json());
}
async function extractPdf(ctx, config, data, ref, signal) {
	const task = getDocument({ data: Uint8Array.from(data) });
	try {
		const document = await task.promise;
		const pages = [];
		const limit = Math.min(document.numPages, config.maxPdfPages ?? 20);
		let scannedPages = 0;
		for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
			signal.throwIfAborted();
			const page = await document.getPage(pageNumber);
			const extracted = pageText((await page.getTextContent()).items);
			if (extracted.length >= 20) {
				pages.push(`[PDF page ${pageNumber}]\n${extracted}`);
				continue;
			}
			if (config.ocrEndpoint === void 0) continue;
			scannedPages += 1;
			const original = page.getViewport({ scale: 1 });
			const pixels = config.maxPdfPagePixels ?? 4e6;
			const scale = Math.min(config.maxPdfRenderScale ?? 2, Math.sqrt(pixels / (original.width * original.height)));
			const viewport = page.getViewport({ scale });
			const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
			try {
				const canvasContext = Object.assign(canvas.getContext("2d"), { drawFocusIfNeeded: () => {} });
				await page.render({
					canvas: null,
					canvasContext,
					viewport
				}).promise;
				const text = await recognizePage(ctx, config, canvas.toBuffer("image/png"), pageNumber, signal);
				if (text !== void 0) pages.push(`[PDF page ${pageNumber}]\n${text}`);
			} finally {
				canvas.width = 0;
				canvas.height = 0;
			}
		}
		if (scannedPages > 0 && document.numPages > limit) pages.push(`[PDF OCR limited to the first ${limit} pages of ${document.numPages}.]`);
		if (pages.length === 0) return void 0;
		return `[Extracted from ${ref.name}]\n${pages.join("\n\n")}`;
	} finally {
		await task.destroy();
	}
}
function bounded(text, limit) {
	const normalized = text.trim();
	return normalized.length <= limit ? normalized : `${normalized.slice(0, limit)}\n[Extracted text truncated.]`;
}
async function extract(ctx, config, ref, signal) {
	const extension = suffix(ref);
	if (!OFFICE_EXTENSIONS.has(extension) && extension !== "pdf") return void 0;
	const data = await readBytes(ctx, config, ref, signal);
	if (data === void 0) return void 0;
	if (extension === "pdf") return extractPdf(ctx, config, data, ref, signal);
	if (!await officeArchive(data, config.maxZipEntries ?? 4e3, config.maxUncompressedBytes ?? 128 * 1024 * 1024)) return void 0;
	const text = (await parseOfficeAsync(Buffer.from(data), { outputErrorToConsole: false })).trim();
	return text === "" ? void 0 : `[Extracted from ${ref.name}]\n${text}`;
}
function hasFile(block) {
	return block.type === "file";
}
async function extractMessage(ctx, config, message, signal) {
	const appended = [];
	for (const block of message.content) {
		if (!hasFile(block)) continue;
		try {
			const text = await extract(ctx, config, block.attachment, signal);
			if (text !== void 0) appended.push({
				type: "text",
				text: bounded(text, config.maxExtractedChars ?? 2e5)
			});
		} catch (error) {
			signal.throwIfAborted();
			ctx.logger.warn(`file-recognizer-office: extraction failed for ${block.attachment.name}`);
			ctx.logger.warn(error);
		}
	}
	return appended.length === 0 ? message : {
		...message,
		content: [...message.content, ...appended]
	};
}
/** Add parsed attachment text to the same durable user message that holds each file reference. */
function apply(ctx, config) {
	validateConfig(config);
	if (config.ocrEndpoint !== void 0 && ctx.get("credentials") === void 0) throw new TypeError("OCR requires the credentials service");
	ctx.on("agent/pre-step", async (_payload, next) => {
		const decision = await next();
		if (decision.kind === "reject") return decision;
		const messages = [];
		for (const message of decision.messages) messages.push(await extractMessage(ctx, config, message, _payload.signal));
		return {
			...decision,
			messages
		};
	});
}
//#endregion
export { Config, apply, inject, name };

//# sourceMappingURL=index.mjs.map