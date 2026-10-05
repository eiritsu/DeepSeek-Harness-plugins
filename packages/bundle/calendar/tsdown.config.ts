import { clientBundle } from '../../client/tsdown.client.ts'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

/** Build one installable package with its Host plugin and calendar Client. */
export default clientBundle('@deepseek-ai/dsh-calendar', ['lib/types/index.js'], {
  hostPhase: true,
  lib: { plugins: [typertPlugin({ mode: 'package', faces: ['host'] })] },
})
