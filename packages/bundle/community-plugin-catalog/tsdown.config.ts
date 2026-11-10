import { clientBundle } from '../../client/tsdown.client.ts'

/** Build one installable package with its Host and dynamic Client entries. */
export default clientBundle(import.meta.dirname, ['lib/types/index.js'], { hostPhase: true })
