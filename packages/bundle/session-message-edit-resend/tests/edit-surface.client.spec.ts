import { describe, expect, it } from 'vitest'
import { EditResendSurface } from '../src/client/edit-surface.ts'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import { SessionSeq } from '@deepseek-ai/dsh-session'

describe('EditResendSurface', () => {
  it('preserves a Session draft on cancel and rejects stale state updates', () => {
    const surface = new EditResendSurface()
    const first = surface.begin({ messageId: MessageId('message-1'), seq: SessionSeq(12) }, 'unsent draft')
    expect(surface.state.getSnapshot()).toEqual({
      ...first,
      savedDraft: 'unsent draft',
      phase: 'editing',
    })
    expect(surface.update(first, 'submitting')).toBe(true)
    expect(surface.update(first, 'failed')).toBe(true)
    expect(surface.clear(first)?.savedDraft).toBe('unsent draft')
    expect(surface.state.getSnapshot()).toBeNull()
  })

  it('keeps each Session surface independent', () => {
    const sessionA = new EditResendSurface()
    const sessionB = new EditResendSurface()
    sessionA.begin({ messageId: MessageId('message-a'), seq: SessionSeq(1) }, 'a draft')
    expect(sessionB.state.getSnapshot()).toBeNull()
  })
})
