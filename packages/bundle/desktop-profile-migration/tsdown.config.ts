import { clientBundle } from '../../client/tsdown.client.ts'

/** Build one installable package with its Host migration service and Settings Client. */
export default clientBundle('@deepseek-ai/dsh-desktop-profile-migration-bundle', ['lib/types/index.js'], { hostPhase: true })
