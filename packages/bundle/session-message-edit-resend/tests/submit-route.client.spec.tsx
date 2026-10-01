// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { EditComposerNotice } from '../src/client/EditComposerNotice.tsx'
import { MessageEditAction } from '../src/client/MessageEditAction.tsx'
import { EditResendSurface } from '../src/client/edit-surface.ts'
import { createEditResendDispatcher } from '../src/client/submit.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('edit-and-resend composer route', () => {
  it('starts the edit draft from primary user text, not appended attachment text', () => {
    const surface = new EditResendSurface()
    const messageId = MessageId('message-1')
    const seq = SessionSeq(3)
    surface.begin({ messageId, seq }, 'saved draft')
    const setDraft = vi.fn()
    const props = {
      messageId,
      seq: Number(seq),
      text: 'Summarize this report.[Extracted from report.docx]\nQuarterly totals',
      primaryText: 'Summarize this report.',
      surface,
      useProjection: () => ({ messageId, seq }),
      useInput: () => 'saved draft',
      inputActions: { setDraft },
      t: (key: string) => key,
    }
    render(createElement(MessageEditAction, props as never))

    fireEvent.click(screen.getByRole('button', { name: 'action.edit' }))

    expect(setDraft).toHaveBeenCalledWith('Summarize this report.')
  })

  it('marks the currently editable replacement row as edited', () => {
    const messageId = MessageId('message-2')
    const seq = SessionSeq(8)
    const props = {
      messageId,
      seq: Number(seq),
      primaryText: 'replacement text',
      surface: new EditResendSurface(),
      useProjection: () => ({ messageId, seq, edited: true }),
      useInput: () => '',
      inputActions: { setDraft: vi.fn() },
      t: (key: string) => key,
    }
    render(createElement(MessageEditAction, props as never))

    expect(screen.getByText('status.edited')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'action.edit' })).toBeTruthy()
  })

  it('keeps the first request id after transport loss and cancel never submits it again', async () => {
    const requestId = '00000000-0000-4000-8000-000000000000'
    vi.stubGlobal('crypto', { getRandomValues: (array: Uint8Array) => array.fill(0) })
    const sessionId = 'session-1' as SessionId
    const surface = new EditResendSurface()
    const draft = surface.begin({ messageId: MessageId('message-1'), seq: SessionSeq(3) }, 'saved draft')
    const replace = vi.fn(async () => { throw new Error('network unavailable') })
    const route = createEditResendDispatcher(() => surface, replace, key => key)
    const submission = {
      sessionId,
      text: 'edited text',
      attachmentIds: [],
      mode: 'queue' as const,
      signal: new AbortController().signal,
      serializeAttachments: async () => [],
      releaseAttachments: () => undefined,
    }

    await expect(route(submission)).resolves.toEqual({ kind: 'error', text: 'error.uncertain' })
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(sessionId, expect.objectContaining({ requestId }))
    expect(surface.state.getSnapshot()).toMatchObject({ phase: 'uncertain', requestId })
    await expect(route(submission)).resolves.toEqual({ kind: 'error', text: 'error.uncertain' })
    expect(replace).toHaveBeenCalledTimes(1)

    const setDraft = vi.fn()
    const props = {
      surface,
      loadLatestStatus: async () => undefined,
      readStatus: async () => undefined,
      inputActions: { setDraft },
      t: (key: string) => key,
    }
    render(createElement(EditComposerNotice, props as never))
    fireEvent.click(screen.getByRole('button', { name: 'action.cancel' }))
    expect(surface.state.getSnapshot()).toBeNull()
    expect(setDraft).toHaveBeenCalledWith(draft.savedDraft)
    await expect(route(submission)).resolves.toBeUndefined()
    expect(replace).toHaveBeenCalledTimes(1)
  })
})
