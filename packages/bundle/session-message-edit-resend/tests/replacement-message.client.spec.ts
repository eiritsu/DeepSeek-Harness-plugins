import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationNodeContext, ConversationStartMatch, UserMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { replacementMessageDefinition } from '../src/client/replacement-message.ts'

describe('replacement transcript contribution', () => {
  it('renders the durable replacement user content through the official user renderer', () => {
    const event = {
      type: 'user/message',
      seq: SessionSeq(8),
      time: 10,
      data: createUserMessage({
        content: [
          { type: 'text', text: 'Edited prompt.' },
          { type: 'file', attachment: { attachmentId: AttachmentId('file-1'), name: 'report.docx', bytes: 20480 } },
        ],
        source: { kind: 'user' },
      }),
      surfaceOp: { op: 'replace', startSeq: SessionSeq(2), endSeq: SessionSeq(5) },
      sourceEventSeqs: [SessionSeq(2), SessionSeq(3), SessionSeq(4), SessionSeq(5)],
    } as SessionEvent<'user/message'>
    const result = replacementMessageDefinition.match(event)
    expect(result).toEqual({ id: String(event.data.id), role: 'start' })

    const startMatch = {
      event,
      role: 'start',
      location: { kind: 'session' },
    } satisfies ConversationStartMatch
    const state = replacementMessageDefinition.start(
      {} as ConversationNodeContext<UserMessageNode>,
      startMatch,
      undefined as never,
    )
    const view = replacementMessageDefinition.buildViewNode?.({
      key: 'edit-resend-user-message:1',
      kind: replacementMessageDefinition.kind,
      id: String(event.data.id),
      matches: [startMatch],
      start: startMatch,
      state,
      current: new Map(),
    })

    expect(view).toMatchObject({ kind: 'user', target: 'chat', visibility: 'visible' })
    expect(view?.data).toMatchObject({ kind: 'user', content: event.data.content })
  })

  it('does not claim append-origin user messages', () => {
    const event = {
      type: 'user/message',
      seq: SessionSeq(8),
      time: 10,
      data: createUserMessage({ content: [{ type: 'text', text: 'Ordinary prompt.' }], source: { kind: 'user' } }),
      surfaceOp: 'append',
    } as SessionEvent<'user/message'>

    expect(replacementMessageDefinition.match(event)).toBeNull()
  })
})
