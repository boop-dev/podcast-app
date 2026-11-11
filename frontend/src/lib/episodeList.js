/* Pure helpers for browsing episodes: search ranking across the whole library,
 * and the filter / sort / search view of one show's list. Testable in Node. */

function plain(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').toLowerCase()
}

/** Relevance of an episode for a query, or 0 if it does not match. Every word
 *  must appear in the title or description; title hits count more. */
export function scoreEpisode(episode, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 0
  const title = (episode.title || '').toLowerCase()
  const desc = plain(episode.description)
  let score = 0
  for (const w of words) {
    const inTitle = title.includes(w)
    const inDesc = desc.includes(w)
    if (!inTitle && !inDesc) return 0
    score += inTitle ? 3 : 1
  }
  if (title.includes(words.join(' '))) score += 5 // the whole phrase in the title
  return score
}

/** Best matches first (then newest). */
export function rankEpisodes(episodes, query, limit = 50) {
  const scored = []
  for (const ep of episodes) {
    const s = scoreEpisode(ep, query)
    if (s > 0) scored.push({ ep, s })
  }
  scored.sort((a, b) => b.s - a.s || ((b.ep.pub_date || '') < (a.ep.pub_date || '') ? -1 : 1))
  return scored.slice(0, limit).map((x) => x.ep)
}

export const SORTS = [
  { id: 'new', label: 'Newest first' },
  { id: 'old', label: 'Oldest first' },
  { id: 'long', label: 'Longest first' },
  { id: 'short', label: 'Shortest first' },
]

export const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unplayed', label: 'Unplayed' },
  { id: 'progress', label: 'In progress' },
  { id: 'downloaded', label: 'Downloaded' },
]

/** Filter, search and sort one show's episodes (assumed newest first). */
export function applyListView(episodes, { filter = 'all', sort = 'new', query = '', downloadedIds = new Set() } = {}) {
  const needle = query.trim().toLowerCase()
  let out = episodes.filter((ep) => {
    if (filter === 'unplayed' && ep.completed) return false
    if (filter === 'progress' && !(ep.position_seconds > 10 && !ep.completed)) return false
    if (filter === 'downloaded' && !downloadedIds.has(ep.id)) return false
    if (needle && !((ep.title || '').toLowerCase().includes(needle) || plain(ep.description).includes(needle))) return false
    return true
  })
  if (sort === 'old') out = [...out].reverse()
  else if (sort === 'long') out = [...out].sort((a, b) => (b.duration_seconds ?? -1) - (a.duration_seconds ?? -1))
  else if (sort === 'short') {
    out = [...out].sort((a, b) => (a.duration_seconds ?? Infinity) - (b.duration_seconds ?? Infinity))
  }
  return out
}

/** Text to share for an episode. */
export function shareText(episode, showTitle) {
  const show = showTitle || episode.show_title || ''
  const link = episode.link || episode.audio_url || ''
  return {
    title: episode.title,
    text: `${episode.title}${show ? ` — ${show}` : ''}`,
    url: link,
  }
}
