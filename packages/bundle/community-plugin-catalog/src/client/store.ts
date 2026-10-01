/** Sidebar catalog overlay visibility. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

type State = { open: boolean }
type Actions = { open(draft: State): void; close(draft: State): void }

/** Create the one visibility store shared by the sidebar trigger and overlay.
 * @returns visibility state and open/close actions.
 */
export function createPluginCatalogStore(): EngineStoreHandle<State, Actions> {
  return defineStore({
    init: (): State => ({ open: false }),
    actions: {
      open: (draft) => { draft.open = true },
      close: (draft) => { draft.open = false },
    },
  })
}
