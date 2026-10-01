import { clientBundle } from '../../client/tsdown.client.ts'

/** Build one installable package with its Host plugin and shimmer Client artifact. */
export default clientBundle('@deepseek-ai/dsh-turn-process-shimmer', ['lib/types/index.js'], { hostPhase: true })
