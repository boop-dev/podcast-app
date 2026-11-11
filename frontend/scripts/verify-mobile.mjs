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

import { buildOpmlXml, parseOpmlFeedUrls } from '../src/mobile/opml.js'
import { normalizeChapters, parseDuration, parseFeedXml, textOf } from '../src/mobile/rss.js'
import { currentChapter, splitTimestamps } from '../src/lib/notes.js'
import { adRanges, isAdChapter } from '../src/lib/adChapters.js'
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

// --- 6. Played / new / auto-download state ---
{
  await store.putShow({ ...(await store.getShow(show.id)), id: show.id })
  const [e1, e2] = (await store.listEpisodesForShow(show.id)).slice(-2)
  await store.putEpisodes([{ ...e1, is_new: true }, { ...e2, is_new: true }])
  let row = (await mobileApi.listShows()).find((x) => x.id === show.id)
  check('new_count counts unplayed new episodes', row.new_count === 2, `new_count=${row.new_count}`)
  await mobileApi.setPlayed(e1.id, true)
  row = (await mobileApi.listShows()).find((x) => x.id === show.id)
  check('marking played clears its new flag', row.new_count === 1)
  const played = (await mobileApi.listEpisodes(show.id)).find((x) => x.id === e1.id)
  check('episode reports completed after setPlayed', played.completed === true && played.is_new === false)
  await mobileApi.setPlayed(e1.id, false)
  check('setPlayed(false) marks unplayed', (await mobileApi.getPosition(e1.id)).completed === false)
  await mobileApi.markShowSeen(show.id)
  row = (await mobileApi.listShows()).find((x) => x.id === show.id)
  check('markShowSeen clears new_count', row.new_count === 0)
  await mobileApi.setAutoDownload(show.id, true)
  check('auto_download setting persists', (await store.getShow(show.id)).auto_download === true)
}

// --- 7. OPML import + Home lists ---
{
  const urls = parseOpmlFeedUrls(buildOpmlXml(await store.listShows()))
  check('OPML round trip yields the feed URL', urls.length === 1 && urls[0] === hit.feedUrl)
  const nested = '<opml><body><outline text="g"><outline xmlUrl="https://a.test/f"/><outline xmlUrl="https://a.test/f"/><outline xmlUrl="ftp://x"/></outline></body></opml>'
  check('OPML parse: nested, de-duplicated, http(s) only', parseOpmlFeedUrls(nested).join() === 'https://a.test/f')
  const [a, b] = (await store.listEpisodesForShow(show.id)).slice(-2)
  await store.putEpisodes([{ ...a, is_new: true }])
  await mobileApi.savePosition(b.id, 300, 3000)
  const cont = await mobileApi.listContinue()
  check('listContinue returns in-progress episode with show title', cont.some((e) => e.id === b.id && e.show_title === show.title))
  const nw = await mobileApi.listNew()
  check('listNew returns new episode', nw.some((e) => e.id === a.id))
}

// --- 8. Backup / restore + storage ---
{
  const backup = await mobileApi.buildBackup()
  check('backup lists the show and positions', backup.shows.length === 1 && Object.keys(backup.positions).length > 0)
  const posIds = Object.keys(backup.positions)
  await mobileApi.setAutoDownload(show.id, true)
  const withAuto = await mobileApi.buildBackup()
  check('backup keeps auto_download', withAuto.shows[0].auto_download === true)
  await store.clearAll()
  check('library empty after wipe', (await store.listShows()).length === 0)
  const r = await mobileApi.restoreBackup(JSON.stringify(withAuto))
  check('restore re-subscribes and restores positions', r.shows === 1 && r.positions > 0, JSON.stringify(r))
  check('restored show keeps auto_download', (await store.listShows())[0].auto_download === true)
  check('restored position matches', (await store.getPosition(posIds[0])) !== null)
  let rejected = false
  try { await mobileApi.restoreBackup('{"nope":1}') } catch { rejected = true }
  check('restore rejects a non-backup file', rejected)
  const usage = await mobileApi.storageUsage()
  check('storageUsage runs with no downloads', usage.total === 0 && usage.rows.length === 0)
}

// --- 9. Chapters, show notes, per-show speed ---
{
  const xml = `<?xml version="1.0"?><rss xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" version="2.0"><channel><title>T</title>
    <item><title>With</title><guid>a</guid><enclosure url="https://x.test/a.mp3" type="audio/mpeg"/><podcast:chapters url="https://x.test/a.json" type="application/json+chapters"/></item>
    <item><title>Without</title><guid>b</guid><enclosure url="https://x.test/b.mp3" type="audio/mpeg"/></item></channel></rss>`
  const parsed = parseFeedXml(xml, 'https://x.test/feed')
  const byTitle = Object.fromEntries(parsed.episodes.map((e) => [e.title, e]))
  check('feed parse: chapters_url read from podcast:chapters', byTitle.With.chapters_url === 'https://x.test/a.json')
  check('feed parse: episode without chapters has null', byTitle.Without.chapters_url === null)

  const ch = normalizeChapters({ chapters: [
    { startTime: 90, title: ' Second ' }, { startTime: 0, title: 'Intro', img: 'https://x.test/i.jpg' },
    { startTime: 30, title: 'Hidden', toc: false }, { startTime: 'bad', title: 'Broken' } ] })
  check('normalizeChapters sorts, trims, drops hidden/invalid', ch.length === 2 && ch[0].title === 'Intro' && ch[1].title === 'Second' && ch[0].image === 'https://x.test/i.jpg')
  check('currentChapter picks the chapter at a time', currentChapter(ch, 45).title === 'Intro' && currentChapter(ch, 95).title === 'Second' && currentChapter([], 5) === null)

  const parts = splitTimestamps('Intro 0:45 then 1:02:03 and 99:99 plus 12:34.')
  const stamps = parts.filter((p) => p.seconds !== undefined)
  check('timestamps: found and converted to seconds', stamps.length === 3 && stamps[0].seconds === 45 && stamps[1].seconds === 3723 && stamps[2].seconds === 754)
  check('timestamps: invalid minutes/seconds ignored', !parts.some((p) => p.text === '99:99' && p.seconds !== undefined))

  // cached chapters are returned without any network call
  const eps = await store.listEpisodesForShow((await store.listShows())[0].id)
  await store.putEpisodes([{ ...eps[0], chapters: [{ start: 0, title: 'Cached', image: null }] }])
  check('getChapters returns cached chapters', (await mobileApi.getChapters(eps[0].id))[0].title === 'Cached')
  check('getChapters: episode without a chapters URL gives []', (await mobileApi.getChapters(eps[1].id)).length === 0)

  const sid = (await store.listShows())[0].id
  check('playback speed defaults to 1', (await mobileApi.getPlaybackSpeed(sid)) === 1)
  await mobileApi.setPlaybackSpeed(sid, 1.5)
  check('per-show speed persists', (await mobileApi.getPlaybackSpeed(sid)) === 1.5)
  await mobileApi.setAutoDownload(sid, true)
  check('speed survives other show-setting changes', (await mobileApi.getPlaybackSpeed(sid)) === 1.5 && (await store.getShow(sid)).auto_download === true)
}

// --- 10. Mark all played ---
{
  const sid = (await store.listShows())[0].id
  const eps = await store.listEpisodesForShow(sid)
  await store.putEpisodes([{ ...eps[0], is_new: true }])
  const r = await mobileApi.markShowPlayed(sid)
  const after = await mobileApi.listEpisodes(sid)
  check('markShowPlayed marks every episode completed', after.every((e) => e.completed) && r.changed > 0, `changed=${r.changed}`)
  check('markShowPlayed clears new flags', after.every((e) => !e.is_new))
  const again = await mobileApi.markShowPlayed(sid)
  check('markShowPlayed is idempotent', again.changed === 0)
  await mobileApi.setPlayed(eps[1].id, false)
  check('episodes can be un-played after mark all', (await mobileApi.getPosition(eps[1].id)).completed === false)
}

// --- 11. Queue controls ---
{
  const sid = (await store.listShows())[0].id
  const [a, b, c, d] = (await store.listEpisodesForShow(sid)).slice(0, 4)
  await mobileApi.clearQueue()
  await mobileApi.addToQueue(a.id)
  await mobileApi.addToQueue(b.id)
  await mobileApi.addToQueue(c.id)
  const order = async () => (await store.getQueueOrder())
  await mobileApi.playNext(d.id)
  check('playNext puts the episode first', (await order())[0] === d.id && (await order()).length === 4)
  await mobileApi.playNext(c.id)
  const o2 = await order()
  check('playNext on a queued episode moves it (no duplicate)', o2[0] === c.id && o2.length === 4 && new Set(o2).size === 4)
  await mobileApi.moveInQueue(b.id, 'top')
  check('moveInQueue top', (await order())[0] === b.id)
  await mobileApi.moveInQueue(b.id, 'bottom')
  const o3 = await order()
  check('moveInQueue bottom', o3[o3.length - 1] === b.id && o3.length === 4)
  let rejected = false
  try { await mobileApi.moveInQueue('ep_not_there', 'top') } catch { rejected = true }
  check('moveInQueue rejects an episode that is not queued', rejected)
  await mobileApi.removeFromQueue(c.id)
  check('removeFromQueue leaves the rest in order', (await order()).length === 3 && !(await order()).includes(c.id))
  const cleared = await mobileApi.clearQueue()
  check('clearQueue empties the queue', cleared.cleared === 3 && (await order()).length === 0)
}

// --- 12. Ad chapters, per-show skips ---
{
  const yes = ['Ad', 'Ads', 'Sponsor', 'Sponsored by Squarespace', 'Advertisement', 'Mid-roll ad break', 'Ad read: NordVPN', 'Promo for another show', 'Commercial break']
  const no = ['Intro', 'Introduction', 'Add to cart', "Brad's story", 'Radiolab', 'Adventure time', 'Read the room', 'Padding', 'Main story']
  check('isAdChapter flags ad-like titles', yes.every((t) => isAdChapter(t)), yes.filter((t) => !isAdChapter(t)).join(', '))
  check('isAdChapter ignores look-alikes', no.every((t) => !isAdChapter(t)), no.filter((t) => isAdChapter(t)).join(', '))

  const chapters = [
    { start: 0, title: 'Intro' }, { start: 600, title: 'Ad' }, { start: 660, title: 'Main story' },
    { start: 1800, title: 'Sponsor' }, { start: 1860, title: 'Sponsor read' }, { start: 2000, title: 'Outro' },
  ]
  const r = adRanges(chapters, 2100)
  check('adRanges: ad chapters become skip ranges', r.length === 2 && r[0].startMs === 600000 && r[0].endMs === 660000, JSON.stringify(r))
  check('adRanges: consecutive ad chapters merge', r[1].startMs === 1800000 && r[1].endMs === 2000000)
  const tail = adRanges([{ start: 0, title: 'Show' }, { start: 3000, title: 'Ad' }], 3060)
  check('adRanges: a trailing ad runs to the end of the episode', tail.length === 1 && tail[0].endMs === 3060000)
  check('adRanges: no ads, or unknown duration, gives nothing to skip',
    adRanges([{ start: 0, title: 'Intro' }], 100).length === 0 && adRanges([{ start: 0, title: 'Ad' }], 0).length === 0)

  const sid = (await store.listShows())[0].id
  const none = await mobileApi.getShowSkips(sid)
  check('show skips default to off', none.intro === 0 && none.outro === 0)
  await mobileApi.setShowSkips(sid, { intro: 30, outro: 60 })
  await mobileApi.setPlaybackSpeed(sid, 1.5)
  const got = await mobileApi.getShowSkips(sid)
  check('show skips persist', got.intro === 30 && got.outro === 60)
  check('refresh keeps show skips', (await (async () => { const sh = await store.getShow(sid); await store.putShow({ ...sh, title: sh.title }); return mobileApi.getShowSkips(sid) })()).intro === 30)
  const backup = await mobileApi.buildBackup()
  check('backup includes per-show settings', backup.shows[0].skip_intro === 30 && backup.shows[0].skip_outro === 60 && backup.shows[0].playback_speed === 1.5)
  await store.clearAll()
  await mobileApi.restoreBackup(JSON.stringify(backup))
  const restored = (await store.listShows())[0]
  check('restore brings back speed and skips', restored.skip_intro === 30 && restored.skip_outro === 60 && restored.playback_speed === 1.5)
}

// --- cleanup: delete-show cascade ---
await mobileApi.deleteShow(show.id)
check('deleteShow removes show + episodes', (await store.listShows()).length === 0 && (await store.listEpisodesForShow(show.id)).length === 0)
check('deleteShow clears queue', (await mobileApi.listQueue()).length === 0)

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
