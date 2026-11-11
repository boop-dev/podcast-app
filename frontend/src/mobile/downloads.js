/* Offline downloads: real files, not a browser cache.
 *
 * The audio bytes are downloaded with the @capacitor/filesystem plugin's
 * downloadFile() (native HTTP) into the app's private Data directory, and the
 * record (episode id -> file path, size, time) lives in IndexedDB alongside
 * everything else (see ./store.js). The native player opens the file by its
 * file:// URI (see ../lib/nativeAudio.js); anything not downloaded streams from
 * its enclosure URL.
 *
 * Queueing, progress and the storage cap live in ../lib/downloadManager.js.
 */

import { Directory, Filesystem } from '@capacitor/filesystem'
import * as store from './store.js'

export const FILE_PATTERN = /^ep_[0-9a-f]+\.(mp3|m4a|ogg|wav|aac|flac)$/i

/** The file's name relative to the app's data folder. Records written by older
 *  versions stored an absolute path in `path`; those still carry `fileName`. */
export function localName(record) {
  if (record.fileName) return record.fileName
  return String(record.path || '').split('/').pop()
}

export function fileNameFor(episode) {
  const url = episode.audio_url || ''
  const ext = (url.split('?')[0].match(/\.(mp3|m4a|ogg|wav|aac|flac)$/i) || ['.mp3'])[0]
  // Episode ids are already hash-based, so the name is safe.
  return `${episode.id}${ext}`
}

/** Download an episode's audio to a real file and record it (with its size).
 *  Progress arrives as 'progress' events from the Filesystem plugin, keyed by URL. */
export async function downloadEpisodeNative(episode) {
  const path = fileNameFor(episode)
  const result = await Filesystem.downloadFile({
    path,
    url: episode.audio_url,
    directory: Directory.Data,
    progress: true,
  })
  let bytes = 0
  try {
    bytes = Number((await Filesystem.stat({ path, directory: Directory.Data })).size) || 0
  } catch {
    /* size unknown: the storage manager measures it later */
  }
  await store.putDownload(episode.id, {
    episodeId: episode.id,
    path, // relative to Directory.Data (the plugin returns an absolute path, which is not what we want here)
    fileName: path,
    bytes,
    downloadedAt: new Date().toISOString(),
  })
  return { path, bytes }
}

/** Delete a downloaded file and its record. */
export async function removeDownloadNative(episode) {
  const record = await store.getDownload(episode.id)
  if (record && record.path) {
    await Filesystem.deleteFile({ path: localName(record), directory: Directory.Data }).catch(() => {})
  }
  await store.removeDownload(episode.id)
}

/** True if a local file is stored for this episode. */
export async function isDownloadedNative(episode) {
  const record = await store.getDownload(episode.id)
  return Boolean(record && record.path)
}
