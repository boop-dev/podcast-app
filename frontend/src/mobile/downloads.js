/* Offline downloads on native: real files, not Cache Storage.
 *
 * The audio bytes are downloaded with the @capacitor/filesystem
 * plugin's downloadFile() (native HTTP, no CORS) into the app's
 * private Data directory, and the record (episode id -> file path)
 * lives in IndexedDB alongside everything else (see ./store.js).
 * Playback of a downloaded episode uses Capacitor.convertFileSrc()
 * so the <audio> element can load the local file; anything not
 * downloaded plays straight from its enclosure URL.
 *
 * The web path keeps using Cache Storage + the service worker —
 * see ../lib/downloads.js, which picks this backend only on native.
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import * as store from './store.js'

function fileNameFor(episode) {
  const url = episode.audio_url || ''
  const ext = (url.split('?')[0].match(/\.(mp3|m4a|ogg|wav|aac|flac)$/i) || ['.mp3'])[0]
  // Sanitise: episode ids are already hash-based, so the name is safe.
  return `${episode.id}${ext}`
}

/** Download an episode's audio to a real file and record it. */
export async function downloadEpisodeNative(episode) {
  const path = fileNameFor(episode)
  let result
  if (typeof Filesystem.downloadFile === 'function') {
    result = await Filesystem.downloadFile({
      path,
      url: episode.audio_url,
      directory: Directory.Data,
    })
  } else {
    // Older plugin fallback: fetch the bytes natively, then write them.
    // (Not expected on the installed plugin version; kept for safety.)
    const res = await CapacitorHttp.get({ url: episode.audio_url, responseType: 'blob' })
    const blob = res.data
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    result = await Filesystem.writeFile({ path, data: base64, directory: Directory.Data })
  }
  await store.putDownload(episode.id, {
    episodeId: episode.id,
    path: result.path || path,
    fileName: path,
    downloadedAt: new Date().toISOString(),
  })
  return result
}

/** Delete a downloaded file and its record. */
export async function removeDownloadNative(episode) {
  const record = await store.getDownload(episode.id)
  if (record && record.path) {
    await Filesystem.deleteFile({ path: record.path, directory: Directory.Data }).catch(() => {})
  }
  await store.removeDownload(episode.id)
}

/** True if a local file is stored for this episode. */
export async function isDownloadedNative(episode) {
  const record = await store.getDownload(episode.id)
  return Boolean(record && record.path)
}

/** The src for the <audio> element: the local file when downloaded,
 *  otherwise the episode's enclosure URL (direct playback, no proxy). */
export async function resolveAudioSrc(episode) {
  const record = await store.getDownload(episode.id)
  if (record && record.path) {
    return Capacitor.convertFileSrc(record.path)
  }
  return episode.audio_url
}
