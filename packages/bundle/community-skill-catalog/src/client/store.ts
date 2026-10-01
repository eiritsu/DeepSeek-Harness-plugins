/** Skill directory overlay visibility. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

type State = { open: boolean }
type Actions = { open(draft: State): void; close(draft: State): void }

/** Create state shared by the footer action and overlay.
 * @returns the visibility store.
 */
export function createSkillCatalogStore(): EngineStoreHandle<State, Actions> {
  return defineStore({
    init: (): State => ({ open: false }),
    actions: {
      open: (draft) => { draft.open = true },
      close: (draft) => { draft.open = false },
    },
  })
}
