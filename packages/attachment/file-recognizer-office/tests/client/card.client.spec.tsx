// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { OfficeRecognitionCard, type OfficeRecognitionCardProps } from '../../src/client/OfficeRecognitionCard.tsx'
import type { OfficeRecognitionCardState } from '../../src/client/controller.ts'
import { en } from '../../src/client/locales.ts'

afterEach(cleanup)

const shell: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}
const field = (text = ''): SettingsFieldState => ({ text, overridden: false, invalid: false })

describe('Office recognition Settings fields', () => {
  it('groups OCR, audio, video, and local limits while retaining field ownership', () => {
    const state: OfficeRecognitionCardState = {
      ...shell,
      maxInputBytes: field('33554432'), maxExtractedChars: field('200000'), maxPdfPages: field('20'),
      ocrEndpoint: field(), ocrModel: field(), audioEndpoint: field(), audioModel: field(),
      videoEndpoint: field(), videoModel: field(), ocrApiKey: field(), audioApiKey: field(), videoApiKey: field(),
      apiKeyConfigured: false, apiKeyWritable: true,
      audioApiKeyConfigured: false, audioApiKeyWritable: true,
      videoApiKeyConfigured: false, videoApiKeyWritable: true,
    }
    const store = createSnapshotStore(state)
    const props = {
      t: (key: keyof typeof en) => en[key],
      useOfficeRecognitionCard: bindSnapshotSelector(store),
      edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn(),
    } as OfficeRecognitionCardProps

    render(<OfficeRecognitionCard {...props} />)

    const ocr = screen.getByRole('region', { name: en.ocrGroup })
    const audio = screen.getByRole('region', { name: en.audioGroup })
    const video = screen.getByRole('region', { name: en.videoGroup })
    const limits = screen.getByRole('region', { name: en.limitsGroup })
    expect(ocr.contains(screen.getByLabelText(en.apiKey))).toBe(true)
    expect(ocr.contains(screen.getByLabelText(en.endpoint))).toBe(true)
    expect(audio.contains(screen.getByLabelText(en.audioApiKey))).toBe(true)
    expect(video.contains(screen.getByLabelText(en.videoApiKey))).toBe(true)
    expect(limits.contains(screen.getByLabelText(en.maxPdfPages))).toBe(true)
    expect((screen.getByRole<HTMLButtonElement>('button', { name: en.save })).disabled).toBe(true)
  })
})
