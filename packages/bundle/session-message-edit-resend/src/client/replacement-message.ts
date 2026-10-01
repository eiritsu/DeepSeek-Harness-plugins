/** Transcript contribution for a durable edit-and-resend replacement prompt. */

import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ConversationNodeDefinition, UserMessageNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { isReplacementSurfaceEvent } from '@deepseek-ai/dsh-session/surface'

/** Render a replacement user prompt as an explicitly edited transcript row. */
export const replacementMessageDefinition: ConversationNodeDefinition<UserMessageNode> = {
  kind: 'edit-resend-user-message',
  target: 'chat',
  match(event) {
    if (event.type !== 'user/message' || !isReplacementSurfaceEvent(event)
      || event.data.source.kind !== 'user') return null
    return { id: String(event.data.id), role: 'start' }
  },
  start(_context, match) {
    const event = match.event
    if (event.type !== 'user/message') throw new Error('edit-resend transcript requires user/message')
    return {
      kind: 'user',
      seq: Number(event.seq),
      time: event.time,
      content: event.data.content,
      source: event.data.source,
    }
  },
  update: context => context.state,
  buildViewNode(context) {
    if (context.state === undefined || context.start?.event.type !== 'user/message') return null
    return {
      key: context.key,
      id: context.id,
      kind: 'user',
      target: 'chat',
      anchorSeq: context.state.seq,
      location: context.start.location,
      visibility: 'visible',
      data: context.state,
    } satisfies ChatNode<'user'>
  },
}
