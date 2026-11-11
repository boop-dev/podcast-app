/* Tiny event channel so any episode row can open the detail page without
 * threading a callback through every list. App.jsx mounts <EpisodeDetail/>,
 * which listens for this. */

const EVENT = 'open-episode-detail'

export function openEpisodeDetail(episode) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: episode }))
}

export function onOpenEpisodeDetail(handler) {
  const listener = (e) => handler(e.detail)
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
