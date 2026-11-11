/* Offline downloads: real files via @capacitor/filesystem (see
 * src/mobile/downloads.js). The native player plays them from disk. */

import { api } from '../api.js'
import { downloadEpisodeNative, isDownloadedNative, removeDownloadNative } from '../mobile/downloads.js'

export async function downloadEpisode(episode) {
  await downloadEpisodeNative(episode)
  await api.markDownloaded(episode.id)
}

export async function removeDownload(episode) {
  await removeDownloadNative(episode)
  await api.unmarkDownloaded(episode.id)
}

export async function isDownloaded(episode) {
  return isDownloadedNative(episode)
}
