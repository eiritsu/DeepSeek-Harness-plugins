import { clientBundle } from '../../client/tsdown.client.ts'

/** Build one installable package with its Host provider and Settings Client. */
export default clientBundle('@deepseek-ai/dsh-tools-connections', ['lib/types/index.js'], { hostPhase: true })
