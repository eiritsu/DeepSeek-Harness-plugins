import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createVolatile, updateVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'
import * as Lark from '../src/host/lark/plugin.ts'
import { LarkStatus } from '../src/host/lark/status.ts'

const mocks = vi.hoisted(() => ({
  channel: vi.fn(() => ({}) as never),
  connect: vi.fn(async () => {}),
  dispose: vi.fn(async () => {}),
}))

vi.mock('@larksuite/channel', () => ({ createLarkChannel: mocks.channel }))
vi.mock('../src/host/lark/conversation.ts', () => ({
  LarkConversationBridge: class {
    connect = mocks.connect
    dispose = mocks.dispose
    constructor(..._args: unknown[]) { void _args.length }
  },
}))

let context: Context | undefined

beforeEach(() => { vi.clearAllMocks() })

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('Lark Cordis composition', () => {
  function provideHostServices(resolve: ReturnType<typeof vi.fn>): Context {
    context = new Context()
    context.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) } as never)
    context.provide('agents', { get: () => undefined, create: vi.fn(), resume: vi.fn() } as never)
    context.provide('attachments', { saveImage: vi.fn(), saveFile: vi.fn(), readImage: vi.fn() } as never)
    context.provide('credentials', { resolve } as never)
    context.provide('sessionPersistence', { stat: vi.fn() } as never)
    context.provide('sessionQuery', { observeSession: vi.fn() } as never)
    context.provide('workspaceRegistry', { resolveByPath: vi.fn(), create: vi.fn() } as never)
    return context
  }

  it('mounts with the official Host services and leaves the connection disabled by default', async () => {
    const resolve = vi.fn(async () => undefined)
    const host = provideHostServices(resolve)

    await host.plugin(Lark)
    expect(Lark.name).toBe('lark')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('resolves the configured credential reference without requiring a local secret', async () => {
    const resolve = vi.fn(async () => undefined)
    const host = provideHostServices(resolve)
    await host.plugin(Lark, {
      enabled: true,
      appId: 'cli_mock',
      authorizedUserOpenId: 'ou_mock',
    })
    await vi.waitFor(() => { expect(resolve).toHaveBeenCalledOnce() })

    expect(resolve).toHaveBeenCalledWith('LARK_APP_SECRET')
  })

  it('reports missing required identity configuration instead of silently remaining idle', async () => {
    const resolve = vi.fn(async () => undefined)
    const host = provideHostServices(resolve)
    const warning = vi.spyOn(host.logger, 'warn')
    const publish = vi.spyOn(LarkStatus.prototype, 'publish')
    await host.plugin(Lark, { enabled: true })

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('appId, authorizedUserOpenId'))
    expect(publish).toHaveBeenCalledWith({ state: 'error', reason: 'missing-identity' })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('reports missing secret configuration without exposing a secret value', async () => {
    const resolve = vi.fn(async () => undefined)
    const host = provideHostServices(resolve)
    const warning = vi.spyOn(host.logger, 'warn')
    await host.plugin(Lark, { enabled: true, appId: 'cli_mock', authorizedUserOpenId: 'ou_mock' })
    await vi.waitFor(() => { expect(warning).toHaveBeenCalled() })

    expect(warning).toHaveBeenCalledWith('Lark application credential "LARK_APP_SECRET" is not configured')
    expect(warning.mock.calls.flat().join(' ')).not.toContain('secret-value')
  })

  it('reconciles enabled, volatile configuration, and the configured credential reference', async () => {
    const resolve = vi.fn(async (ref: string) => ({ value: `mock:${ref}` }))
    const host = provideHostServices(resolve)
    const config = z.resolve({ appId: 'app-one', authorizedUserOpenId: 'user-one' }, Lark.Config, {})[0] as Lark.Config
    await host.plugin((ctx) => { Lark.apply(ctx, config) })

    updateVolatile(config.enabled, createVolatile(true))
    host.emit('loader/volatile-update', [['enabled']])
    await vi.waitFor(() => { expect(resolve).toHaveBeenCalledWith('LARK_APP_SECRET') })
    await vi.waitFor(() => { expect(mocks.connect).toHaveBeenCalledOnce() })
    expect(mocks.channel).toHaveBeenLastCalledWith(expect.objectContaining({
      appId: 'app-one', appSecret: 'mock:LARK_APP_SECRET', domain: 'https://open.feishu.cn',
    }))

    updateVolatile(config.appSecretEnv, createVolatile('OTHER_LARK_SECRET'))
    updateVolatile(config.brand, createVolatile('lark'))
    host.emit('loader/volatile-update', [['appSecretEnv'], ['brand']])
    await vi.waitFor(() => { expect(resolve).toHaveBeenCalledWith('OTHER_LARK_SECRET') })
    await vi.waitFor(() => { expect(mocks.connect).toHaveBeenCalledTimes(2) })
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(mocks.channel).toHaveBeenLastCalledWith(expect.objectContaining({
      appId: 'app-one', appSecret: 'mock:OTHER_LARK_SECRET', domain: 'https://open.larksuite.com',
    }))

    host.emit('credentials/reference-updated', credentialRef('OTHER_LARK_SECRET'))
    await vi.waitFor(() => { expect(resolve).toHaveBeenCalledTimes(3) })
    await vi.waitFor(() => { expect(mocks.connect).toHaveBeenCalledTimes(3) })
  })

  it('does not reconnect when an unrelated volatile field changes', async () => {
    const resolve = vi.fn(async () => ({ value: 'mock-secret' }))
    const host = provideHostServices(resolve)
    const config = z.resolve({ appId: 'app-one', authorizedUserOpenId: 'user-one', enabled: true }, Lark.Config, {})[0] as Lark.Config
    await host.plugin((ctx) => { Lark.apply(ctx, config) })
    await vi.waitFor(() => { expect(mocks.connect).toHaveBeenCalledOnce() })

    host.emit('loader/volatile-update', [['theme', 'mode']])
    host.emit('loader/volatile-update', [['enabled']])
    await Promise.resolve()
    expect(mocks.connect).toHaveBeenCalledOnce()
    expect(mocks.dispose).not.toHaveBeenCalled()
  })

  it('serializes rapid configuration changes and disposes a late connection', async () => {
    let finishFirst!: () => void
    mocks.connect.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve }))
    const resolve = vi.fn(async () => ({ value: 'mock-secret' }))
    const host = provideHostServices(resolve)
    const config = z.resolve({ appId: 'app-one', authorizedUserOpenId: 'user-one', enabled: true }, Lark.Config, {})[0] as Lark.Config
    await host.plugin((ctx) => { Lark.apply(ctx, config) })
    await vi.waitFor(() => { expect(mocks.connect).toHaveBeenCalledOnce() })

    updateVolatile(config.appId, createVolatile('app-two'))
    host.emit('loader/volatile-update', [['appId']])
    expect(mocks.dispose).toHaveBeenCalledOnce()
    updateVolatile(config.appId, createVolatile('app-three'))
    host.emit('loader/volatile-update', [['appId']])
    finishFirst()
    await vi.waitFor(() => { expect(mocks.connect).toHaveBeenCalledTimes(2) })
    await vi.waitFor(() => { expect(mocks.dispose).toHaveBeenCalledOnce() })
    expect(mocks.channel).toHaveBeenLastCalledWith(expect.objectContaining({ appId: 'app-three' }))
  })

  it('stops an in-progress connection immediately when disabled and ignores its late success', async () => {
    let finishConnect!: () => void
    mocks.connect.mockImplementationOnce(() => new Promise<void>((resolve) => { finishConnect = resolve }))
    const resolve = vi.fn(async () => ({ value: 'mock-secret' }))
    const host = provideHostServices(resolve)
    const config = z.resolve({ appId: 'app-one', authorizedUserOpenId: 'user-one', enabled: true }, Lark.Config, {})[0] as Lark.Config
    await host.plugin((ctx) => { Lark.apply(ctx, config) })
    await vi.waitFor(() => { expect(mocks.connect).toHaveBeenCalledOnce() })

    updateVolatile(config.enabled, createVolatile(false))
    host.emit('loader/volatile-update', [['enabled']])
    expect(mocks.dispose).toHaveBeenCalledOnce()
    finishConnect()
    await vi.waitFor(() => { expect(mocks.connect).toHaveBeenCalledOnce() })
    expect(mocks.channel).toHaveBeenCalledOnce()
  })
})
