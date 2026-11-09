/* API surface, platform-switched.
 *
 * Web (Flask backend / Termux / local dev): the original thin client in
 * ./api.web.js — same-origin /api calls, audio through the /api/audio
 * proxy. Nothing about that path changes.
 *
 * Native (Capacitor APK): the on-device layer in ./mobile/api.js —
 * IndexedDB storage, CapacitorHttp feed fetching, direct audio URLs.
 * Same method names and return shapes, so every component works
 * unchanged against either backend.
 *
 * The switch is Capacitor.isNativePlatform(): true only inside the
 * native shell. In a desktop browser, in `vite dev`, and in the
 * Termux-served build it is false, so the web path is used.
 */

import { Capacitor } from '@capacitor/core'
import { api as webApi, audioUrl as webAudioUrl } from './api.web.js'
import { isNative, mobileApi, mobileAudioUrl } from './mobile/api.js'
import { resolveAudioSrc as resolveAudioSrcNative } from './mobile/downloads.js'

export { isNative }

export const api = Capacitor.isNativePlatform() ? mobileApi : webApi

/** Sync audio src: web proxy URL, or the direct enclosure URL on native. */
export function audioUrl(episode) {
  return Capacitor.isNativePlatform() ? mobileAudioUrl(episode) : webAudioUrl(episode)
}

/** Async audio src: a downloaded episode's local file when one exists,
 *  otherwise the same URL audioUrl() returns. The Player uses this so
 *  offline downloads play from disk on native. */
export async function resolveAudioSrc(episode) {
  if (Capacitor.isNativePlatform()) return resolveAudioSrcNative(episode)
  return webAudioUrl(episode)
}

/** OPML export on native: writes podcast-subscriptions.opml into the
 *  Documents folder and returns its URI. On web the UI keeps linking
 *  to /api/opml, so this is native-only. */
export async function exportOpmlToFile() {
  return mobileApi.saveOpmlToFile()
}
