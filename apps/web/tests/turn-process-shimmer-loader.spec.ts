// @vitest-environment jsdom
import { FiberState } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { bootAssembledClient, installAssembledBootEnv } from './assembled-boot.ts'

installAssembledBootEnv()

it('activates the Client face from the standalone shimmer bundle', async () => {
  const ctx = await bootAssembledClient({ additionalBundles: ['packages/bundle/turn-process-shimmer'] })
  const entry = [...ctx.loader.entries()].find(row => row.options.name === '@deepseek-ai/dsh-turn-process-shimmer')
  expect(entry).toBeDefined()
  if (entry?.fiber?.state === FiberState.FAILED) throw Reflect.get(entry.fiber, '_error')
  expect(entry?.fiber?.state).toBe(FiberState.ACTIVE)
}, 15000)
