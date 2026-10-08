/**
 * Give one open inline dropdown menu ownership of Escape.
 *
 * A dropdown inside a dialog shares the document with the dialog's own Escape
 * listener. That listener is registered in bubble phase (`useModalLayer`), so a
 * menu that waits for the event to reach its own element has already lost the
 * key. This hook claims Escape at document capture while the menu is open:
 * it marks the event handled so the dialog behind the menu keeps its keyboard,
 * closes the menu, and hands the key back to the dialog once the menu is gone.
 *
 * Only Escape is owned here; every other key, including Tab, stays with the
 * element and the dialog that already handle it.
 * @module @deepseek-ai/dsh-community-skill-catalog/client/useMenuEscape
 */

import { useEffect, useRef } from 'react'

/**
 * Intercept Escape for the open menu before the owning dialog's bubble listener.
 * @param open - whether the menu currently holds the keyboard.
 * @param onClose - close the menu and restore its trigger focus.
 */
export function useMenuEscape(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.shiftKey) return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => { document.removeEventListener('keydown', onKeyDown, true) }
  }, [open])
}
