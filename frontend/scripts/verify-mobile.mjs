/* Verify the mobile (Capacitor) data layer without a device.
 *
 * Run:  node scripts/verify-mobile.mjs
 * (from frontend/; needs devDependency fake-indexeddb for IndexedDB.)
 *
 * What it checks, in order:
 *   1. Apple Search API (plain fetch, same URL/params as the mobile
 *      layer's CapacitorHttp call) returns a real feed URL — no
 *      guessed feed URLs.
 *   2. That feed's XML, parsed on-device-style by parseFeedXml(),
 *      yields the show/episode shapes the UI expects.
 *   3. Storage round-trips in localForage/IndexedDB: shows, episodes,
 *      positions (including the finished-episode rule), queue
 *      add/list/reorder/remove, downloads, delete-show cascade.
 *   4. OPML built on-device from the stored shows.
 *   5. Best-effort: the mobileApi itself over CapacitorHttp (search +
 *      subscribe). CapacitorHttp needs a native shell or a browser
 *      WebView; in Node it may fail, which is reported, not fatal —
 *      steps 1–4 already cover the same code paths (httpGetJson /
 *      fetchFeed differ only in transport).
 */

import 'fake-indexeddb/auto'

import { buildOpmlXml } from '../src/mobile/opml.js'
import { parseDuration, parseFeedXml, textOf } from '../src/mobile/rss.js'
import * as store from '../src/mobile/store.js'
import { mobileApi } from '../src/mobile/api.js'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
function assertShape(ep) {
  return (
    typeof ep.id === 'string' &&
    typeof ep.guid === 'string' &&
    typeof ep.title === 'string' &&
    typeof ep.audio_url === 'string' &&
    ep.audio_url.startsWith('http') &&
    (ep.duration_seconds === null || Number.isInteger(ep.duration_seconds)) &&
    (ep.pub_date === null || !Number.isNaN(Date.parse(ep.pub_date)))
  )
}

const SEARCH_TERM = process.argv[2] || 'lex fridman'

// --- 1. Apple Search: a real feed URL, found the same way the app does ---
const searchRes = await fetch(
  `https://itunes.apple.com/search?${new URLSearchParams({ media: 'podcast', term: SEARCH_TERM, limit: 5 })}`,
)
check('Apple Search API responds', searchRes.ok, `HTTP ${searchRes.status}`)
const searchJson = await searchRes.json()
const hit = (searchJson.results || []).find((r) => r.feedUrl)
check('Apple Search returns a result with a feedUrl', Boolean(hit), hit?.collectionName || 'none')
if (!hit) process.exit(1)
console.log(`      feed: ${hit.feedUrl}`)

// --- 2. Fetch the real feed and parse it the way the device will ---
const feedRes = await fetch(hit.feedUrl, { headers: { 'User-Agent': 'podcast-app/1.0' } })
check('Feed fetches', feedRes.ok, `HTTP ${feedRes.status}`)
const xml = await feedRes.text()
const { show, episodes } = parseFeedXml(xml, hit.feedUrl)
check('Feed parses to a show with title + feed_url', Boolean(show.title && show.feed_url === hit.feedUrl), show.title)
check('Feed yields episodes', episodes.length > 0, `${episodes.length} episodes`)
check('First episode matches UI shape', assertShape(episodes[0]), episodes[0].title)
check('All parsed episodes match UI shape', episodes.every(assertShape))
check('parseDuration handles seconds + MM:SS + HH:MM:SS',
  parseDuration('42') === 42 && parseDuration('12:34') === 754 && parseDuration('1:02:03') === 3723)
check('textOf unwraps #text nodes', textOf({ '#text': 'hello' }) === 'hello')

// --- 3. Storage round-trips (localForage / IndexedDB) ---
await store.clearAll()
await store.putShow(show)
await store.putEpisodes(episodes)
const shows = await store.listShows()
check('listShows returns the stored show', shows.length === 1 && shows[0].id === show.id)
check('episode count matches', (await store.countEpisodesForShow(show.id)) === episodes.length)
const listed = await store.listEpisodesForShow(show.id)
check('episodes newest-first', listed.length > 1 ? (listed[0].pub_date || '') >= (listed[1].pub_date || '') : true)

const ep = episodes[0]
const ep2 = episodes[1] || episodes[0]
await store.savePosition(ep.id, 123, false)
const pos = await store.getPosition(ep.id)
check('position round-trips', pos && pos.position_seconds === 123 && pos.completed === false)

// Finished-episode rule, via the mobile API (mirrors the backend):
// within 10s of the end counts as finished and resets to 0.
const saved = await mobileApi.savePosition(ep.id, 3595, 3600)
check('savePosition marks near-end as finished + resets', saved.completed === true && saved.position_seconds === 0)
const pos2 = await mobileApi.getPosition(ep.id)
check('finished position reads back', pos2.completed === true && pos2.position_seconds === 0)

await mobileApi.addToQueue(ep.id)
await mobileApi.addToQueue(ep2.id)
await mobileApi.addToQueue(ep.id) // duplicate: ignored
let queue = await mobileApi.listQueue()
check('queue add + dedupe', queue.length === 2 && queue[0].id === ep.id, queue.map((e) => e.title.slice(0, 20)).join(' | '))
check('queued episodes carry state fields', queue.every((e) => typeof e.position_seconds === 'number' && typeof e.in_queue === 'boolean'))
await mobileApi.reorderQueue([ep2.id, ep.id])
queue = await mobileApi.listQueue()
check('queue reorder', queue[0].id === ep2.id && queue[1].id === ep.id)
await mobileApi.removeFromQueue(ep2.id)
queue = await mobileApi.listQueue()
check('queue remove', queue.length === 1 && queue[0].id === ep.id)

await store.putDownload(ep.id, { episodeId: ep.id, path: 'fake/path.mp3', downloadedAt: new Date().toISOString() })
check('listDownloads', (await mobileApi.listDownloads()).includes(ep.id))
const withState = (await mobileApi.listEpisodes(show.id)).find((e) => e.id === ep.id)
check('episode state flags (downloaded + in_queue)', withState.downloaded === true && withState.in_queue === true)

// --- 4. OPML built on-device from stored shows ---
const opml = buildOpmlXml(await store.listShows())
check('OPML contains show title + feed URL', opml.includes(show.title) && opml.includes(hit.feedUrl))
const apiOpml = await mobileApi.exportOpml()
check('mobileApi.exportOpml matches builder', apiOpml === opml)
console.log('      OPML preview:', opml.split('\n').find((l) => l.includes('<outline'))?.trim())

// --- 5. Best-effort: the mobileApi over CapacitorHttp (needs a shell) ---
try {
  const data = await mobileApi.search(SEARCH_TERM)
  check('mobileApi.search via CapacitorHttp', (data.results || []).length > 0, `${(data.results || []).length} results`)
  const sub = await mobileApi.subscribe(hit.feedUrl)
  check('mobileApi.subscribe via CapacitorHttp', sub.id === show.id && sub.episode_count === episodes.length)
} catch (err) {
  console.log(`SKIP  mobileApi over CapacitorHttp (expected without a native shell): ${err.message}`)
}

// --- cleanup: delete-show cascade ---
await mobileApi.deleteShow(show.id)
check('deleteShow removes show + episodes', (await store.listShows()).length === 0 && (await store.listEpisodesForShow(show.id)).length === 0)
check('deleteShow clears queue', (await mobileApi.listQueue()).length === 0)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
