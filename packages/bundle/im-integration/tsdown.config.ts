import { clientBundle } from '../../client/tsdown.client.ts'
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'

/** Build the IM integration package with its Host and dynamic Client entries. */
export default clientBundle('@deepseek-ai/dsh-im-integration', ['lib/types/index.js'], {
  hostPhase: true,
  lib: { plugins: [typertPlugin({ mode: 'package', faces: ['host'] })] },
})
