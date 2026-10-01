import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { zipSync, strToU8 } from 'fflate'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { apply as applyOffice, Config } from '../src/index.ts'

async function harness(fileBytes: Uint8Array = docx, config: Record<string, unknown> = {}, credentials?: unknown) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.provide('attachments', {
    readFileStream: async function* () {
      yield fileBytes
    },
  } as never)
  if (credentials !== undefined) ctx.provide('credentials', credentials as never)
  const runtimeConfig = z.resolve(config, Config, {})[0] as Config
  await ctx.plugin(applyOffice, runtimeConfig)
  const adapter = new MockAdapter([textResponse('ok')])
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('office-fileblock'), { provider: 'mock', model: 'mock' })
  return { ctx, agent, adapter, config: runtimeConfig }
}

function blankPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
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

afterEach(() => { vi.unstubAllGlobals() })

async function withOcrServer(
  run: (
    endpoint: string,
    request: Promise<{ path: string; headers: Record<string, string | string[] | undefined>; body: string }>,
  ) => Promise<void>,
): Promise<void> {
  let resolveRequest!: (value: { path: string; headers: Record<string, string | string[] | undefined>; body: string }) => void
  const request = new Promise<{ path: string; headers: Record<string, string | string[] | undefined>; body: string }>((resolve) => {
    resolveRequest = resolve
  })
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => { chunks.push(Buffer.from(chunk)) })
    req.on('end', () => {
      resolveRequest({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'Recognized page text' } }] }))
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

const docx = zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
  'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly attachment text</w:t></w:r></w:p></w:body></w:document>'),
})

describe('Office pre-step attachment admission', () => {
  it('starts with saved remote endpoints before Credentials registers, then resolves the late service per request', async () => {
    await withOcrServer(async (endpoint, request) => {
      const { ctx, agent } = await harness(blankPdf(), {
        ocrEndpoint: endpoint,
        ocrModel: 'late-credentials-model',
      })
      ctx.provide('credentials', { resolve: async () => ({ value: 'late-test-key' }) } as never)
      try {
        const idle = new Promise<void>((resolve) => {
          const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
            if (subject === agent && status === 'idle') { dispose(); resolve() }
          })
        })
        agent.followup(createUserMessage({
          content: [{ type: 'file', attachment: { id: 'late-credential-scan', name: 'scan.pdf', bytes: blankPdf().byteLength } as never }],
          source: { kind: 'user' },
        }))
        await idle
        const received = await request
        expect(received.headers.authorization).toBe('Bearer late-test-key')
        expect(JSON.parse(received.body)).toMatchObject({ model: 'late-credentials-model' })
      } finally {
        await ctx.fiber.dispose()
      }
    })
  })

  it('treats blank optional endpoint settings as disabled', async () => {
    await expect(harness(docx, { ocrEndpoint: '', ocrModel: '' })).resolves.toBeDefined()
  })

  it('validates one live OCR settings snapshot before each admitted batch', async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: 'Recognized page text' } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const credentials = { resolve: async () => ({ value: 'ocr-key' }) }
    const { ctx, agent, config } = await harness(blankPdf(), {}, credentials)
    updateVolatile(config.ocrEndpoint, createVolatile('https://vision.example/v1'))
    updateVolatile(config.ocrModel, createVolatile('vision-test'))

    const waitForIdle = (): Promise<void> => new Promise((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    const send = (id: string): void =>{  agent.followup(createUserMessage({
      content: [{ type: 'file', attachment: { id, name: 'scan.pdf', bytes: blankPdf().byteLength } as never }],
      source: { kind: 'user' },
    })) }

    const validIdle = waitForIdle()
    send('valid-live-endpoint')
    await validIdle
    expect(fetchMock).toHaveBeenCalledWith('https://vision.example/v1/chat/completions', expect.any(Object))
    const logged = agent.session.snapshotEvents().filter(event => event.type === 'user/message')
    expect(logged).toHaveLength(1)

    updateVolatile(config.ocrEndpoint, createVolatile('http://vision.example/v1'))
    const invalidIdle = waitForIdle()
    send('invalid-live-endpoint')
    await invalidIdle
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message')).toHaveLength(1)
  })

  it('adds extracted text before the same FileBlock message is logged', async () => {
    const { ctx, agent, adapter } = await harness()
    const attachment = { id: 'docx-id', name: 'report.docx', bytes: docx.byteLength } as never
    const beforeLog: boolean[] = []
    ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
      if (subject === agent) beforeLog.push(!agent.session.snapshotEvents().some(event => event.type === 'user/message'))
      return next()
    })
    const idle = new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })

    agent.followup(createUserMessage({
      content: [{ type: 'file', attachment }],
      source: { kind: 'user' },
    }))
    await idle

    expect(beforeLog).toEqual([true])
    const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('expected one logged user message')
    expect(event.data.content[0]).toEqual({ type: 'file', attachment })
    expect(event.data.content[1]).toMatchObject({ type: 'text', text: expect.stringContaining('Quarterly attachment text') as string })
    expect(adapter.requests).toHaveLength(1)
  })

  it('keeps the FileBlock and reports malformed supported Office files in the admitted message', async () => {
    const bytes = Buffer.from('not a zip archive')
    const { agent, adapter } = await harness(bytes)
    const attachment = { id: 'broken-docx', name: 'broken.docx', bytes: bytes.byteLength } as never
    const idle = new Promise<void>((resolve) => {
      const dispose = agent.ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({ content: [{ type: 'file', attachment }], source: { kind: 'user' } }))
    await idle

    const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('expected the original user message')
    expect(event.data.content[0]).toEqual({ type: 'file', attachment })
    expect(event.data.content[1]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('could not preprocess broken.docx: file is not a valid Office archive') as string,
    })
    expect(adapter.requests).toHaveLength(1)
  })

  it('reports scanned PDF pages when OCR is not configured and retains the original file', async () => {
    const bytes = blankPdf()
    const { agent, adapter } = await harness(bytes)
    const attachment = { id: 'scan-pdf', name: 'scan.pdf', bytes: bytes.byteLength } as never
    const idle = new Promise<void>((resolve) => {
      const dispose = agent.ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({ content: [{ type: 'file', attachment }], source: { kind: 'user' } }))
    await idle

    const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('expected the original user message')
    expect(event.data.content[0]).toEqual({ type: 'file', attachment })
    expect(event.data.content[1]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('OCR is not configured') as string,
    })
    expect(adapter.requests).toHaveLength(1)
  })

  it('reports missing OCR credentials while retaining scanned PDF input', async () => {
    const bytes = blankPdf()
    const credentials = { resolve: async () => undefined }
    const config = { ocrEndpoint: 'https://ocr.example/v1/chat/completions', ocrModel: 'vision' }
    const { agent } = await harness(bytes, config, credentials)
    const attachment = { id: 'scan-no-key', name: 'scan.pdf', bytes: bytes.byteLength } as never
    const idle = new Promise<void>((resolve) => {
      const dispose = agent.ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({ content: [{ type: 'file', attachment }], source: { kind: 'user' } }))
    await idle

    const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('expected the original user message')
    expect(event.data.content[0]).toEqual({ type: 'file', attachment })
    expect(event.data.content[1]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('OCR credential DSH_FILE_OFFICE_OCR_API_KEY is not configured') as string,
    })
  })

  it('keeps local Office extraction active with a remote endpoint but no Credentials service', async () => {
    const { agent } = await harness(docx, {
      ocrEndpoint: 'https://ocr.example/v1',
      ocrModel: 'vision',
    })
    const idle = new Promise<void>((resolve) => {
      const dispose = agent.ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({
      content: [{ type: 'file', attachment: { id: 'office-no-credentials', name: 'report.docx', bytes: docx.byteLength } as never }],
      source: { kind: 'user' },
    }))
    await idle

    const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('expected the admitted user message')
    expect(event.data.content[1]).toMatchObject({ type: 'text', text: expect.stringContaining('Quarterly attachment text') as string })
  })

  it('reports a missing Credentials service only when a configured remote endpoint is used', async () => {
    const { agent } = await harness(blankPdf(), {
      ocrEndpoint: 'https://ocr.example/v1',
      ocrModel: 'vision',
    })
    const idle = new Promise<void>((resolve) => {
      const dispose = agent.ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({
      content: [{ type: 'file', attachment: { id: 'scan-no-credentials-service', name: 'scan.pdf', bytes: blankPdf().byteLength } as never }],
      source: { kind: 'user' },
    }))
    await idle

    const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('expected the admitted user message')
    expect(event.data.content[1]).toMatchObject({
      type: 'text', text: expect.stringContaining('OCR requires the credentials service') as string,
    })
  })

  it('reports OCR HTTP failures while retaining scanned PDF input', async () => {
    const bytes = blankPdf()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unavailable', { status: 503 })))
    const credentials = { resolve: async () => ({ value: 'test-key' }) }
    const config = { ocrEndpoint: 'https://ocr.example/v1/chat/completions', ocrModel: 'vision' }
    const { agent } = await harness(bytes, config, credentials)
    const attachment = { id: 'scan-http', name: 'scan.pdf', bytes: bytes.byteLength } as never
    const idle = new Promise<void>((resolve) => {
      const dispose = agent.ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({ content: [{ type: 'file', attachment }], source: { kind: 'user' } }))
    await idle

    const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('expected the original user message')
    expect(event.data.content[0]).toEqual({ type: 'file', attachment })
    expect(event.data.content[1]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('OCR endpoint returned HTTP 503') as string,
    })
  })

  it.each([
    { label: 'API base URL', fullPath: false },
    { label: 'complete operation URL', fullPath: true },
  ])('sends scanned-page OCR to the configured $label with the model and credential', async ({ fullPath }) => {
    await withOcrServer(async (baseEndpoint, request) => {
      const endpoint = fullPath ? `${baseEndpoint}/chat/completions` : baseEndpoint
      const credentials = { resolve: async () => ({ value: 'local-test-key' }) }
      const { ctx, agent } = await harness(blankPdf(), { ocrEndpoint: endpoint, ocrModel: 'local-vision-model' }, credentials)
      try {
        const idle = new Promise<void>((resolve) => {
          const dispose = agent.ctx.on('agent/status', ({ agent: subject, status }) => {
            if (subject === agent && status === 'idle') { dispose(); resolve() }
          })
        })
        agent.followup(createUserMessage({
          content: [{ type: 'file', attachment: { id: 'scan-local-ocr', name: 'scan.pdf', bytes: blankPdf().byteLength } as never }],
          source: { kind: 'user' },
        }))
        await idle

        const received = await request
        expect(received.path).toBe('/v1/chat/completions')
        expect(received.headers.authorization).toBe('Bearer local-test-key')
        const payload = JSON.parse(received.body) as {
          model: string
          messages: { content: { type: string; image_url?: { url: string } }[] }[]
        }
        expect(payload.model).toBe('local-vision-model')
        expect(payload.messages[0]?.content).toEqual([
          expect.objectContaining({ type: 'text' }),
          expect.objectContaining({ type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) as string } }),
        ])
      } finally {
        await ctx.fiber.dispose()
      }
    })
  })

  it('transcribes uploaded audio through the configured OpenAI-compatible endpoint', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST')
      expect(init?.body).toBeInstanceOf(FormData)
      expect((init?.body as FormData).get('model')).toBe('whisper-test')
      return Response.json({ text: 'Audio transcript words' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const credentials = { resolve: async () => ({ value: 'audio-key' }) }
    const { agent } = await harness(Buffer.from('audio bytes'), {
      audioEndpoint: 'https://audio.example/v1', audioModel: 'whisper-test',
    }, credentials)
    const idle = new Promise<void>((resolve) => {
      const dispose = agent.ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({
      content: [{ type: 'file', attachment: { id: 'audio', name: 'sample.wav', bytes: 11 } as never }],
      source: { kind: 'user' },
    }))
    await idle

    expect(fetchMock).toHaveBeenCalledWith('https://audio.example/v1/audio/transcriptions', expect.any(Object))
    const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('expected the admitted user message')
    expect(event.data.content[1]).toMatchObject({ type: 'text', text: expect.stringContaining('Audio transcript words') as string })
  })

  it('sends uploaded video as a video_url content block to the configured model', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('expected a JSON request body')
      const body = JSON.parse(init.body) as {
        model: string
        messages: Array<{ content: Array<{ type: string; video_url?: { url: string } }> }>
      }
      expect(body.model).toBe('video-test')
      expect(body.messages[0]?.content[1]).toMatchObject({
        type: 'video_url', video_url: { url: expect.stringContaining('data:video/mp4;base64,') as string },
      })
      return Response.json({ choices: [{ message: { content: 'Video summary' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const credentials = { resolve: async () => ({ value: 'video-key' }) }
    const { agent } = await harness(Buffer.from('video bytes'), {
      videoEndpoint: 'https://video.example/v1', videoModel: 'video-test',
    }, credentials)
    const idle = new Promise<void>((resolve) => {
      const dispose = agent.ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({
      content: [{ type: 'file', attachment: { id: 'video', name: 'clip.mp4', bytes: 11 } as never }],
      source: { kind: 'user' },
    }))
    await idle

    expect(fetchMock).toHaveBeenCalledWith('https://video.example/v1/chat/completions', expect.any(Object))
    const event = agent.session.snapshotEvents().find(entry => entry.type === 'user/message')
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('expected the admitted user message')
    expect(event.data.content[1]).toMatchObject({ type: 'text', text: expect.stringContaining('Video summary') as string })
  })

  it('routes .mpeg only to video understanding with a video MIME type', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('expected a JSON request body')
      const body = JSON.parse(init.body) as { messages: Array<{ content: Array<{ video_url?: { url: string } }> }> }
      expect(body.messages[0]?.content[1]?.video_url?.url).toContain('data:video/mpeg;base64,')
      return Response.json({ choices: [{ message: { content: 'MPEG video summary' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const credentials = { resolve: async () => ({ value: 'media-key' }) }
    const { agent } = await harness(Buffer.from('mpeg bytes'), {
      audioEndpoint: 'https://audio.example/v1', audioModel: 'audio-test',
      videoEndpoint: 'https://video.example/v1', videoModel: 'video-test',
    }, credentials)
    const idle = new Promise<void>((resolve) => {
      const dispose = agent.ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') { dispose(); resolve() }
      })
    })
    agent.followup(createUserMessage({
      content: [{ type: 'file', attachment: { id: 'mpeg-video', name: 'clip.mpeg', bytes: 10 } as never }],
      source: { kind: 'user' },
    }))
    await idle

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://video.example/v1/chat/completions', expect.any(Object))
  })
})
