import { mkdtemp, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { bridge } from '@deepseek-ai/dsh-client-connection/src/http-bridge.ts'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, CONFIGURATION_BACKUP_PATH, inject } from '../src/index.ts'

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('configuration backup Fetch route', () => {
  it('serves bodyless GET through the official node:http bridge and shared /api handler', async () => {
    expect(inject).toContain('loader')
    const home = await mkdtemp(join(tmpdir(), 'dsh-backup-route-'))
    temporary.push(home)
    const ctx = new Context()
    try {
      await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
      await ctx.plugin((owner) => { new HostConnectionService(owner, [], {} as BrowserAuth) })
      ctx.provide('profileContext', { home, cwd: home } as never)
      ctx.provide('configEditor', { configuration: () => [] } as never)
      ctx.provide('pluginManager', { listBundles: async () => [] } as never)
      ctx.provide('loader', { entries: () => [] } as never)
      const fiber = ctx.plugin({ inject: [...inject], apply })
      await fiber
      const connection = ctx.get('connection') as HostConnectionService
      const handler = connection.createSharedFetchHandler('/api')
      ctx.webServer.register({
        kind: 'prefix',
        path: '/api',
        handler: (req, res) => bridge(req, res, handler),
      })

      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(`http://127.0.0.1:${ctx.webServer.port}${CONFIGURATION_BACKUP_PATH}?action=roots`, (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
          response.on('end', () => { resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }) })
        })
        req.once('error', reject)
        req.end()
      })
      expect(response.status).toBe(200)
      expect(JSON.parse(response.body)).toEqual({ roots: [] })
      await fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
