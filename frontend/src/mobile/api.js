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

import { CapacitorHttp } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { buildOpmlXml, parseOpmlFeedUrls } from './opml.js'
import { fetchFeed, httpGetJson, normalizeChapters } from './rss.js'
import * as store from './store.js'

const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search'

async function withState(ep) {
  const [pos, queueOrder, download, show] = await Promise.all([
    store.getPosition(ep.id),
    store.getQueueOrder(),
    store.getDownload(ep.id),
    store.getShow(ep.show_id),
  ])
  return {
    ...ep,
    show_title: show ? show.title : '',
    show_image: show ? show.image_url : null,
    position_seconds: pos ? pos.position_seconds : 0,
    completed: pos ? Boolean(pos.completed) : false,
    is_new: Boolean(ep.is_new) && !(pos && pos.completed),
    in_queue: queueOrder.includes(ep.id),
    downloaded: Boolean(download),
  }
}

// Episodes stored before chapter support have no chapters_url: fill it in
// from the fresh feed (never touching anything else about them).
async function backfillChapterUrls(stored, incoming) {
  const byId = new Map(stored.map((ep) => [ep.id, ep]))
  const updates = []
  for (const ep of incoming) {
    const old = byId.get(ep.id)
    if (old && !old.chapters_url && ep.chapters_url) updates.push({ ...old, chapters_url: ep.chapters_url })
  }
  if (updates.length) await store.putEpisodes(updates)
}

// Once an episode of an auto-download show is finished, free its file.
async function deleteDownloadIfAuto(ep) {
  if (!ep) return
  const show = await store.getShow(ep.show_id)
  if (!show || !show.auto_download) return
  const dl = await store.getDownload(ep.id)
  if (dl && dl.path) {
    await Filesystem.deleteFile({ path: dl.path, directory: Directory.Data }).catch(() => {})
  }
  if (dl) await store.removeDownload(ep.id)
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
    await store.putShow({ ...(existing || {}), ...show }) // keep per-show settings
    // Insert new episodes only; never clobber a stored episode's id.
    const stored = await store.listEpisodesForShow(show.id)
    const known = new Set(stored.map((ep) => ep.id))
    await backfillChapterUrls(stored, episodes)
    // First subscribe: the back catalogue is not "new". Re-subscribe: it is.
    const fresh = episodes
      .filter((ep) => !known.has(ep.id))
      .map((ep) => ({ ...ep, is_new: Boolean(existing) }))
    await store.putEpisodes(fresh)
    const count = await store.countEpisodesForShow(show.id)
    return { ...show, episode_count: count, _isNew: !existing }
  },

  async getEpisode(episodeId) {
    const ep = await store.getEpisode(episodeId)
    return ep ? withState(ep) : null
  },

  async listShows() {
    const shows = await store.listShows()
    return Promise.all(
      shows.map(async (show) => {
        const episodes = await store.listEpisodesForShow(show.id)
        let newCount = 0
        for (const ep of episodes) {
          if (!ep.is_new) continue
          const pos = await store.getPosition(ep.id)
          if (!(pos && pos.completed)) newCount++
        }
        return { ...show, episode_count: episodes.length, new_count: newCount }
      }),
    )
  },

  async listEpisodes(showId) {
    const episodes = await store.listEpisodesForShow(showId)
    return Promise.all(episodes.map(withState))
  },

  async refreshShow(showId) {
    const show = await store.getShow(showId)
    if (!show) throw new Error('show not found')
    const { show: freshShow, episodes } = await fetchFeed(show.feed_url)
    // Keep per-show settings (auto_download) across a feed refresh.
    await store.putShow({ ...show, ...freshShow, id: showId, auto_download: show.auto_download })
    const stored = await store.listEpisodesForShow(showId)
    const known = new Set(stored.map((ep) => ep.id))
    await backfillChapterUrls(stored, episodes)
    const fresh = episodes
      .filter((ep) => !known.has(ep.id))
      .map((ep) => ({ ...ep, is_new: true }))
    await store.putEpisodes(fresh)
    return {
      show_id: showId,
      new_episodes: fresh.length,
      new_episode_ids: fresh.map((ep) => ep.id),
    }
  },

  /** Clear the "new" flag on every episode of a show (user has seen them). */
  async markShowSeen(showId) {
    const episodes = await store.listEpisodesForShow(showId)
    const flagged = episodes.filter((ep) => ep.is_new)
    await store.putEpisodes(flagged.map((ep) => ({ ...ep, is_new: false })))
    return { seen: flagged.length }
  },

  /** Mark every episode of a show played (clears its "new" flags too). */
  async markShowPlayed(showId) {
    const episodes = await store.listEpisodesForShow(showId)
    let changed = 0
    const cleared = []
    for (const ep of episodes) {
      const pos = await store.getPosition(ep.id)
      if (!(pos && pos.completed)) {
        await store.savePosition(ep.id, 0, true)
        changed++
      }
      if (ep.is_new) cleared.push({ ...ep, is_new: false })
    }
    if (cleared.length) await store.putEpisodes(cleared)
    return { changed }
  },

  /** Mark one episode played (finished) or unplayed. */
  async setPlayed(episodeId, played) {
    await store.savePosition(episodeId, 0, Boolean(played))
    const ep = await store.getEpisode(episodeId)
    if (ep && ep.is_new) await store.putEpisodes([{ ...ep, is_new: false }])
    if (played) await deleteDownloadIfAuto(ep)
    return { completed: Boolean(played) }
  },

  /** Chapters for an episode ([] if it has none). Fetched once, then cached. */
  async getChapters(episodeId) {
    const ep = await store.getEpisode(episodeId)
    if (!ep) return []
    if (Array.isArray(ep.chapters)) return ep.chapters
    if (!ep.chapters_url) return []
    try {
      const chapters = normalizeChapters(await httpGetJson(ep.chapters_url))
      await store.putEpisodes([{ ...ep, chapters }])
      return chapters
    } catch {
      return [] // offline or bad file: try again next time
    }
  },

  async getPlaybackSpeed(showId) {
    const show = await store.getShow(showId)
    return (show && show.playback_speed) || 1
  },

  async setPlaybackSpeed(showId, speed) {
    const show = await store.getShow(showId)
    if (!show) return { playback_speed: speed }
    await store.putShow({ ...show, playback_speed: speed })
    return { playback_speed: speed }
  },

  async setAutoDownload(showId, enabled) {
    const show = await store.getShow(showId)
    if (!show) throw new Error('show not found')
    await store.putShow({ ...show, auto_download: Boolean(enabled) })
    return { auto_download: Boolean(enabled) }
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
    const ep = await store.getEpisode(episodeId)
    if (ep && ep.is_new) await store.putEpisodes([{ ...ep, is_new: false }])
    if (done) await deleteDownloadIfAuto(ep)
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

  /** Home tab: episodes in progress (most recent first). */
  async listContinue(limit = 10) {
    const positions = (await store.listPositions())
      .filter((p) => !p.completed && p.position_seconds > 10)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    return this._withShow(positions.map((p) => p.episodeId), limit)
  },

  /** Home tab: unplayed episodes found by refreshes, newest first. */
  async listNew(limit = 20) {
    const eps = (await store.listAllEpisodes()).filter((ep) => ep.is_new)
    eps.sort((a, b) => ((b.pub_date || '') < (a.pub_date || '') ? -1 : 1))
    return this._withShow(eps.map((ep) => ep.id), limit)
  },

  async _withShow(ids, limit) {
    const out = []
    for (const id of ids) {
      const ep = await store.getEpisode(id)
      if (!ep) continue
      const state = await withState(ep)
      if (state.completed) continue
      const show = await store.getShow(ep.show_id)
      out.push({ ...state, show_title: show ? show.title : '', show_image: show ? show.image_url : null })
      if (out.length >= limit) break
    }
    return out
  },

  /** Subscribe to every feed in an OPML file. Returns {added, failed}. */
  async importOpml(xml) {
    const urls = parseOpmlFeedUrls(xml)
    let added = 0
    const failed = []
    for (const url of urls) {
      try {
        const r = await this.subscribe(url)
        if (r._isNew) added++
      } catch {
        failed.push(url)
      }
    }
    return { total: urls.length, added, failed }
  },

  /** Per-show download sizes: [{showId, title, count, bytes}] + total bytes. */
  async storageUsage() {
    const shows = await store.listShows()
    const byShow = new Map(shows.map((s) => [s.id, { showId: s.id, title: s.title, count: 0, bytes: 0 }]))
    for (const id of await store.listDownloadIds()) {
      const dl = await store.getDownload(id)
      const ep = await store.getEpisode(id)
      if (!dl || !dl.path || !ep || !byShow.has(ep.show_id)) continue
      let size = 0
      try {
        size = Number((await Filesystem.stat({ path: dl.path, directory: Directory.Data })).size) || 0
      } catch {
        /* file missing: counts as zero */
      }
      const row = byShow.get(ep.show_id)
      row.count++
      row.bytes += size
    }
    const rows = [...byShow.values()].filter((r) => r.count > 0).sort((a, b) => b.bytes - a.bytes)
    return { rows, total: rows.reduce((n, r) => n + r.bytes, 0) }
  },

  /** Delete downloaded files. showId null = all shows; onlyPlayed keeps unfinished ones. */
  async deleteDownloads({ showId = null, onlyPlayed = false } = {}) {
    let removed = 0
    for (const id of await store.listDownloadIds()) {
      const ep = await store.getEpisode(id)
      if (showId && (!ep || ep.show_id !== showId)) continue
      if (onlyPlayed) {
        const pos = await store.getPosition(id)
        if (!(pos && pos.completed)) continue
      }
      const dl = await store.getDownload(id)
      if (dl && dl.path) {
        await Filesystem.deleteFile({ path: dl.path, directory: Directory.Data }).catch(() => {})
      }
      await store.removeDownload(id)
      removed++
    }
    return { removed }
  },

  /** Everything needed to rebuild the library on a new install. Episodes
   *  are re-fetched from the feeds; ids are deterministic, so positions
   *  and the queue line up again. */
  async buildBackup() {
    const shows = await store.listShows()
    const positions = {}
    for (const p of await store.listPositions()) {
      const { episodeId, ...rest } = p
      positions[episodeId] = rest
    }
    return {
      app: 'podcast-app',
      version: 1,
      created_at: new Date().toISOString(),
      shows: shows.map((s) => ({ feed_url: s.feed_url, auto_download: Boolean(s.auto_download) })),
      positions,
      queue: await store.getQueueOrder(),
    }
  },

  async saveBackupToFile() {
    const backup = await this.buildBackup()
    const stamp = new Date().toISOString().slice(0, 10)
    const result = await Filesystem.writeFile({
      path: `podcast-backup-${stamp}.json`,
      data: JSON.stringify(backup),
      directory: Directory.Documents,
      encoding: 'utf8',
    })
    return result.uri
  },

  async restoreBackup(json) {
    const backup = typeof json === 'string' ? JSON.parse(json) : json
    if (!backup || backup.app !== 'podcast-app' || !Array.isArray(backup.shows)) {
      throw new Error('Not a Podcast App backup file')
    }
    const failed = []
    for (const s of backup.shows) {
      try {
        const show = await this.subscribe(s.feed_url)
        if (s.auto_download) await this.setAutoDownload(show.id, true)
      } catch {
        failed.push(s.feed_url)
      }
    }
    let restored = 0
    for (const [id, rec] of Object.entries(backup.positions || {})) {
      if (!(await store.getEpisode(id))) continue
      const current = await store.getPosition(id)
      if (!current || (rec.updated_at || 0) > (current.updated_at || 0)) {
        await store.putPositionRaw(id, rec)
        restored++
      }
    }
    const queue = []
    for (const id of backup.queue || []) {
      if (await store.getEpisode(id)) queue.push(id)
    }
    if (queue.length) await store.setQueueOrder([...new Set([...(await store.getQueueOrder()), ...queue])])
    return { shows: backup.shows.length - failed.length, failed, positions: restored, queued: queue.length }
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

// Kept for the Node verify script: Apple Search over plain fetch is
// exercised there instead, since CapacitorHttp needs a native shell.
export { CapacitorHttp }
