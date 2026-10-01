import type { SettingsFormScope, SettingsFormScopeSnapshot } from '@deepseek-ai/dsh-client-ui-primitives'
import { describe, expect, it, vi } from 'vitest'
import { LarkSettingsController, LARK_APP_SECRET_REF, type LarkSettings } from '../src/client/controller.ts'

function persistedScope(value: LarkSettings = {
  appId: 'cli_mock', appSecretEnv: LARK_APP_SECRET_REF, brand: 'feishu',
  authorizedUserOpenId: 'ou_mock', enabled: false, conversationCwd: '',
}) {
  let snapshot: SettingsFormScopeSnapshot<LarkSettings> = {
    status: 'ready', value, base: {}, user: value, writable: true, revision: 1,
  }
  const listeners = new Set<() => void>()
  const scope: SettingsFormScope<LarkSettings> = {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    async mutate(ops) {
      const next = { ...snapshot.value }
      for (const op of ops) {
        const key = op.path[0]
        if (key !== undefined && op.op === 'set') next[key as keyof typeof next] = op.value as never
      }
      snapshot = { ...snapshot, value: next, user: next, revision: (snapshot.revision ?? 0) + 1 }
      for (const listener of listeners) listener()
      return true
    },
  }
  return scope
}

function emptyPending() {
  return vi.fn(async () => ({ ok: true as const, value: { exists: false as const } }))
}

function makeCtx(overrides: { credentials?: unknown; larkSetup?: unknown } = {}) {
  const credentials = overrides.credentials ?? {
    describe: vi.fn(async (refs: string[]) => ({ ok: true as const, value: {
      [refs[0]!]: { configured: true, writable: true },
    } })),
    set: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
  const larkSetup = overrides.larkSetup ?? { describePendingUserAuthorization: emptyPending() }
  return { remote: { credentials, larkSetup } } as never
}

describe('Lark integration Settings controller', () => {
  it('restores the existing-app path for a saved app with a configured credential', async () => {
    const ctx = makeCtx()
    const controller = new LarkSettingsController(persistedScope(), ctx)
    const face = controller.inject()
    await vi.waitFor(() => {
      const state = face.hooks.larkSettings.getSnapshot()
      expect(state.appSecretConfigured).toBe(true)
      expect(state.connectionPath).toBe('existing')
    })
    controller.dispose()
  })

  it('keeps an explicit path choice while the configured credential loads', async () => {
    type Description = { ok: true; value: Record<string, { configured: boolean; writable: boolean }> }
    let resolveDescription!: (value: Description) => void
    const ctx = makeCtx({
      credentials: {
        describe: vi.fn(() => new Promise<Description>((resolve) => {
          resolveDescription = resolve
        })),
      },
    })
    const controller = new LarkSettingsController(persistedScope(), ctx)
    const face = controller.inject()
    face.chooseConnectionPath('quick')
    resolveDescription({ ok: true, value: { [LARK_APP_SECRET_REF]: { configured: true, writable: true } } })
    await vi.waitFor(() => { expect(face.hooks.larkSettings.getSnapshot().appSecretConfigured).toBe(true) })
    expect(face.hooks.larkSettings.getSnapshot().connectionPath).toBe('quick')
    controller.dispose()
  })

  it('stages Host identity fields and keeps credential values write-only', async () => {
    const secrets = new Map<string, string>()
    const ctx = makeCtx({
      credentials: {
        describe: vi.fn(async (refs: string[]) => ({ ok: true as const, value: {
          [refs[0]!]: { configured: secrets.has(refs[0]!), writable: true },
        } })),
        set: vi.fn(async (ref: string, value: string) => { secrets.set(ref, value); return { ok: true, value: undefined } }),
      },
    })
    const controller = new LarkSettingsController(persistedScope(), ctx)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.larkSettings.getSnapshot().appSecretConfigured).toBe(false) })
    expect(face.hooks.larkSettings.getSnapshot().appId.text).toBe('cli_mock')
    face.edit('appSecret', 'mock-only-secret')
    face.save()
    await vi.waitFor(() => { expect(secrets.get(LARK_APP_SECRET_REF)).toBe('mock-only-secret') })
    await vi.waitFor(() => { expect(face.hooks.larkSettings.getSnapshot().appSecretConfigured).toBe(true) })
    expect(face.hooks.larkSettings.getSnapshot().appSecret.text).toBe('')
    expect(JSON.stringify(face.hooks.larkSettings.getSnapshot())).not.toContain('mock-only-secret')
    controller.dispose()
  })

  it('writes and refreshes the selected credential reference', async () => {
    const secrets = new Map<string, string>()
    const ctx = makeCtx({
      credentials: {
        describe: vi.fn(async (refs: string[]) => ({ ok: true as const, value: {
          [refs[0]!]: { configured: secrets.has(refs[0]!), writable: true },
        } })),
        set: vi.fn(async (ref: string, value: string) => { secrets.set(ref, value); return { ok: true, value: undefined } }),
      },
    })
    const controller = new LarkSettingsController(persistedScope(), ctx)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.larkSettings.getSnapshot().appSecretConfigured).toBe(false) })
    face.edit('appSecretEnv', 'TEAM_LARK_SECRET')
    face.save()
    await vi.waitFor(() => { expect(face.hooks.larkSettings.getSnapshot().appSecretEnv.text).toBe('TEAM_LARK_SECRET') })
    face.edit('appSecret', 'mock-secret')
    face.save()
    await vi.waitFor(() => { expect(secrets.get('TEAM_LARK_SECRET')).toBe('mock-secret') })
    expect(secrets.has(LARK_APP_SECRET_REF)).toBe(false)
    controller.refreshCredential('TEAM_LARK_SECRET')
    await vi.waitFor(() => { expect(face.hooks.larkSettings.getSnapshot().appSecretConfigured).toBe(true) })
    controller.dispose()
  })

  it('publishes the saved pending authorization so a refreshed Client can resume the flow', async () => {
    const describePendingUserAuthorization = vi.fn(async () => ({ ok: true as const, value: {
      exists: true as const,
      appId: 'cli_mock', brand: 'feishu', appSecretEnv: LARK_APP_SECRET_REF,
      createdAt: Date.now(), matchesIdentity: true, expired: false,
    } }))
    const ctx = makeCtx({ larkSetup: { describePendingUserAuthorization } })
    const controller = new LarkSettingsController(persistedScope(), ctx)
    const face = controller.inject()
    await vi.waitFor(() => {
      const pending = face.hooks.larkSettings.getSnapshot().pendingAuthorization
      expect(pending).toMatchObject({ matchesIdentity: true, expired: false })
    })
    expect(describePendingUserAuthorization).toHaveBeenCalledOnce()
    controller.dispose()
  })
})
