import { clientBundle } from '../../client/tsdown.client.ts'

/** Build one installable package with its Host provider and Settings Client. */
export default clientBundle(import.meta.dirname, ['lib/types/index.js'], { hostPhase: true })
