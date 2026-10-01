/**
 * The Chat node renderers install one keyed entry per node kind into the single
 * `conversation.chat.node` seat. A child slot has exactly one declaring entry,
 * so `conversation.chat.user-actions` must be declared by the `user` entry
 * alone even though `steering` shares the same component: the component renders
 * that seat only for the `user` kind, and a second declaration throws at load.
 */

import { describe, expect, it } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { registerChatNodeRenderers } from '../src/client/chat/register-node-renderers.ts'

/** The Chat node kinds `registerChatNodeRenderers` installs a renderer for. */
const NODE_KINDS = [
  'user', 'steering', 'context', 'turn-trigger', 'system-prompt', 'assistant-step',
  'command', 'manual-compaction', 'compaction', 'model-retry', 'turn-error',
  'turn-max-tokens', 'turn-process', 'turn-tail', 'unknown',
]

/**
 * Mount the Chat node seat the way ui-conversation declares it, then run the
 * registration through a ctx whose `slots.inject` fires as soon as the seat
 * exists — the state a real fiber reaches after the parent registration.
 */
function registerIntoSeat() {
  const core = new SlotCore()
  core.register({
    name: 'root',
    children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } },
  } as never, () => null)
  const ctx = {
    slots: {
      inject: (_name: string, contribute: () => unknown) => contribute(),
      // Type-level slot presence is proven by the ui-slots type-chain specs; erasing
      // the component keeps this fixture focused on runtime registration effects.
      register: (options: unknown, component: unknown) => core.register(options as never, component as never),
    },
  }
  registerChatNodeRenderers(
    ctx as never,
    { getSnapshot: () => 'turn', subscribe: () => () => {} } as never,
    { getSnapshot: () => ({ kind: 'normal' }), subscribe: () => () => {} } as never,
  )
  return core
}

describe('chat node renderers', () => {
  it('installs every node kind without a duplicate child declaration', () => {
    expect(() => registerIntoSeat()).not.toThrow()
  })

  it('declares the user-actions seat once and keeps both message kinds', () => {
    const core = registerIntoSeat()
    expect(core.specDynamic('conversation.chat.user-actions')).toEqual({ kind: 'list', scope: 'session' })
    const keys = core.entries('conversation.chat.node').map(entry => entry.options.key)
    expect(keys).toEqual(NODE_KINDS)
    expect(core.entries('conversation.chat.user-actions')).toHaveLength(0)
  })

  it('rejects a second declaration of the user-actions seat', () => {
    const core = registerIntoSeat()
    expect(() => core.register({
      name: 'conversation.chat.node',
      key: 'imposter',
      children: { 'conversation.chat.user-actions': { kind: 'list', scope: 'session' } },
    } as never, () => null)).toThrow(/already declared/)
  })
})
