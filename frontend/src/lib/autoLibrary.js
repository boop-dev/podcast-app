/* Android Auto (and other media browsers): the JS half.
 *
 * The shows and episodes live in IndexedDB, which the native media service cannot read, so the app
 * stages a snapshot of what a car screen needs (see LibrarySnapshot.java) whenever it is used. The
 * car then browses Continue listening / Up next / Shows from that file, and playback happens in the
 * native service as usual. The snapshot reflects the last time the app was open. */

import { api } from '../api'
import * as store from '../mobile/store'
import { NativeAudio, toItem } from './nativeAudio'

const EPISODES_PER_SHOW = 25
const QUEUE_MAX = 30
const CONTINUE_MAX = 10

/** An episode in the shape the native service plays (see toItem) plus what a browse list shows. */
async function row(ep) {
  const item = await toItem(ep, ep.show_title)
  return {
    ...item,
    showId: ep.show_id,
    pubDate: ep.pub_date || '',
    durationMs: Math.round((ep.duration_seconds || 0) * 1000),
    positionMs: Math.round((ep.position_seconds || 0) * 1000),
    played: Boolean(ep.completed),
  }
}

export async function buildLibrary() {
  const shows = (await api.listShows()).sort((a, b) => a.title.localeCompare(b.title))
  const episodes = {}
  for (const show of shows) {
    // Newest first. Only the first few are read with their played / position state: a show can have thousands.
    const recent = (await store.listEpisodesForShow(show.id)).slice(0, EPISODES_PER_SHOW)
    const withState = (await Promise.all(recent.map((e) => api.getEpisode(e.id)))).filter(Boolean)
    episodes[show.id] = await Promise.all(withState.map((e) => row({ ...e, show_title: show.title })))
  }
  const queue = await Promise.all((await api.listQueue()).slice(0, QUEUE_MAX).map(row))
  const resume = await Promise.all((await api.listContinue(CONTINUE_MAX)).map(row))
  return {
    stagedAt: Date.now(),
    shows: shows.map((s) => ({ id: s.id, title: s.title, author: s.author || '', image: s.image_url || '' })),
    episodes,
    queue,
    continue: resume,
  }
}

export async function stageLibraryNow() {
  await NativeAudio.stageLibrary({ json: JSON.stringify(await buildLibrary()) })
}

let timer = null
/** Debounced, like the backup staging: no point rebuilding several times in a row. */
export function stageLibrarySoon(delayMs = 5000) {
  clearTimeout(timer)
  timer = setTimeout(() => stageLibraryNow().catch(() => {}), delayMs)
}
