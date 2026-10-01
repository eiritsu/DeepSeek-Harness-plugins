import { clientBundle } from '../../client/tsdown.client.ts'

/** Build the Host entry and Settings Client from one profile package. */
export default clientBundle('@deepseek-ai/dsh-file-recognizer-office', ['lib/types/index.js'], { hostPhase: true })
