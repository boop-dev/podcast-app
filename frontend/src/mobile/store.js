/* On-device storage for the Capacitor build: localForage over IndexedDB.
 *
 * Why IndexedDB (via localForage) and not @capacitor-community/sqlite:
 *   - Zero native build risk: no extra native plugin, no SQLite NDK /
 *     Gradle wiring, nothing that can fail the user's Windows APK build.
 *   - It persists on the device (WebView IndexedDB survives app restarts)
 *     and holds everything this app needs: a few dozen shows, a few
 *     thousand small episode records, positions and a queue list.
 *   - It also works in a plain desktop browser, so this whole layer is
 *     testable in Node (with fake-indexeddb) and in `vite dev` without
 *     a device or an emulator.
 * The sqlite plugin would only win at tens of thousands of rows or
 * complex queries; this app does key lookups and small full scans.
 *
 * IDs are deterministic hashes of the natural key (feed URL for shows,
 * show + guid for episodes), so a re-fetch or a re-subscribe finds the
 * same rows and saved positions / queue entries survive a refresh.
 */

import localforage from 'localforage'

function hash(str) {
  // FNV-1a, hex. Deterministic across runs; collisions are negligible
  // at this scale (and a collision would only merge two episodes).
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function showIdFor(feedUrl) {
  return `show_${hash(feedUrl)}`
}

export function episodeIdFor(showId, guid) {
  return `ep_${hash(`${showId}|${guid}`)}`
}

const stores = {
  shows: localforage.createInstance({ name: 'podcast-app', storeName: 'shows' }),
  episodes: localforage.createInstance({ name: 'podcast-app', storeName: 'episodes' }),
  positions: localforage.createInstance({ name: 'podcast-app', storeName: 'positions' }),
  queue: localforage.createInstance({ name: 'podcast-app', storeName: 'queue' }),
  downloads: localforage.createInstance({ name: 'podcast-app', storeName: 'downloads' }),
}

const QUEUE_KEY = 'order' // queue store holds one key: the ordered id list

async function all(store) {
  const out = []
  await store.iterate((value) => {
    out.push(value)
  })
  return out
}

// --- shows ---------------------------------------------------------------

export async function putShow(show) {
  await stores.shows.setItem(show.id, show)
  return show
}

export async function getShow(showId) {
  return stores.shows.getItem(showId)
}

export async function listShows() {
  const shows = await all(stores.shows)
  shows.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
  return shows
}

export async function deleteShowAndEpisodes(showId) {
  await stores.shows.removeItem(showId)
  const episodes = await all(stores.episodes)
  for (const ep of episodes) {
    if (ep.show_id === showId) {
      await stores.episodes.removeItem(ep.id)
      await stores.positions.removeItem(ep.id)
      await stores.downloads.removeItem(ep.id)
    }
  }
  const order = (await stores.queue.getItem(QUEUE_KEY)) || []
  await stores.queue.setItem(
    QUEUE_KEY,
    order.filter((id) => !episodes.some((ep) => ep.id === id && ep.show_id === showId)),
  )
}

// --- episodes ------------------------------------------------------------

export async function putEpisodes(episodes) {
  for (const ep of episodes) await stores.episodes.setItem(ep.id, ep)
}

export async function getEpisode(episodeId) {
  return stores.episodes.getItem(episodeId)
}

export async function listEpisodesForShow(showId) {
  const episodes = (await all(stores.episodes)).filter((ep) => ep.show_id === showId)
  episodes.sort((a, b) => {
    const da = a.pub_date || ''
    const db = b.pub_date || ''
    if (db !== da) return db < da ? -1 : 1
    return a.id < b.id ? 1 : -1
  })
  return episodes
}

export async function countEpisodesForShow(showId) {
  return (await listEpisodesForShow(showId)).length
}

// --- positions -----------------------------------------------------------

export async function getPosition(episodeId) {
  return (await stores.positions.getItem(episodeId)) || null
}

export async function savePosition(episodeId, positionSeconds, completed) {
  await stores.positions.setItem(episodeId, {
    position_seconds: positionSeconds,
    completed,
    updated_at: Date.now(),
  })
}

export async function putPositionRaw(episodeId, record) {
  await stores.positions.setItem(episodeId, record)
}

/** All saved positions as [{episodeId, ...position}]. */
export async function listPositions() {
  const out = []
  await stores.positions.iterate((value, key) => {
    out.push({ episodeId: key, ...value })
  })
  return out
}

/** Every stored episode (used by the Home tab's "new" list). */
export async function listAllEpisodes() {
  return all(stores.episodes)
}

// --- queue ---------------------------------------------------------------

export async function getQueueOrder() {
  return (await stores.queue.getItem(QUEUE_KEY)) || []
}

export async function setQueueOrder(ids) {
  await stores.queue.setItem(QUEUE_KEY, ids)
}

export async function addToQueueOrder(episodeId) {
  const order = await getQueueOrder()
  if (!order.includes(episodeId)) {
    order.push(episodeId)
    await setQueueOrder(order)
  }
}

export async function removeFromQueueOrder(episodeId) {
  await setQueueOrder((await getQueueOrder()).filter((id) => id !== episodeId))
}

// --- downloads -----------------------------------------------------------

export async function getDownload(episodeId) {
  return stores.downloads.getItem(episodeId)
}

export async function putDownload(episodeId, record) {
  await stores.downloads.setItem(episodeId, record)
}

export async function removeDownload(episodeId) {
  await stores.downloads.removeItem(episodeId)
}

export async function listDownloadIds() {
  const ids = []
  await stores.downloads.iterate((_value, key) => {
    ids.push(key)
  })
  return ids
}

// Test/maintenance hook: wipe everything (used by the Node verify script).
export async function clearAll() {
  for (const store of Object.values(stores)) await store.clear()
}
