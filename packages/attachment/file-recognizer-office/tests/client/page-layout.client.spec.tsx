// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { OfficeRecognitionCard, type OfficeRecognitionCardProps } from '../../src/client/OfficeRecognitionCard.tsx'
import type { OfficeRecognitionCardState } from '../../src/client/controller.ts'
import { en } from '../../src/client/locales.ts'
import css from '../../src/client/OfficeRecognitionCard.module.css'

afterEach(cleanup)

const shell: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}
const field = (text = ''): SettingsFieldState => ({ text, overridden: false, invalid: false })

function buildState(): OfficeRecognitionCardState {
  return {
    ...shell,
    maxInputBytes: field('33554432'), maxExtractedChars: field('200000'), maxPdfPages: field('20'),
    ocrEndpoint: field(), ocrModel: field(), audioEndpoint: field(), audioModel: field(),
    videoEndpoint: field(), videoModel: field(), ocrApiKey: field(), audioApiKey: field(), videoApiKey: field(),
    apiKeyConfigured: false, apiKeyWritable: true,
    audioApiKeyConfigured: false, audioApiKeyWritable: true,
    videoApiKeyConfigured: false, videoApiKeyWritable: true,
  }
}

function renderCard() {
  const store = createSnapshotStore(buildState())
  const props = {
    t: (key: keyof typeof en) => en[key],
    useOfficeRecognitionCard: bindSnapshotSelector(store),
    edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn(),
  } as unknown as OfficeRecognitionCardProps
  return render(<OfficeRecognitionCard {...props} />)
}

describe('Office recognition bundle detail layout', () => {
  it('wraps the SettingsForm body in a single constrained page container', () => {
    renderCard()
    const pageClass = css.page
    const page = document.querySelector(`.${pageClass}`)
    expect(page).not.toBeNull()
    const sectionCount = page?.querySelectorAll(`section.${css.section}`).length ?? 0
    expect(sectionCount).toBe(4)
  })

  it('renders every section heading for OCR, audio, video, and limits', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: en.ocrGroup })).toBeDefined()
    expect(screen.getByRole('heading', { name: en.audioGroup })).toBeDefined()
    expect(screen.getByRole('heading', { name: en.videoGroup })).toBeDefined()
    expect(screen.getByRole('heading', { name: en.limitsGroup })).toBeDefined()
  })
})
