/* Foreground sync for the native app: refresh every subscribed feed and
 * auto-download new episodes of shows that opted in.
 *
 * Runs on app start and whenever the app returns to the foreground, at
 * most once per MIN_INTERVAL_MS. (True background fetch needs a native
 * scheduled task, which this app does not have yet.)
 */

import { mobileApi } from './api.js'
import { enqueueMany } from '../lib/downloadManager.js'
import * as store from './store.js'

const MIN_INTERVAL_MS = 30 * 60 * 1000
const MAX_AUTO_PER_SHOW = 3 // newest N new episodes per show per sync
const LAST_KEY = 'podcast-app:last-sync'

function onWifiOrUnknown() {
  // navigator.connection.type is available in Android WebView; if it is
  // missing we cannot tell, so allow the download rather than never run.
  const type = navigator.connection && navigator.connection.type
  return !type || type === 'wifi' || type === 'ethernet'
}

function lastSync() {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || 0
  } catch {
    return 0
  }
}

/** Returns {refreshed, newEpisodes, downloaded}, or null if skipped. */
export async function syncAll({ force = false } = {}) {
  if (!force && Date.now() - lastSync() < MIN_INTERVAL_MS) return null
  try {
    localStorage.setItem(LAST_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
  const shows = await store.listShows()
  let newEpisodes = 0
  let downloaded = 0
  let refreshed = 0
  for (const show of shows) {
    try {
      const res = await mobileApi.refreshShow(show.id)
      refreshed++
      newEpisodes += res.new_episodes
      if (show.auto_download && res.new_episode_ids.length && onWifiOrUnknown()) {
        const episodes = []
        for (const id of res.new_episode_ids) {
          const ep = await store.getEpisode(id)
          if (ep) episodes.push(ep)
        }
        episodes.sort((a, b) => ((b.pub_date || '') < (a.pub_date || '') ? -1 : 1))
        // Queued, not awaited: the manager downloads in the background and shows progress.
        downloaded += await enqueueMany(episodes.slice(0, MAX_AUTO_PER_SHOW)).catch(() => 0)
      }
    } catch {
      /* feed unreachable: skip it and carry on */
    }
  }
  return { refreshed, newEpisodes, downloaded }
}
