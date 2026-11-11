/* Offline downloads. Downloading goes through the queue in downloadManager.js
 * (progress, retry, storage cap); removing a download is immediate. */

import { api } from '../api.js'
import { isDownloadedNative, removeDownloadNative } from '../mobile/downloads.js'
import { enqueue } from './downloadManager.js'

/** Queue an episode for download (returns at once; watch progress with useDownloadJob). */
export async function downloadEpisode(episode) {
  return enqueue(episode)
}

export async function removeDownload(episode) {
  await removeDownloadNative(episode)
  await api.unmarkDownloaded(episode.id)
}

export async function isDownloaded(episode) {
  return isDownloadedNative(episode)
}
