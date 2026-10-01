// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-session-message-edit-resend/remote', () => ({ default: {} }))
import { apply, inject } from '../src/client/index.ts'

afterEach(() => { vi.restoreAllMocks() })

it('mounts its own Remote before requiring the namespace and releases both scopes', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', { scope: () => ({}) } as never)
  ctx.provide('conversation', { registerSubmitDispatcher: () => () => {} } as never)
  ctx.provide('uiConversation', { events: { register: () => () => {} } } as never)

  let releaseNamespace: (() => void) | undefined
  const remoteNamespace = {
    latestStatus: async () => ({ ok: true, value: undefined }),
    status: async () => ({ ok: true, value: undefined }),
    replace: async () => ({ ok: true, value: { kind: 'completed', requestId: 'request' } }),
  }
  const disposeRemote = vi.fn(async () => { releaseNamespace?.() })
  const mountRemote = vi.fn(async () => {
    releaseNamespace = ctx.provide('remote.messageEditResend', remoteNamespace)
    return disposeRemote
  })
  ctx.provide('remote', { $mount: mountRemote } as never)

  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'conversation.chat.user-actions': { kind: 'list', scope: 'root' },
    'conversation.input.overlay': { kind: 'list', scope: 'root' },
  } } as never, () => null)

  expect(inject).not.toContain('remote.messageEditResend')
  await ctx.plugin({ inject: [...inject], apply }).await()

  expect(mountRemote).toHaveBeenCalledOnce()
  expect(slots.entries('conversation.chat.user-actions').map(entry => entry.options.id)).toContain('edit-resend')
  expect(slots.entries('conversation.input.overlay').map(entry => entry.options.id)).toContain('edit-resend')

  await ctx.fiber.dispose()
  expect(disposeRemote).toHaveBeenCalledOnce()
})
