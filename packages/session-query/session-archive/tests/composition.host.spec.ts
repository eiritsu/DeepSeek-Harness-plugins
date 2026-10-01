import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

it('keeps Session archive composition as an explicit overlay', () => {
  const patches = loadOverlayPatches('session-archive-test', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
  const rows = patches.flatMap(patch => patch.insert ?? []).filter(row => row.id === 'session-archive')
  expect(rows).toEqual([{ id: 'session-archive', name: '@deepseek-ai/dsh-session-archive' }])
})
