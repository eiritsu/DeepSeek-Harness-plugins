import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { ConfigForms } from '@deepseek-ai/dsh-client-ui-settings/src/client/config-form.ts'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { SettingsDescribeMirror } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { acceptsOfficeNativeUpload } from '../../src/supported-file-types.ts'

const namespace = 'file-recognizer-office'
const schema = z.object({
  audioEndpoint: z.string().default(''),
  audioModel: z.string().default(''),
  videoEndpoint: z.string().default(''),
  videoModel: z.string().default(''),
})

function answer(
  value: Record<string, string>,
  revision: number,
): { ok: true; value: { writable: true; hasDocument: true; namespaces: SettingsNamespaceView[] } } {
  return { ok: true, value: { writable: true, hasDocument: true, namespaces: [namespaceView(value, revision)] } }
}

function namespaceView(value: Record<string, string>, revision: number): SettingsNamespaceView {
  return {
    ns: namespace,
    schema: JSON.parse(JSON.stringify(schema.toJSON())) as SettingsNamespaceView['schema'],
    value,
    autoGenerate: true,
    applies: 'live',
    secrets: [],
    revision,
  }
}

describe('Office native composer file intake', () => {
  it('routes Office and PDF immediately, and media only from accepted ConfigForm values', async () => {
    let accepted = { audioEndpoint: '', audioModel: '', videoEndpoint: '', videoModel: '' }
    let revision = 1
    const describeRemote = vi.fn(async () => answer(accepted, revision))
    const mutateRemote = vi.fn(async (_ns: string, ops: readonly { op: string; path: string[]; value?: unknown }[]) => {
      for (const op of ops) if (op.op === 'set') accepted = { ...accepted, [op.path[0] as string]: op.value as string }
      revision += 1
      return { ok: true as const, value: namespaceView(accepted, revision) }
    })
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    new TestRemote(ctx, { settings: { describe: describeRemote, mutate: mutateRemote } })
    const mirror = new SettingsDescribeMirror(ctx)
    const schemaContext = new Context()
    onTestFinished(() => schemaContext.fiber.dispose())
    const settingsSchema = new SettingsSchemaService(schemaContext)
    await ctx.plugin(ConfigForms, { mirror, schema: settingsSchema, persistence: 'host' }).await()
    let form!: ReturnType<typeof ctx.configForms.get<Record<string, string>>>
    const consumer = ctx.plugin({
      inject: ['remote', 'configForms'],
      apply: (scope: Context) => { form = scope.configForms.get(namespace) },
    })
    await consumer.await()
    await vi.waitFor(() =>{  expect(form.getSnapshot()).toMatchObject({ status: 'ready', value: { audioEndpoint: '' } }) })

    const accepts = (name: string): boolean => acceptsOfficeNativeUpload(name, form.getSnapshot().value)
    expect(accepts('report.DOCX')).toBe(true)
    expect(accepts('scan.pdf')).toBe(true)
    expect(accepts('clip.mp3')).toBe(false)
    expect(accepts('notes.txt')).toBe(false)

    await expect(form.set('audioEndpoint', 'https://audio.example/v1')).resolves.toBe(true)
    expect(form.getSnapshot().value).toMatchObject({ audioEndpoint: 'https://audio.example/v1' })
    expect(accepts('clip.mp3')).toBe(false)
    await expect(form.set('audioModel', 'transcribe-test')).resolves.toBe(true)
    expect(form.getSnapshot().value).toMatchObject({ audioEndpoint: 'https://audio.example/v1', audioModel: 'transcribe-test' })
    expect(accepts('clip.mp3')).toBe(true)
    expect(accepts('movie.webm')).toBe(false)
    await expect(form.set('videoEndpoint', 'https://video.example/v1')).resolves.toBe(true)
    await expect(form.set('videoModel', 'video-test')).resolves.toBe(true)
    expect(accepts('movie.webm')).toBe(true)
    await expect(form.set('audioEndpoint', '')).resolves.toBe(true)
    expect(accepts('clip.mp3')).toBe(false)
    expect(describeRemote).toHaveBeenCalledOnce()
    await consumer.dispose()
  })
})
