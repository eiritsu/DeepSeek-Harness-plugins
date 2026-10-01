// @vitest-environment jsdom
import { FiberState } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, bootAssembledClient } from './assembled-boot.ts'

installAssembledBootEnv()

it('activates SkillHub from the assembled Client bundle graph', async () => {
  const ctx = await bootAssembledClient({ additionalBundles: ['packages/bundle/community-skill-catalog'] })
  let clientEntry: { options: { name?: string }; fiber?: { state: number } } | undefined
  for (let attempt = 0; attempt < 50; attempt++) {
    clientEntry = [...ctx.loader.entries()].find(row => row.options.name === '@deepseek-ai/dsh-community-skill-catalog')
    if (clientEntry?.fiber?.state === FiberState.ACTIVE || clientEntry?.fiber?.state === FiberState.FAILED) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  expect(clientEntry).toBeDefined()
  if (clientEntry?.fiber?.state === FiberState.FAILED) {
    throw Reflect.get(clientEntry.fiber, '_error')
  }
  expect(clientEntry?.fiber?.state).toBe(FiberState.ACTIVE)
}, 15000)
