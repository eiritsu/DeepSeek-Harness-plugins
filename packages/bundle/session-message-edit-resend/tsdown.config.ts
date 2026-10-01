import { clientBundle } from '../../client/tsdown.client.ts'

/** Build one optional package with its Host policy and Client controls. */
export default clientBundle('@deepseek-ai/dsh-session-message-edit-resend', ['lib/types/index.js'], { hostPhase: true })
