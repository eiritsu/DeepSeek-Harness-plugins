import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context, FiberState } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import Settings from '@deepseek-ai/dsh-settings'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { apply, Config, inject, name } from '../src/index.ts'
import { strToU8, zipSync } from 'fflate'

const docx = zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Loader local text</w:t></w:r></w:p></w:body></w:document>'),
})

function blankPdf(pages = 1): Uint8Array {
  // Object 1 is the catalog, 2 the page tree, then each page and its content
  // stream, so a page count above one is a real multi-page document.
  const pageObjects: string[] = []
  const kids: string[] = []
  for (let index = 0; index < pages; index += 1) {
    const pageId = 3 + index * 2
    kids.push(`${String(pageId)} 0 R`)
    pageObjects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << >> /Contents ${String(pageId + 1)} 0 R >>`)
    pageObjects.push('<< /Length 0 >>\nstream\n\nendstream')
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${String(pages)} >>`,
    ...pageObjects,
  ]
  let source = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, '0')} 00000 n \n`
  source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(source)
}

async function withOcrServer(
  run: (endpoint: string, request: Promise<{ authorization: string | undefined; body: string }>) => Promise<void>,
): Promise<void> {
  let resolveRequest!: (value: { authorization: string | undefined; body: string }) => void
  const request = new Promise<{ authorization: string | undefined; body: string }>((resolve) => { resolveRequest = resolve })
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)) })
    req.on('end', () => {
      resolveRequest({ authorization: req.headers.authorization, body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'Loader OCR text' } }] }))
    })
  })
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${address.port}/v1`, request)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) reject(error)
        else resolve()
      })
    })
  }
}

async function preStep(ctx: Context, file: { id: string; name: string; bytes: number }, model?: { provider: string; model: string }): Promise<Extract<PreStepDecision, { kind: 'enter' }>> {
  const message: UserMessage = createUserMessage({
    content: [{ type: 'file', attachment: file as never }],
    source: { kind: 'user' },
  })
  return ctx.waterfall(ctx as never, 'agent/pre-step', {
    agent: { options: model ?? {} } as never, messages: [message], turn: 1, step: 1, signal: new AbortController().signal,
  }, async (): Promise<Extract<PreStepDecision, { kind: 'enter' }>> => ({ kind: 'enter', messages: [message] })) as Promise<Extract<PreStepDecision, { kind: 'enter' }>>
}

async function officeProfile() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'office-loader-lifecycle-')))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  mkdirSync(bundle, { recursive: true })
  writeFileSync(join(home, 'package.json'), '{"name":"test-installation"}\n')
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({
    name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  writeFileSync(join(bundle, 'cordis.patch.yml'), `- insert:\n    - id: config-editor\n      name: cordis:editor\n    - id: settings\n      name: cordis:settings\n    - id: default-model\n      name: cordis:model\n      config: { provider: test, model: original }\n    - id: ${name}\n      name: cordis:office\n      inject: [attachments]\n      config: {}\n`)
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const attachmentBytes = new Map<string, Uint8Array>([
    ['local-docx', docx],
    ['scanned-pdf', blankPdf()],
    ['scanned-pdf-3', blankPdf(3)],
  ])
  const attachments = {
    readFileStream: async function* (ref: { id: string }) { yield attachmentBytes.get(ref.id) ?? new Uint8Array() },
    saveImages: async (inputs: readonly { data: Uint8Array; mediaType: string; name?: string }[]) =>
      inputs.map((input, index) => ({ id: `saved-image-${String(index)}`, name: input.name, mediaType: input.mediaType })),
  }
  const OfficePlugin = { name, inject, Config, apply }
  const contexts: Context[] = []
  const start = async (): Promise<Context> => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (context) => {
      context.provide('profileContext', profile)
      context.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
      context.provide('attachments', attachments as never)
      Object.assign(context.loader.builtins, {
        editor: ConfigEditor, settings: Settings, model: DefaultModel, office: OfficePlugin,
      })
    })
    contexts.push(ctx)
    return ctx
  }
  onTestFinished(async () => {
    await Promise.allSettled(contexts.map(context => context.fiber.dispose()))
    rmSync(home, { recursive: true, force: true })
  })
  return { start, profile }
}

describe('Office Loader lifecycle', () => {
  it('keeps saved remote settings served after a cold restart without Credentials', async () => {
    const host = await officeProfile()
    const first = await host.start()
    expect([...first.loader.entries()].find(entry => entry.options.id === name)?.fiber?.state).toBe(FiberState.ACTIVE)
    await first.settings.update(name, {
      ocrEndpoint: 'https://example.invalid/v1',
      ocrModel: 'acceptance-ocr-model',
    })
    await first.fiber.dispose()

    const restarted = await host.start()
    const office = [...restarted.loader.entries()].find(entry => entry.options.id === name)
    expect(office?.fiber?.state).toBe(FiberState.ACTIVE)
    expect(restarted.settings.describe({ redactSecrets: true }).find(item => item.ns === name)?.value).toMatchObject({
      ocrEndpoint: 'https://example.invalid/v1',
      ocrModel: 'acceptance-ocr-model',
    })
    expect(restarted.get('credentials')).toBeUndefined()
  })

  it('uses late Credentials for remote OCR while local parsing works without it', async () => {
    await withOcrServer(async (endpoint, request) => {
      const host = await officeProfile()
      const first = await host.start()
      await first.settings.update(name, { ocrEndpoint: endpoint, ocrModel: 'loader-test-model' })
      await first.fiber.dispose()
      const restarted = await host.start()
      expect([...restarted.loader.entries()].find(entry => entry.options.id === name)?.fiber?.state).toBe(FiberState.ACTIVE)

      const local = await preStep(restarted, { id: 'local-docx', name: 'report.docx', bytes: docx.byteLength })
      expect(local.messages[0]?.content.at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining('Loader local text') as string })

      const missingCredential = await preStep(restarted, { id: 'scanned-pdf', name: 'scan.pdf', bytes: blankPdf().byteLength })
      expect(missingCredential.messages[0]?.content.at(-1)).toMatchObject({
        type: 'text', text: expect.stringContaining('OCR requires the credentials service') as string,
      })

      restarted.provide('credentials', { resolve: async () => ({ value: 'late-loader-key' }) } as never)
      const remote = await preStep(restarted, { id: 'scanned-pdf', name: 'scan.pdf', bytes: blankPdf().byteLength })
      expect(remote.messages[0]?.content.at(-1)).toMatchObject({ type: 'text', text: expect.stringContaining('Loader OCR text') as string })
      const received = await request
      expect(received.authorization).toBe('Bearer late-loader-key')
      expect(received.body).toContain('loader-test-model')
      await first.fiber.dispose()
      await restarted.fiber.dispose()
    })
  })

  it('sends a scanned page as an image when the turn model reads images, and skips OCR', async () => {
    await withOcrServer(async (endpoint) => {
      const host = await officeProfile()
      const started = await host.start()
      await started.settings.update(name, { ocrEndpoint: endpoint, ocrModel: 'loader-test-model' })

      started.provide('llm', {
        resolveModelMetadata: async () => ({ inputModalities: ['text', 'image'] }),
      } as never)

      const decision = await preStep(
        started,
        { id: 'scanned-pdf', name: 'scan.pdf', bytes: blankPdf().byteLength },
        { provider: 'deepseek', model: 'vision-model' },
      )
      const content = decision.messages[0]?.content ?? []
      expect(content.at(-2)).toMatchObject({ type: 'text', text: expect.stringContaining('its image follows') as string })
      expect(content.at(-1)).toMatchObject({ type: 'image', attachment: { id: expect.any(String) as string } })
      // The OCR endpoint is configured, so a text-only turn is the only case
      // that reaches it; this turn must not.
      expect(content.some(block => block.type === 'text' && 'text' in block && block.text.includes('Loader OCR text'))).toBe(false)
      await started.fiber.dispose()
    })
  })

  it('interleaves each scanned page image with that page marker instead of piling images at the end', async () => {
    await withOcrServer(async (endpoint) => {
      const host = await officeProfile()
      const started = await host.start()
      await started.settings.update(name, { ocrEndpoint: endpoint, ocrModel: 'loader-test-model' })
      started.provide('llm', {
        resolveModelMetadata: async () => ({ inputModalities: ['text', 'image'] }),
      } as never)

      const decision = await preStep(
        started,
        { id: 'scanned-pdf-3', name: 'scan.pdf', bytes: blankPdf(3).byteLength },
        { provider: 'deepseek', model: 'vision-model' },
      )
      const appended = (decision.messages[0]?.content ?? []).slice(1)
      // header, then marker/image pairs — never three images last.
      const shape = appended.map(block => (block.type === 'image' ? 'image' : 'text'))
      expect(shape).toEqual(['text', 'text', 'image', 'text', 'image', 'text', 'image'])
      const markers = appended.filter(block => block.type === 'text').map(block => ('text' in block ? block.text : ''))
      expect(markers[0]).toContain('Extracted from scan.pdf')
      expect(markers[1]).toContain('page 1')
      expect(markers[2]).toContain('page 2')
      expect(markers[3]).toContain('page 3')
      await started.fiber.dispose()
    })
  })
})
