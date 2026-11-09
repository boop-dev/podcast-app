/* Offline downloads, platform-switched.
 *
 * Web: the original Cache Storage implementation below. The audio
 * bytes live in a cache named 'podcast-episodes' on the device, and
 * the service worker (src/sw.js) serves them, including HTTP Range
 * requests for seeking. The backend only stores the *record* of which
 * episodes are downloaded (see /api/downloads).
 *
 * Native (Capacitor APK): real files via @capacitor/filesystem —
 * see src/mobile/downloads.js. The <audio> element plays them from
 * disk through Capacitor.convertFileSrc(); nothing is cached and no
 * service worker is involved.
 */

import { Capacitor } from '@capacitor/core'
import { api, audioUrl } from '../api.js'
import {
  downloadEpisodeNative,
  isDownloadedNative,
  removeDownloadNative,
} from '../mobile/downloads.js'

const CACHE_NAME = 'podcast-episodes'
const native = () => Capacitor.isNativePlatform()

export async function downloadEpisode(episode) {
  if (native()) {
    await downloadEpisodeNative(episode)
    await api.markDownloaded(episode.id)
    return
  }
  const cache = await caches.open(CACHE_NAME)
  await cache.add(audioUrl(episode))
  await api.markDownloaded(episode.id)
}

export async function removeDownload(episode) {
  if (native()) {
    await removeDownloadNative(episode)
    await api.unmarkDownloaded(episode.id)
    return
  }
  const cache = await caches.open(CACHE_NAME)
  await cache.delete(audioUrl(episode))
  await api.unmarkDownloaded(episode.id)
}

export async function isDownloaded(episode) {
  if (native()) return isDownloadedNative(episode)
  const cache = await caches.open(CACHE_NAME)
  const hit = await cache.match(audioUrl(episode))
  return Boolean(hit)
}
