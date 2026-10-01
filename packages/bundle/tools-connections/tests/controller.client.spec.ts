import { describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { ToolsConnectionsController, type Settings } from '../src/client/controller.ts'

function credentialReply(refs: string[], configured = false) {
  return Object.fromEntries(refs.map(ref => [ref, { configured, writable: true }]))
}

function context() {
  const describe = vi.fn(async (refs: string[]) => ({ ok: true as const, value: credentialReply(refs) }))
  const set = vi.fn(async () => ({ ok: true as const, value: undefined }))
  return { ctx: { remote: { credentials: { describe, set } } } as never, describe, set }
}

describe('ToolsConnectionsController', () => {
  it('keeps API keys in credentials and never stages key text in ordinary settings', async () => {
    const settings = stubConfigForm<Settings>()
    const api = context()
    const controller = new ToolsConnectionsController(settings.scope, api.ctx)
    settings.publish({ status: 'ready', writable: true, value: {}, user: {} })
    await vi.waitFor(() => { expect(api.describe).toHaveBeenCalled() })
    const face = controller.inject()

    face.edit('braveEnabled', 'true')
    face.edit('braveKey', ' brave-secret ')
    face.edit('firecrawlEnabled', 'true')
    face.edit('firecrawlBaseURL', 'https://firecrawl.example')
    face.edit('firecrawlMaxMarkdownChars', '24000')
    face.edit('firecrawlKey', ' firecrawl-secret ')
    face.save()
    await vi.waitFor(() => { expect(api.set).toHaveBeenCalledWith('BRAVE_SEARCH_API_KEY', 'brave-secret') })
    await vi.waitFor(() => { expect(api.set).toHaveBeenCalledWith('FIRECRAWL_API_KEY', 'firecrawl-secret') })
    await vi.waitFor(() => { expect(settings.mutate).toHaveBeenCalled() })
    expect(settings.mutate.mock.calls[0]?.[0]).not.toContainEqual(expect.objectContaining({ path: ['braveKey'] }))
    expect(settings.mutate.mock.calls[0]?.[0]).not.toContainEqual(expect.objectContaining({ path: ['firecrawlKey'] }))
    expect(settings.mutate.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['firecrawlEnabled'], value: true }),
      expect.objectContaining({ path: ['firecrawlBaseURL'], value: 'https://firecrawl.example' }),
      expect.objectContaining({ path: ['firecrawlMaxMarkdownChars'], value: 24000 }),
    ]))
    controller.dispose()
  })

  it('ignores an older credential response after a reference change', async () => {
    const settings = stubConfigForm<Settings>()
    let releaseOld: ((value: { ok: true; value: Record<string, { configured: boolean; writable: boolean }> }) => void) | undefined
    const describe = vi.fn((refs: string[]) => {
      if (refs.includes('OLD_KEY')) return new Promise((resolve) => { releaseOld = resolve })
      return Promise.resolve({ ok: true as const, value: credentialReply(refs, true) })
    })
    const controller = new ToolsConnectionsController(settings.scope, {
      remote: { credentials: { describe, set: vi.fn(async () => ({ ok: true as const, value: undefined })) } },
    } as never)
    settings.publish({ status: 'ready', writable: true, value: { braveApiKeyRef: 'OLD_KEY' }, user: {} })
    await vi.waitFor(() => { expect(describe).toHaveBeenCalledWith(['OLD_KEY', 'TAVILY_API_KEY', 'FIRECRAWL_API_KEY']) })
    settings.publish({ value: { braveApiKeyRef: 'NEW_KEY' } })
    await vi.waitFor(() => { expect(controller.inject().hooks.toolsConnections.getSnapshot().braveKeyConfigured).toBe(true) })
    releaseOld?.({ ok: true, value: credentialReply(['OLD_KEY', 'TAVILY_API_KEY'], false) })
    await Promise.resolve()

    expect(controller.inject().hooks.toolsConnections.getSnapshot().braveKeyConfigured).toBe(true)
    controller.dispose()
  })

  it('does not publish a credential response after disposal', async () => {
    const settings = stubConfigForm<Settings>()
    let release: ((value: { ok: true; value: Record<string, { configured: boolean; writable: boolean }> }) => void) | undefined
    const describe = vi.fn((_refs: string[]) => new Promise((resolve) => { release = resolve }))
    const controller = new ToolsConnectionsController(settings.scope, {
      remote: { credentials: { describe, set: vi.fn() } },
    } as never)
    const state = controller.inject().hooks.toolsConnections.getSnapshot()
    controller.dispose()
    release?.({ ok: true, value: credentialReply(['BRAVE_SEARCH_API_KEY', 'TAVILY_API_KEY', 'FIRECRAWL_API_KEY'], true) })
    await Promise.resolve()

    expect(controller.inject().hooks.toolsConnections.getSnapshot()).toBe(state)
  })
})
