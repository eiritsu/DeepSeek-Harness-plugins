/** Shared skill directory overlay visibility and install change counter. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

type State = { open: boolean; installRevision: number }
type Actions = { open(draft: State): void; close(draft: State): void; notifyInstalled(draft: State): void }

/** Create reactive state shared across the sidebar action, catalog modal, and Plugins skills page.
 * @returns the visibility and install-refresh store handle.
 */
export function createSkillCatalogStore(): EngineStoreHandle<State, Actions> {
  return defineStore({
    init: (): State => ({ open: false, installRevision: 0 }),
    actions: {
      open: (draft) => { draft.open = true },
      close: (draft) => { draft.open = false },
      notifyInstalled: (draft) => { draft.installRevision += 1 },
    },
  })
}
