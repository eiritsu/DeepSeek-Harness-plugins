import { clientBundle } from '../../client/tsdown.client.ts'

/** Build the Host route and the Settings Client for the optional backup bundle. */
export default clientBundle('@deepseek-ai/dsh-configuration-and-skills-backup', ['lib/types/index.js'], { hostPhase: true })
