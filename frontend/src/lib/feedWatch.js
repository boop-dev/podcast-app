/* Hands the native background checker (FeedCheckWorker) what it needs: each
 * subscribed feed plus the GUIDs of its newest episodes we already know about.
 * The worker only detects new episodes and notifies; the app does the real
 * refresh when it opens (see syncAll). */

import * as store from '../mobile/store.js'
import { NativeAudio } from './nativeAudio.js'

const KNOWN_PER_FEED = 60

export async function buildFeedList() {
  const shows = await store.listShows()
  const feeds = []
  for (const show of shows) {
    if (show.mute_alerts) continue // the user turned alerts off for this show
    const episodes = await store.listEpisodesForShow(show.id) // newest first
    feeds.push({
      id: show.id,
      title: show.title,
      url: show.feed_url,
      known: episodes.slice(0, KNOWN_PER_FEED).map((e) => e.guid),
    })
  }
  return feeds
}

export async function configureFeedWatch({ enabled, intervalHours }) {
  const feeds = enabled ? await buildFeedList() : []
  return NativeAudio.setFeedWatch({ enabled, intervalHours, feeds })
}

/** Keep the worker's feed list current after the app learned about new episodes. */
export async function refreshFeedWatchList() {
  try {
    const s = await NativeAudio.getFeedWatch()
    if (s.enabled) await configureFeedWatch({ enabled: true, intervalHours: s.intervalHours })
  } catch {
    /* not critical */
  }
}
