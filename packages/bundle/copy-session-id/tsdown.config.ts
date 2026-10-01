import { clientBundle } from '../../client/tsdown.client.ts'

/** Build one package with Loader and Client entries plus its activation patch. */
export default clientBundle('@deepseek-ai/dsh-copy-session-id', ['lib/types/index.js'], { hostPhase: true })
