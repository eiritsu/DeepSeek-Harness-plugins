import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { ImStatusService } from '../src/status.ts'
import type { ImConnectionStatus } from '../src/types.ts'

describe('ImStatusService', () => {
  it('publishes and streams connection status across platforms', async () => {
    const ctx = new Context()
    const service = new ImStatusService(ctx)

    service.publish({ platform: 'lark', state: 'connected' })
    service.publish({ platform: 'dingtalk', state: 'connecting' })

    const controller = new AbortController()
    const received: ImConnectionStatus[] = []

    const stream = service.watch(controller.signal)
    const readPromise = (async () => {
      for await (const item of stream) {
        received.push(item)
        if (received.length >= 3) {
          controller.abort()
          break
        }
      }
    })()

    // Publish a third update
    service.publish({ platform: 'wecom', state: 'connected' })

    await readPromise
    expect(received).toHaveLength(3)
    expect(received[0]).toEqual({ platform: 'lark', state: 'connected' })
    expect(received[1]).toEqual({ platform: 'dingtalk', state: 'connecting' })
    expect(received[2]).toEqual({ platform: 'wecom', state: 'connected' })
  })
})
