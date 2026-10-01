import { deflateSync } from 'node:zlib'
import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { apply as applyOffice, Config } from '../src/index.ts'

const apiKey = process.env.DSH_FILE_OFFICE_OCR_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip
const endpoint = process.env.DSH_FILE_OFFICE_OCR_ENDPOINT ?? 'https://api.siliconflow.cn/v1'
const model = process.env.DSH_FILE_OFFICE_OCR_MODEL ?? 'PaddlePaddle/PaddleOCR-VL-1.5'
const expectedText = 'DSH OCR 7421'

function rasterTextPdf(): Uint8Array {
  const width = 1600
  const height = 400
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#111111'
  context.font = 'bold 112px sans-serif'
  context.textBaseline = 'middle'
  context.fillText(expectedText, 100, height / 2)
  const pixels = context.getImageData(0, 0, width, height).data
  const rgb = Buffer.allocUnsafe(width * height * 3)
  for (let source = 0, target = 0; source < pixels.length; source += 4) {
    rgb[target++] = pixels[source]!
    rgb[target++] = pixels[source + 1]!
    rgb[target++] = pixels[source + 2]!
  }
  const image = deflateSync(rgb)
  const objects: Buffer[] = []
  const offsets = [0]
  let length = Buffer.byteLength('%PDF-1.4\n')
  const addObject = (value: Buffer | string): void => {
    offsets.push(length)
    const body = typeof value === 'string' ? Buffer.from(value) : value
    const object = Buffer.concat([Buffer.from(`${String(objects.length + 1)} 0 obj\n`), body, Buffer.from('\nendobj\n')])
    objects.push(object)
    length += object.byteLength
  }
  addObject('<< /Type /Catalog /Pages 2 0 R >>')
  addObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  addObject('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 200] /Resources << /XObject << /Raster 5 0 R >> >> /Contents 4 0 R >>')
  const content = Buffer.from('q\n800 0 0 200 0 0 cm\n/Raster Do\nQ\n')
  addObject(Buffer.concat([
    Buffer.from(`<< /Length ${String(content.byteLength)} >>\nstream\n`), content, Buffer.from('endstream'),
  ]))
  addObject(Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${String(width)} /Height ${String(height)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${String(image.byteLength)} >>\nstream\n`),
    image,
    Buffer.from('\nendstream'),
  ]))
  const xref = length
  const trailer = [
    `xref\n0 ${String(offsets.length)}\n`,
    '0000000000 65535 f \n',
    ...offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${String(offsets.length)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`,
  ].join('')
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), ...objects, Buffer.from(trailer)])
}

maybe('Office scanned PDF OCR real API', () => {
  it('logs recognized raster text on the admitted user message and retains its FileBlock', async () => {
    const bytes = rasterTextPdf()
    expect(Buffer.from(bytes).includes(Buffer.from(expectedText))).toBe(false)

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.provide('attachments', {
      readFileStream: async function* () { yield bytes },
    } as never)
    ctx.provide('credentials', {
      resolve: async (ref: string) => ref === 'DSH_FILE_OFFICE_OCR_API_KEY' ? { value: apiKey! } : undefined,
    } as never)
    const config = z.resolve({ ocrEndpoint: endpoint, ocrModel: model }, Config, {})[0] as Config
    await ctx.plugin(applyOffice, config)
    const adapter = new MockAdapter([textResponse('done')])
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = await ctx.agentLoop.create(SessionId('office-ocr-e2e'), { provider: 'mock', model: 'mock' })

    try {
      const idle = new Promise<void>((resolve) => {
        const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
          if (subject === agent && status === 'idle') { dispose(); resolve() }
        })
      })
      agent.followup(createUserMessage({
        content: [{ type: 'file', attachment: { id: 'raster-ocr-e2e', name: 'raster-scan.pdf', bytes: bytes.byteLength } as never }],
        source: { kind: 'user' },
      }))
      await idle

      const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
      expect(event?.type).toBe('user/message')
      if (event?.type !== 'user/message') throw new Error('expected the admitted user message')
      expect(event.data.content[0]).toMatchObject({ type: 'file', attachment: { id: 'raster-ocr-e2e', name: 'raster-scan.pdf' } })
      const recordedText = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(' ')
      expect(recordedText.replace(/\s+/g, ' ')).toContain(expectedText)
      expect(adapter.requests).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  }, 120_000)
})
