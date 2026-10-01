import { Context } from '@deepseek-ai/cordis'
import { createVolatile } from '@deepseek-ai/cosmokit'
import { describe, expect, it, vi } from 'vitest'
import type { Config } from '../src/index.ts'
import { applyLarkCli, isLarkCliReadOnly } from '../src/lark-cli.ts'

describe('Lark CLI policy and configuration', () => {
  it('allows only known read-only IM chat-list options without approval', () => {
    expect(isLarkCliReadOnly(['im', '+chat-list'])).toBe(true)
    expect(isLarkCliReadOnly([
      'im', '+chat-list', '--types', 'p2p', '--sort', 'active_time', '--page-size', '5', '--format', 'json',
    ])).toBe(true)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--json'])).toBe(true)
    expect(isLarkCliReadOnly(['im', '+chat-delete'])).toBe(false)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--all'])).toBe(false)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--types', 'p2p', '--verify'])).toBe(false)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--sort', 'unknown'])).toBe(false)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--page-size', '101'])).toBe(false)
    expect(isLarkCliReadOnly(['im', '+chat-list', '--types', 'p2p', '--types', 'group'])).toBe(false)
  })

  it('allows structured auth status output but keeps token verification approval-gated', () => {
    expect(isLarkCliReadOnly(['auth', 'status', '--json'])).toBe(true)
    expect(isLarkCliReadOnly(['auth', 'status', '--verify'])).toBe(false)
  })

  it('recognizes help only in command positions and never after the option separator', () => {
    expect(isLarkCliReadOnly(['--help'])).toBe(true)
    expect(isLarkCliReadOnly(['calendar', '--help'])).toBe(false)
    expect(isLarkCliReadOnly(['calendar', '+event', '--help'])).toBe(false)
    expect(isLarkCliReadOnly(['calendar', '--', '--help'])).toBe(false)
    expect(isLarkCliReadOnly(['calendar', '+event', '--', '-h'])).toBe(false)
    expect(isLarkCliReadOnly(['calendar', '+event'])).toBe(false)
  })

  it('serializes shared CLI config initialization and command calls with per-call config snapshots', async () => {
    const ctx = new Context()
    let releaseFirstInit!: () => void
    const firstInit = new Promise<void>((resolve) => { releaseFirstInit = resolve })
    const spawned: Array<{
      argv: string[]
      stdin?: string
      env: Record<string, string | undefined>
      stdoutLimit: number
      stderrLimit: number
      graceMs: number
    }> = []
    const cell = <T>(value: T) => createVolatile(value)
    const config = {
      cliEnabled: cell(true), appId: cell('app-one'), appSecretEnv: cell('SECRET_ONE'), brand: cell('feishu'),
      cliTimeoutMs: cell(1_000), cliMaxOutputBytes: cell(4_096), cliGraceMs: cell(250),
    } as Config
    const tool = {
      register: vi.fn((definition: { timeoutMs: number; execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown> }) => {
        registered = definition
        return vi.fn()
      }),
    }
    let registered: { timeoutMs: number; execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown> } | undefined
    ctx.provide('tools', tool as never)
    ctx.provide('credentials', { resolve: async (ref: string) => ({ value: `secret:${ref}` }) } as never)
    ctx.provide('subprocess', {
      spawn(spec: {
        argv: string[]
        graceMs: number
        stdio: { stdin: { data: string } | 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
        env: Record<string, string | undefined>
      }) {
        const row = {
          argv: spec.argv, env: spec.env, graceMs: spec.graceMs,
          stdoutLimit: spec.stdio.stdout.maxBytes, stderrLimit: spec.stdio.stderr.maxBytes,
          ...(typeof spec.stdio.stdin === 'object' ? { stdin: spec.stdio.stdin.data } : {}),
        }
        spawned.push(row)
        const done = spec.argv.includes('config') && spawned.length === 1
          ? firstInit.then(() => ({ exitCode: 0, signal: null }))
          : Promise.resolve({ exitCode: 0, signal: null })
        return { done, collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } } }
      },
    } as never)
    try {
      const fiber = ctx.plugin((pluginCtx) => { applyLarkCli(pluginCtx, config) })
      await fiber.await()
      expect(registered?.timeoutMs).toBe(7_500)
      const execute = (args: string[]) => registered!.execute({ arguments: args }, { signal: new AbortController().signal })
      const first = execute(['auth', 'status'])
      await vi.waitFor(() => { expect(spawned).toHaveLength(1) })
      config.appId = cell('app-two')
      config.appSecretEnv = cell('SECRET_TWO')
      const second = execute(['calendar', 'list'])
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(spawned).toHaveLength(1)
      releaseFirstInit()
      await Promise.all([first, second])
      expect(spawned.map(row => row.argv.slice(2))).toEqual([
        ['config', 'init', '--app-id', 'app-one', '--app-secret-stdin', '--brand', 'feishu'],
        ['auth', 'status'],
        ['config', 'init', '--app-id', 'app-two', '--app-secret-stdin', '--brand', 'feishu'],
        ['calendar', 'list'],
      ])
      expect(spawned[0]?.stdin).toBe('secret:SECRET_ONE')
      expect(spawned[2]?.stdin).toBe('secret:SECRET_TWO')
      expect(spawned[0]?.env).toMatchObject({ LARKSUITE_CLI_CONFIG_DIR: expect.stringContaining('lark-cli') as string })
      expect(spawned.every(row => row.stdoutLimit === 4_096 && row.stderrLimit === 4_096 && row.graceMs === 250)).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
