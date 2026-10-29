import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { positionalArgs, secretFlagReason } from '../src/channels/args.ts'
import { channelConfigDir, channelRunner, cliBinRoot, manifestPath, vendorRoot } from '../src/cli-paths.ts'
import { ensureChannelBinary } from '../src/channels/install.ts'
import { wecomBlockedReason } from '../src/channels/wecom/cli.ts'
import {
  deadlineTimedOut,
  finishCli,
  inheritedCliKey,
  runSerial,
  scrubInherited,
  spawnEnv,
  toolTimeoutMs,
} from '../src/channels/runner.ts'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-im-cli-'))
  roots.push(dir)
  return dir
}

function pin(bytes: Buffer) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
  return { sha256, integrity, bytes }
}

function writeManifest(dir: string, channels: unknown): string {
  const path = join(dir, 'manifest.json')
  writeFileSync(path, JSON.stringify({ channels }))
  return path
}

function larkManifest(dir: string, bytes: Buffer, asset: Record<string, unknown> = {}) {
  const hashed = pin(bytes)
  return writeManifest(dir, {
    lark: {
      version: '9.9.9',
      layout: 'release',
      binary: 'lark-cli',
      assets: {
        'linux-amd64': {
          archive: 'lark.tar.gz',
          sha256: hashed.sha256,
          urls: ['https://example.test/lark.tar.gz'],
          ...asset,
        },
      },
    },
  })
}

describe('pinned CLI install', () => {
  it('publishes a verified binary, reuses it, and rejects a hash mismatch before extract', async () => {
    const dir = tempDir()
    const bytes = Buffer.from('official-cli')
    const manifest = larkManifest(dir, bytes)
    const binRoot = join(dir, 'bin')
    let extracts = 0
    const extract = async (_archive: string, dest: string) => {
      extracts += 1
      writeFileSync(join(dest, 'lark-cli'), bytes)
    }
    const first = await ensureChannelBinary('lark', {
      binRoot, manifestPath: manifest, platform: 'linux', arch: 'amd64',
      download: async () => bytes, extract,
    })
    expect(first).toBe(join(binRoot, 'lark', '9.9.9', 'lark-cli'))
    expect(readFileSync(join(binRoot, 'lark', '9.9.9', '.verified'), 'utf8')).toContain('sha256:')
    const second = await ensureChannelBinary('lark', {
      binRoot, manifestPath: manifest, platform: 'linux', arch: 'amd64',
      download: async () => { throw new Error('should reuse') },
      extract: async () => { throw new Error('should reuse') },
    })
    expect(second).toBe(first)
    expect(extracts).toBe(1)

    let mismatched = 0
    await expect(ensureChannelBinary('lark', {
      binRoot: join(dir, 'other'), manifestPath: manifest, platform: 'linux', arch: 'amd64',
      download: async () => Buffer.from('tampered'),
      extract: async () => { mismatched += 1 },
    })).rejects.toThrow(/cli-hash-mismatch/)
    expect(mismatched).toBe(0)
  })

  it('lets one lock cover concurrent callers and replaces a stale lock', async () => {
    const dir = tempDir()
    const bytes = Buffer.from('shared-cli')
    const manifest = larkManifest(dir, bytes)
    const binRoot = join(dir, 'bin')
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const extract = async (_archive: string, dest: string) => { writeFileSync(join(dest, 'lark-cli'), 'x') }
    const download = async () => {
      calls += 1
      await gate
      return bytes
    }
    const options = { binRoot, manifestPath: manifest, platform: 'linux' as const, arch: 'amd64' as const, download, extract }
    const first = ensureChannelBinary('lark', options)
    const second = ensureChannelBinary('lark', options)
    await vi.waitFor(() => { expect(calls).toBe(1) })
    release()
    expect(await first).toBe(await second)
    expect(calls).toBe(1)

    const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
    await new Promise((resolve) => { child.once('exit', resolve) })
    const staleRoot = join(dir, 'stale')
    mkdirSync(join(staleRoot, 'lark'), { recursive: true })
    writeFileSync(join(staleRoot, 'lark', '.install.lock'), String(child.pid))
    const stolen = await ensureChannelBinary('lark', {
      ...options, binRoot: staleRoot, download: async () => bytes,
    })
    expect(stolen).toContain('lark-cli')
  })

  it('times out a live lock, rejects a missing binary, and follows the Gitee mirror', async () => {
    const dir = tempDir()
    const bytes = Buffer.from('mirror-cli')
    const manifest = larkManifest(dir, bytes, {
      gitee: { repo: 'DingTalk-Real-AI/dingtalk-workspace-cli', tag: 'v9.9.9', name: 'lark.tar.gz' },
    })
    const held = join(dir, 'held')
    mkdirSync(join(held, 'lark'), { recursive: true })
    writeFileSync(join(held, 'lark', '.install.lock'), String(process.pid))
    await expect(ensureChannelBinary('lark', {
      binRoot: held, manifestPath: manifest, platform: 'linux', arch: 'amd64',
      lockWaitMs: 30, lockPollMs: 5, download: async () => bytes,
    })).rejects.toThrow(/cli-install-lock-timeout/)

    await expect(ensureChannelBinary('lark', {
      binRoot: join(dir, 'empty'), manifestPath: manifest, platform: 'linux', arch: 'amd64',
      download: async () => bytes, extract: async () => {},
    })).rejects.toThrow(/cli-binary-missing/)

    const seen: string[] = []
    const mirrored = await ensureChannelBinary('lark', {
      binRoot: join(dir, 'mirror'), manifestPath: manifest, platform: 'linux', arch: 'amd64',
      download: async (url: string) => {
        seen.push(url)
        if (url.includes('example.test/lark')) throw new Error('github down')
        return bytes
      },
      extract: async (_archive: string, dest: string) => { writeFileSync(join(dest, 'lark-cli'), 'x') },
      fetch: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        return {
          ok: url.includes('gitee.com/api'),
          status: 200,
          json: async () => ({ assets: [{ name: 'lark.tar.gz', browser_download_url: 'https://example.test/mirror' }] }),
          arrayBuffer: async () => new ArrayBuffer(0),
        } as Response
      },
    })
    expect(mirrored).toContain('lark-cli')
    expect(seen).toEqual(['https://example.test/lark.tar.gz', 'https://example.test/mirror'])
  })

  it('rejects unknown channels, missing assets, failed downloads, and a null Gitee body', async () => {
    const dir = tempDir()
    const bytes = Buffer.from('nope')
    const manifest = larkManifest(dir, bytes, {
      gitee: { repo: 'DingTalk-Real-AI/dingtalk-workspace-cli', tag: 'v9.9.9', name: 'lark.tar.gz' },
    })
    await expect(ensureChannelBinary('wecom', {
      binRoot: dir, manifestPath: manifest, platform: 'linux', arch: 'amd64',
    })).rejects.toThrow(/cli-channel-unavailable|cli-channel-unknown/)
    await expect(ensureChannelBinary('lark', {
      binRoot: dir, manifestPath: manifest, platform: 'aix', arch: 'amd64',
    })).rejects.toThrow(/cli-asset-unavailable/)
    await expect(ensureChannelBinary('lark', {
      binRoot: join(dir, 'fail'), manifestPath: manifest, platform: 'linux', arch: 'amd64',
      download: async () => { throw new Error('network down') },
      fetch: async () => { throw new Error('gitee down') },
    })).rejects.toThrow(/network down/)
    await expect(ensureChannelBinary('lark', {
      binRoot: join(dir, 'null'), manifestPath: manifest, platform: 'linux', arch: 'amd64',
      download: async () => { throw new Error('still down') },
      fetch: async () => ({ ok: true, status: 200, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0) }) as Response,
    })).rejects.toThrow(/still down/)
  })

  it('verifies an npm integrity hash via fetch and extracts with tar', async () => {
    const dir = tempDir()
    const bytes = Buffer.from('wecom-bytes')
    const source = join(dir, 'src')
    mkdirSync(source)
    writeFileSync(join(source, 'wecom-cli'), '#!/bin/sh\n')
    const archive = join(dir, 'cli.tgz')
    execFileSync('tar', ['-czf', archive, '-C', source, 'wecom-cli'])
    const archiveBytes = readFileSync(archive)
    const archived = pin(archiveBytes)
    const raw = pin(bytes)
    const manifest = writeManifest(dir, {
      wecom: {
        version: '1.3.4',
        layout: 'npm',
        binary: 'wecom-cli',
        assets: {
          'linux-x64': {
            archive: 'cli.tgz',
            integrity: archived.integrity,
            urls: ['https://example.test/wecom.tgz'],
          },
          'win32-x64': {
            archive: 'cli.zip',
            integrity: raw.integrity,
            urls: ['https://example.test/wecom.zip'],
          },
        },
      },
    })
    const published = await ensureChannelBinary('wecom', {
      binRoot: join(dir, 'bin'),
      manifestPath: manifest,
      platform: 'linux',
      arch: 'x64',
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
        arrayBuffer: async () => Uint8Array.from(archiveBytes).buffer,
      }) as Response,
    })
    expect(published.endsWith('wecom-cli')).toBe(true)

    const windows = await ensureChannelBinary('wecom', {
      binRoot: join(dir, 'win'),
      manifestPath: manifest,
      platform: 'win32',
      arch: 'amd64',
      download: async () => bytes,
      extract: async (_archive: string, dest: string) => { writeFileSync(join(dest, 'wecom-cli.exe'), 'x') },
    })
    expect(windows.endsWith('wecom-cli.exe')).toBe(true)

    const armBytes = Buffer.from('wecom-arm-translated')
    const armHashed = pin(armBytes)
    const armManifest = writeManifest(dir, {
      wecom: {
        version: '1.3.4',
        layout: 'npm',
        binary: 'wecom-cli',
        assets: {
          'win32-x64': {
            archive: 'cli-win32-x64.tgz',
            integrity: armHashed.integrity,
            urls: ['https://registry.npmjs.org/@wecom/cli-win32-x64/-/cli-win32-x64-1.3.4.tgz'],
          },
        },
      },
    })
    let armUrl = ''
    const arm = await ensureChannelBinary('wecom', {
      binRoot: join(dir, 'arm'),
      manifestPath: armManifest,
      platform: 'win32',
      arch: 'arm64',
      download: async (url) => {
        armUrl = url
        return armBytes
      },
      extract: async (_archive: string, dest: string) => { writeFileSync(join(dest, 'wecom-cli.exe'), 'x') },
    })
    expect(armUrl).toContain('cli-win32-x64')
    expect(arm.endsWith('wecom-cli.exe')).toBe(true)
  })

  it('skips flags and words after -- and rejects secret flags', () => {
    expect(positionalArgs(['calendar', '--json', 'list', '--', 'upgrade'])).toEqual(['calendar', 'list'])
    expect(secretFlagReason(['show'])).toBeUndefined()
    expect(secretFlagReason(['--token', 'x'])).toMatch(/secret flags/)
    expect(wecomBlockedReason(['--bot-secret=x'])).toMatch(/secret flags/)
    expect(wecomBlockedReason(['--output-qrcode=out.png'])).toMatch(/im_cli_auth/)
    expect(wecomBlockedReason(['--manual=1'])).toMatch(/im_cli_auth/)
    expect(wecomBlockedReason(['--noninteractive'])).toMatch(/im_cli_auth/)
    expect(wecomBlockedReason(['--noninteractive=1'])).toMatch(/im_cli_auth/)
  })

  it('reads the shipped manifest and resolves package paths from this module', async () => {
    const shipped = JSON.parse(readFileSync(manifestPath(), 'utf8')) as {
      channels: { lark: { assets: { 'linux-amd64': { sha256: string } } }; dingtalk: { assets: { 'linux-amd64': { sha256: string } } }; wecom: { assets: { 'linux-x64': { integrity: string } } } }
    }
    expect(shipped.channels.lark.assets['linux-amd64'].sha256).toBe('301db5eb6d64b295e8bd366036dd839cc6686471c68e54c2602d274de0bf032a')
    expect(shipped.channels.dingtalk.assets['linux-amd64'].sha256).toBe('27cd2821e1f6523d1eeaf5688c23502bddbdd858cf82e32c197853065418bef8')
    expect(shipped.channels.wecom.assets['linux-x64'].integrity).toContain('sha512-')
    expect(vendorRoot().pathname.endsWith('/scripts/vendor/')).toBe(true)
    expect(channelRunner('lark')).toContain('lark/run.cjs')
    expect(channelRunner('wecom')).toContain('wecom/run.cjs')
    expect(channelRunner('dingtalk')).toContain('dingtalk/run.cjs')
    const home = tempDir()
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      await expect(ensureChannelBinary('lark', { platform: 'aix', arch: 'amd64' })).rejects.toThrow(/cli-asset-unavailable/)
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
    const previous = process.env.DSH_HOME
    const configHome = tempDir()
    process.env.DSH_HOME = configHome
    try {
      expect(channelConfigDir('lark')).toBe(join(configHome, 'lark-cli'))
      expect(channelConfigDir('wecom')).toBe(join(configHome, 'im', 'cli-config', 'wecom'))
      expect(channelConfigDir('dingtalk')).toBe(join(configHome, 'im', 'cli-config', 'dingtalk'))
      expect(cliBinRoot()).toBe(join(configHome, 'im', 'cli-bin'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('scrubs inherited CLI identity and classifies deadlines', async () => {
    expect(inheritedCliKey('DWS_CLIENT_SECRET')).toBe(true)
    expect(inheritedCliKey('PATH')).toBe(false)
    expect(scrubInherited({
      PATH: '/bin',
      WECOM_CLI_ACCESS_TOKEN: 'inherited',
      DWS_CLIENT_ID: 'old',
    }, { DWS_CLIENT_ID: 'new' })).toMatchObject({
      PATH: '/bin',
      WECOM_CLI_ACCESS_TOKEN: undefined,
      DWS_CLIENT_ID: 'new',
    })
    const plain = spawnEnv({ DWS_NO_UPDATE_CHECK: '1' }, {} as NodeJS.ProcessVersions, { DWS_PROFILE: 'other', PATH: '/bin' })
    expect(plain.DWS_PROFILE).toBeUndefined()
    expect(plain.DWS_CLIENT_SECRET).toBeUndefined()
    expect(plain.DWS_NO_UPDATE_CHECK).toBe('1')
    expect(plain.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(plain.PATH).toBeUndefined()
    const electron = spawnEnv({}, { electron: '30' } as NodeJS.ProcessVersions, {})
    expect(electron.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(spawnEnv({ A: '1' }).A).toBe('1')
    expect(toolTimeoutMs(1_000, 250, 5)).toBe(120_000 + 5 * 1_250 + 5_000)

    const caller = new AbortController()
    const deadline = new AbortController()
    expect(deadlineTimedOut(undefined, caller.signal)).toBe(false)
    expect(deadlineTimedOut(deadline.signal, caller.signal)).toBe(false)
    deadline.abort()
    expect(deadlineTimedOut(deadline.signal, caller.signal)).toBe(true)
    caller.abort()
    expect(deadlineTimedOut(deadline.signal, caller.signal)).toBe(false)

    const order: string[] = []
    const first = runSerial('runner-test', async () => {
      order.push('first')
      throw new Error('boom')
    })
    const second = runSerial('runner-test', async () => { order.push('second') })
    await expect(first).rejects.toThrow('boom')
    await second
    expect(order).toEqual(['first', 'second'])

    const finished = await finishCli({
      handle: {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: {},
        terminate: () => {},
      },
      deadline: undefined,
      signal: new AbortController().signal,
    })
    expect(finished).toMatchObject({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
    const text = await finishCli({
      handle: {
        done: Promise.resolve({ exitCode: 3, signal: 'SIGTERM' }),
        collected: {
          stdout: { readFrom: () => ({ text: 'out' }) },
          stderr: { readFrom: () => ({ text: 'err' }) },
        },
        terminate: () => {},
      },
      deadline: AbortSignal.abort(),
      signal: new AbortController().signal,
    })
    expect(text).toMatchObject({ exitCode: 3, signal: 'SIGTERM', stdout: 'out', stderr: 'err', timedOut: true })
  })
})
