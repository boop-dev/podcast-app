/* Custom service worker (vite-plugin-pwa injectManifest strategy).
 *
 * Workbox precaches the app shell. Audio is handled by hand below,
 * because a podcast player needs HTTP Range requests (seeking), and
 * neither the Cache API nor workbox's default strategies slice cached
 * responses for Range requests. The handler here does:
 *   - cache hit + no Range  -> serve the cached file
 *   - cache hit + Range     -> slice the cached bytes, answer 206
 *   - cache miss            -> fetch from the network (the backend
 *                              /api/audio proxy), do NOT cache implicitly.
 * Only episodes the user explicitly downloads are put in the cache,
 * by the download button in the UI (see src/lib/downloads.js).
 */

import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

precacheAndRoute(self.__WB_MANIFEST)

// Single-page app: every navigation serves index.html.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

const EPISODE_CACHE = 'podcast-episodes'

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.pathname === '/api/audio') {
    event.respondWith(handleAudio(event.request))
  }
})

async function handleAudio(request) {
  const cache = await caches.open(EPISODE_CACHE)
  const cached = await cache.match(request.url)
  if (!cached) {
    return fetch(request)
  }

  const range = request.headers.get('range')
  if (!range) {
    return cached
  }

  const buffer = await cached.clone().arrayBuffer()
  const match = /bytes=(\d*)-(\d*)/.exec(range)
  const start = match && match[1] ? parseInt(match[1], 10) : 0
  const end = match && match[2] ? parseInt(match[2], 10) : buffer.byteLength - 1
  const sliced = buffer.slice(start, end + 1)

  return new Response(sliced, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Length': String(sliced.byteLength),
      'Content-Range': `bytes ${start}-${end}/${buffer.byteLength}`,
      'Accept-Ranges': 'bytes',
    },
  })
}
