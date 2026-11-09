/* Mobile data layer: the same surface as frontend/src/api.js, but fully
 * on-device — no Flask backend. Subscriptions, episodes, positions and
 * the queue live in IndexedDB (see ./store.js); feeds are fetched over
 * CapacitorHttp and parsed on-device (see ./rss.js).
 *
 * Return shapes mirror the backend endpoints so the UI components
 * (App, Shows, SearchView, QueueView, Player) work unchanged:
 *   search       -> {"results": [{collectionName, artistName, artworkUrl,
 *                     feedUrl, trackCount}]}
 *   subscribe    -> show row, with episode_count
 *   listShows    -> [show + episode_count], by title
 *   listEpisodes -> [episode + position_seconds/completed/in_queue/
 *                     downloaded], newest first
 *   refreshShow  -> {show_id, new_episodes}
 *   getPosition  -> {position_seconds, completed}
 *   savePosition -> {position_seconds, completed} (backend rule: within
 *                     10s of the end counts as finished, position resets)
 *   listQueue    -> [episode, ...] in queue order
 *   listDownloads -> [episodeId, ...]
 *   exportOpml   -> OPML XML string for the stored shows
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { buildOpmlXml } from './opml.js'
import { fetchFeed, httpGetJson } from './rss.js'
import * as store from './store.js'

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search'

async function withState(ep) {
  const [pos, queueOrder, download] = await Promise.all([
    store.getPosition(ep.id),
    store.getQueueOrder(),
    store.getDownload(ep.id),
  ])
  return {
    ...ep,
    position_seconds: pos ? pos.position_seconds : 0,
    completed: pos ? Boolean(pos.completed) : false,
    in_queue: queueOrder.includes(ep.id),
    downloaded: Boolean(download),
  }
}

export const mobileApi = {
  async search(q) {
    const data = await httpGetJson(ITUNES_SEARCH_URL, { media: 'podcast', term: q, limit: 20 })
    const results = []
    for (const item of data.results || []) {
      if (!item.feedUrl) continue
      results.push({
        collectionName: item.collectionName,
        artistName: item.artistName,
        artworkUrl: item.artworkUrl600 || item.artworkUrl100,
        feedUrl: item.feedUrl,
        trackCount: item.trackCount,
      })
    }
    return { results }
  },

  async subscribe(feedUrl) {
    const url = (feedUrl || '').trim()
    if (!url) throw new Error('feedUrl is required')
    const { show, episodes } = await fetchFeed(url)
    const existing = await store.getShow(show.id)
    await store.putShow(show)
    // Insert new episodes only; never clobber a stored episode's id.
    const stored = await store.listEpisodesForShow(show.id)
    const known = new Set(stored.map((ep) => ep.id))
    const fresh = episodes.filter((ep) => !known.has(ep.id))
    await store.putEpisodes(fresh)
    const count = await store.countEpisodesForShow(show.id)
    return { ...show, episode_count: count, _isNew: !existing }
  },

  async listShows() {
    const shows = await store.listShows()
    return Promise.all(
      shows.map(async (show) => ({
        ...show,
        episode_count: await store.countEpisodesForShow(show.id),
      })),
    )
  },

  async listEpisodes(showId) {
    const episodes = await store.listEpisodesForShow(showId)
    return Promise.all(episodes.map(withState))
  },

  async refreshShow(showId) {
    const show = await store.getShow(showId)
    if (!show) throw new Error('show not found')
    const before = await store.countEpisodesForShow(showId)
    const { show: freshShow, episodes } = await fetchFeed(show.feed_url)
    await store.putShow({ ...freshShow, id: showId })
    const stored = await store.listEpisodesForShow(showId)
    const known = new Set(stored.map((ep) => ep.id))
    await store.putEpisodes(episodes.filter((ep) => !known.has(ep.id)))
    const after = await store.countEpisodesForShow(showId)
    return { show_id: showId, new_episodes: after - before }
  },

  async deleteShow(showId) {
    const show = await store.getShow(showId)
    if (!show) throw new Error('show not found')
    // Delete any downloaded files first, so storage is freed.
    const episodes = await store.listEpisodesForShow(showId)
    for (const ep of episodes) {
      const dl = await store.getDownload(ep.id)
      if (dl && dl.path) {
        await Filesystem.deleteFile({ path: dl.path, directory: Directory.Data }).catch(() => {})
      }
    }
    await store.deleteShowAndEpisodes(showId)
    return { deleted: showId }
  },

  async getPosition(episodeId) {
    const pos = await store.getPosition(episodeId)
    if (!pos) return { position_seconds: 0, completed: false }
    return { position_seconds: pos.position_seconds, completed: Boolean(pos.completed) }
  },

  async savePosition(episodeId, position, duration, completed = false) {
    let pos = Math.max(Number(position) || 0, 0)
    let done = Boolean(completed)
    if (duration && pos >= duration - 10) {
      done = true
      pos = 0 // finished: start from the top next time (backend rule)
    }
    await store.savePosition(episodeId, pos, done)
    return { position_seconds: pos, completed: done }
  },

  async listQueue() {
    const order = await store.getQueueOrder()
    const episodes = []
    for (const id of order) {
      const ep = await store.getEpisode(id)
      if (ep) episodes.push(await withState(ep))
    }
    return episodes
  },

  async addToQueue(episodeId) {
    const ep = await store.getEpisode(episodeId)
    if (!ep) throw new Error('episode not found')
    await store.addToQueueOrder(episodeId)
    return { queued: episodeId }
  },

  async removeFromQueue(episodeId) {
    await store.removeFromQueueOrder(episodeId)
    return { removed: episodeId }
  },

  async reorderQueue(episodeIds) {
    // Keep only episodes that exist, in the given order.
    const kept = []
    for (const id of episodeIds || []) {
      if (await store.getEpisode(id)) kept.push(id)
    }
    await store.setQueueOrder(kept)
    return { episodeIds: kept }
  },

  async listDownloads() {
    return store.listDownloadIds()
  },

  async markDownloaded(episodeId) {
    // The file record itself is written by mobile/downloads.js; this
    // only records the id so listDownloads stays consistent if a
    // download is recorded without going through that path.
    const existing = await store.getDownload(episodeId)
    if (!existing) await store.putDownload(episodeId, { episodeId, path: null })
    return { downloaded: episodeId }
  },

  async unmarkDownloaded(episodeId) {
    await store.removeDownload(episodeId)
    return { removed: episodeId }
  },

  /** OPML export: the XML string, built on-device from stored shows. */
  async exportOpml() {
    return buildOpmlXml(await store.listShows())
  },

  /** Write the OPML to a real file the user can find (Documents folder)
   *  and return its path, since there is no backend /api/opml to link to. */
  async saveOpmlToFile() {
    const xml = await this.exportOpml()
    const result = await Filesystem.writeFile({
      path: 'podcast-subscriptions.opml',
      data: xml,
      directory: Directory.Documents,
      encoding: 'utf8',
    })
    return result.uri
  },
}

/** Audio plays straight from the episode's enclosure URL with the
 *  existing HTML5 <audio> element — no proxy is needed for playback
 *  (the proxy only existed to dodge CORS, which does not apply to
 *  plain media playback). Downloaded episodes are resolved to their
 *  local file by resolveAudioSrc() in ./downloads.js. */
export function mobileAudioUrl(episode) {
  return episode.audio_url
}

/** True only inside the Capacitor native shell. Used by the api.js
 *  switch and the UI's OPML link. Re-exported here for convenience. */
export function isNative() {
  return Capacitor.isNativePlatform()
}

// Kept for the Node verify script: Apple Search over plain fetch is
// exercised there instead, since CapacitorHttp needs a native shell.
export { CapacitorHttp }
