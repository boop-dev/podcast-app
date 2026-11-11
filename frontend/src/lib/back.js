/* Android back-button handling.
 *
 * Screens that have something to "go back" from (an open player sheet, an
 * open show page) register a handler while they are active. The native
 * back button runs the most recently registered one. If none is active,
 * App.jsx falls back to returning to the first tab, then to minimising
 * the app, so audio keeps playing instead of the app being destroyed.
 */

import { useEffect, useRef } from 'react'

const handlers = []

/** Run the topmost handler. Returns true if one handled the event. */
export function handleBack() {
  const fn = handlers[handlers.length - 1]
  if (!fn) return false
  fn()
  return true
}

/** While `active` is true, back presses call `fn` (latest closure). */
export function useBackHandler(active, fn) {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!active) return undefined
    const entry = () => fnRef.current()
    handlers.push(entry)
    return () => {
      const i = handlers.indexOf(entry)
      if (i >= 0) handlers.splice(i, 1)
    }
  }, [active])
}
