import { clientBundle } from '../../client/tsdown.client.ts'

/** Build the IM integration package with its Host and dynamic Client entries. */
export default clientBundle('@deepseek-ai/dsh-im-integration', ['lib/types/index.js'], {
  hostPhase: true,
})
