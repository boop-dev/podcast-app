/* Offline downloads, using the Cache Storage API.
 *
 * The audio bytes live in a cache named 'podcast-episodes' on the device.
 * The service worker (src/sw.js) serves those bytes when the player asks
 * for them, including HTTP Range requests for seeking, so downloaded
 * episodes keep working with no connection. The backend only stores the
 * *record* of which episodes are downloaded (see /api/downloads).
 */

import { api, audioUrl } from '../api'

const CACHE_NAME = 'podcast-episodes'

export async function downloadEpisode(episode) {
  const cache = await caches.open(CACHE_NAME)
  await cache.add(audioUrl(episode))
  await api.markDownloaded(episode.id)
}

export async function removeDownload(episode) {
  const cache = await caches.open(CACHE_NAME)
  await cache.delete(audioUrl(episode))
  await api.unmarkDownloaded(episode.id)
}

export async function isDownloaded(episode) {
  const cache = await caches.open(CACHE_NAME)
  const hit = await cache.match(audioUrl(episode))
  return Boolean(hit)
}
