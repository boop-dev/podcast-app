/* JS side of the native audio engine (android/.../NativeAudioPlugin.java).
 *
 * Playback happens in an Android foreground service (ExoPlayer), not in the
 * WebView, so it keeps working when Chromium freezes the page after a few
 * minutes in the background. The service records position changes and queue
 * auto-advances while JS cannot run; drain() collects them when it can. */

import { registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import * as store from '../mobile/store.js'

export const NativeAudio = registerPlugin('NativeAudio')

/** The URL ExoPlayer should open: the local file for a download, else the enclosure URL. */
async function nativeSrc(episode) {
  const record = await store.getDownload(episode.id)
  if (record && record.path) {
    try {
      const { uri } = await Filesystem.getUri({ path: record.path, directory: Directory.Data })
      return uri
    } catch {
      /* file gone: fall back to streaming */
    }
  }
  return episode.audio_url
}

/** An episode in the shape NativeAudioPlugin expects. */
export async function toItem(episode, fallbackShowTitle = '') {
  return {
    id: episode.id,
    url: await nativeSrc(episode),
    title: episode.title || '',
    artist: episode.show_title || fallbackShowTitle || '',
    artwork: episode.image_url || episode.show_image || '',
    speed: (await store.getShow(episode.show_id).catch(() => null))?.playback_speed || 1,
  }
}

let draining = false

/** Apply what the service recorded (positions, finished episodes, queue
 *  auto-advances) to the app's own storage. Returns true if anything changed. */
export async function applyDrain(api) {
  if (draining) return false
  draining = true
  try {
    const { positions = [], consumed = [] } = await NativeAudio.drain()
    for (const p of positions) {
      await api.savePosition(
        p.id,
        p.completed ? 0 : p.positionMs / 1000,
        p.durationMs ? p.durationMs / 1000 : null,
        Boolean(p.completed),
      )
    }
    for (const id of consumed) await api.removeFromQueue(id)
    return positions.length > 0 || consumed.length > 0
  } finally {
    draining = false
  }
}
