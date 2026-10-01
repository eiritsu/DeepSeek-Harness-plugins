// @vitest-environment jsdom
import { FiberState } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { bootAssembledClient, installAssembledBootEnv } from './assembled-boot.ts'

installAssembledBootEnv()

it('activates the Client face from the bundle package root entry', async () => {
  const ctx = await bootAssembledClient({ additionalBundles: ['packages/bundle/copy-session-id'] })
  const clientEntry = [...ctx.loader.entries()].find(row => row.options.name === '@deepseek-ai/dsh-copy-session-id')
  expect(clientEntry).toBeDefined()
  if (clientEntry?.fiber?.state === FiberState.FAILED) {
    throw Reflect.get(clientEntry.fiber, '_error')
  }
  expect(clientEntry?.fiber?.state).toBe(FiberState.ACTIVE)
}, 15000)
