import type { SettingsFormScope, SettingsFormScopeSnapshot } from '@deepseek-ai/dsh-client-ui-primitives'
import { describe, expect, it, vi } from 'vitest'
import {
  OfficeRecognitionCardController, AUDIO_API_KEY_REF, OCR_API_KEY_REF, VIDEO_API_KEY_REF, type OfficeRecognitionSettings,
} from '../../src/client/controller.ts'

function persistedScope(value: OfficeRecognitionSettings = { maxInputBytes: 8192, maxExtractedChars: 12000 }) {
  let snapshot: SettingsFormScopeSnapshot<OfficeRecognitionSettings> = {
    status: 'ready', value, base: { maxInputBytes: 33554432, maxExtractedChars: 200000 },
    user: value, writable: true, revision: 1,
  }
  const listeners = new Set<() => void>()
  const scope: SettingsFormScope<OfficeRecognitionSettings> = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async mutate(ops) {
      const next = { ...snapshot.value }
      for (const op of ops) {
        const key = op.path[0]
        if (key !== undefined && op.op === 'set' && (typeof op.value === 'number' || typeof op.value === 'string')) {
          next[key as keyof typeof next] = op.value as never
        }
      }
      snapshot = { ...snapshot, value: next, user: next, revision: (snapshot.revision ?? 0) + 1 }
      for (const listener of listeners) listener()
      return true
    },
  }
  return scope
}

describe('Office recognition settings controller', () => {
  it('persists OCR, audio and video settings on reopen without exposing any credential', async () => {
    const secrets = new Map<string, string>()
    const configured = (ref: string) => ({ configured: secrets.has(ref), writable: true })
    const ctx = {
      remote: {
        credentials: {
          describe: vi.fn(async (refs: string[]) => ({ ok: true, value: Object.fromEntries(refs.map(ref => [ref, configured(ref)])) })),
          set: vi.fn(async (ref: string, value: string) => { secrets.set(ref, value); return { ok: true, value: undefined } }),
        },
      },
    } as never
    const scope = persistedScope()
    const first = new OfficeRecognitionCardController(scope, ctx)
    const face = first.inject()
    await vi.waitFor(() =>{  expect(face.hooks.officeRecognitionCard.getSnapshot().apiKeyConfigured).toBe(false) })
    face.edit('maxInputBytes', '16384')
    face.edit('ocrEndpoint', 'https://ocr.example/v1/chat/completions')
    face.edit('ocrModel', 'vision-test')
    face.edit('audioEndpoint', 'https://audio.example/v1')
    face.edit('audioModel', 'audio-test')
    face.edit('videoEndpoint', 'https://video.example/v1')
    face.edit('videoModel', 'video-test')
    face.edit('ocrApiKey', 'ocr-secret-never-render')
    face.edit('audioApiKey', 'audio-secret-never-render')
    face.edit('videoApiKey', 'video-secret-never-render')
    face.save()
    await vi.waitFor(() =>{  expect(scope.getSnapshot().value).toMatchObject({
      maxInputBytes: 16384,
      ocrEndpoint: 'https://ocr.example/v1/chat/completions',
      ocrModel: 'vision-test',
      audioEndpoint: 'https://audio.example/v1',
      audioModel: 'audio-test',
      videoEndpoint: 'https://video.example/v1',
      videoModel: 'video-test',
    }) })
    await vi.waitFor(() =>{  expect(secrets.size).toBe(3) })
    expect(secrets.get(OCR_API_KEY_REF)).toBe('ocr-secret-never-render')
    expect(secrets.get(AUDIO_API_KEY_REF)).toBe('audio-secret-never-render')
    expect(secrets.get(VIDEO_API_KEY_REF)).toBe('video-secret-never-render')
    expect(JSON.stringify(face.hooks.officeRecognitionCard.getSnapshot())).not.toContain('never-render')
    first.dispose()

    const reopenedController = new OfficeRecognitionCardController(scope, ctx)
    const reopened = reopenedController.inject().hooks.officeRecognitionCard
    await vi.waitFor(() =>{  expect(reopened.getSnapshot()).toMatchObject({
      apiKeyConfigured: true, audioApiKeyConfigured: true, videoApiKeyConfigured: true,
    }) })
    expect(reopened.getSnapshot().maxInputBytes.text).toBe('16384')
    expect(reopened.getSnapshot().ocrEndpoint.text).toBe('https://ocr.example/v1/chat/completions')
    expect(reopened.getSnapshot().ocrModel.text).toBe('vision-test')
    expect(reopened.getSnapshot().audioEndpoint.text).toBe('https://audio.example/v1')
    expect(reopened.getSnapshot().audioModel.text).toBe('audio-test')
    expect(reopened.getSnapshot().videoEndpoint.text).toBe('https://video.example/v1')
    expect(reopened.getSnapshot().videoModel.text).toBe('video-test')
    expect(reopened.getSnapshot().ocrApiKey.text).toBe('')
    expect(reopened.getSnapshot().audioApiKey.text).toBe('')
    expect(reopened.getSnapshot().videoApiKey.text).toBe('')
    expect(JSON.stringify(reopened.getSnapshot())).not.toContain('never-render')
    reopenedController.dispose()
  })

  it('keeps a rejected credential write as a failed form save', async () => {
    const ctx = {
      remote: {
        credentials: {
          describe: vi.fn(async () => ({ ok: true as const, value: {} })),
          set: vi.fn(async () => ({ ok: false as const, error: { code: 'DENIED', message: 'read only' } })),
        },
      },
    } as never
    const controller = new OfficeRecognitionCardController(persistedScope(), ctx)
    const face = controller.inject()
    await vi.waitFor(() =>{  expect(face.hooks.officeRecognitionCard.getSnapshot().writable).toBe(true) })
    face.edit('ocrApiKey', 'rejected-key')
    face.save()
    await vi.waitFor(() =>{  expect(face.hooks.officeRecognitionCard.getSnapshot().failed).toBe(true) })
    expect(face.hooks.officeRecognitionCard.getSnapshot().apiKeyConfigured).toBe(false)
    controller.dispose()
  })
})
