import { clientBundle } from '../../client/tsdown.client.ts'

/** Build the CUA bundle package with its Host and dynamic Client entries. */
export default clientBundle('@deepseek-ai/dsh-cua-bundle', ['lib/types/index.js'], {
  hostPhase: true,
})
