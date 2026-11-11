/* On-device RSS fetching and parsing for the Capacitor build.
 *
 * Fetching goes through CapacitorHttp (from @capacitor/core), which runs
 * on the native side and is not bound by the WebView's CORS policy, so
 * podcast feeds can be fetched directly with no proxy server.
 * Parsing is done on-device with fast-xml-parser. The output shapes
 * deliberately mirror backend/app.py's parse_feed():
 *   show    {id, feed_url, title, author, description, image_url}
 *   episode {id, show_id, guid, title, description, audio_url,
 *            duration_seconds, pub_date, image_url,
 *            position_seconds, completed, in_queue, downloaded}
 * so the existing UI components need no changes to consume them.
 */

import { CapacitorHttp } from '@capacitor/core'
import { XMLParser } from 'fast-xml-parser'
import { episodeIdFor, showIdFor } from './store.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // <itunes:duration> etc. keep their colon names; that is what we read.
  trimValues: true,
})

/** Fetch a URL as text through the native HTTP stack (no CORS). */
export async function httpGetText(url) {
  const res = await CapacitorHttp.get({ url, headers: { 'User-Agent': 'podcast-app/1.0' } })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Request failed: ${res.status} fetching ${url}`)
  }
  return res.data
}

/** Fetch a URL as JSON through the native HTTP stack (no CORS). */
export async function httpGetJson(url, params = {}) {
  const res = await CapacitorHttp.get({ url, params })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Request failed: ${res.status} fetching ${url}`)
  }
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data
}

// fast-xml-parser decodes named entities (&amp;) but leaves numeric
// character references (&#038; &#x27;) untouched, and feeds use them
// in titles. Decode those so the UI shows the real characters.
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
}

// A parsed XML node can be a string, a number, or an object whose text
// lives under '#text' (attributes / CDATA). Normalise to a plain string.
export function textOf(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return decodeEntities(String(value))
  if (typeof value === 'object') {
    if ('#text' in value) return decodeEntities(String(value['#text']))
    if ('__text' in value) return decodeEntities(String(value.__text))
  }
  return null
}

function first(value) {
  return Array.isArray(value) ? value[0] : value
}

/** 'itunes:duration' comes as seconds, 'MM:SS', or 'HH:MM:SS'. */
export function parseDuration(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Math.floor(value)
  const text = String(value).trim()
  if (/^\d+$/.test(text)) return parseInt(text, 10)
  const parts = text.split(':').map((p) => parseInt(p, 10))
  if (parts.some((p) => Number.isNaN(p))) return null
  let seconds = 0
  for (const part of parts) seconds = seconds * 60 + part
  return seconds
}

function parsePubDate(value) {
  const text = textOf(value)
  if (!text) return null
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function findAudioUrl(item) {
  const enclosures = item.enclosure ? (Array.isArray(item.enclosure) ? item.enclosure : [item.enclosure]) : []
  for (const enc of enclosures) {
    const type = enc['@_type'] || ''
    const href = enc['@_url'] || ''
    if (type.startsWith('audio') && href) return href
  }
  // Fallback: a link that is itself an audio file (mirrors the backend).
  const link = textOf(item.link)
  if (link && /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(link)) return link
  // Atom-style links: <link rel="enclosure" type="audio/..." href="..."/>
  const links = item.link ? (Array.isArray(item.link) ? item.link : [item.link]) : []
  for (const l of links) {
    if (typeof l === 'object' && (l['@_type'] || '').startsWith('audio') && l['@_href']) {
      return l['@_href']
    }
  }
  return null
}

/** Podcasting 2.0 chapters: <podcast:chapters url="..." type="application/json+chapters"/> */
function itemChaptersUrl(item) {
  const node = item['podcast:chapters']
  const first = Array.isArray(node) ? node[0] : node
  const url = first && typeof first === 'object' ? first['@_url'] : null
  return url && /^https?:\/\//i.test(url) ? String(url) : null
}

/** Normalise a chapters JSON document ({chapters:[{startTime,title,img}]}) to
 *  [{start, title, image}] sorted by start. Skips hidden (toc:false) entries. */
export function normalizeChapters(data) {
  const list = data && Array.isArray(data.chapters) ? data.chapters : []
  return list
    .filter((c) => c && c.toc !== false && Number.isFinite(Number(c.startTime)))
    .map((c) => ({
      start: Number(c.startTime),
      title: String(c.title || '').trim(),
      image: c.img ? String(c.img) : null,
    }))
    .sort((a, b) => a.start - b.start)
}

/** The episode's web page, if the feed gives one (not an audio file). */
function itemLink(item) {
  const raw = item.link
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  for (const l of list) {
    const url = typeof l === 'object' ? (l['@_rel'] === 'enclosure' ? null : l['@_href'] || textOf(l)) : textOf(l)
    if (url && /^https?:\/\//i.test(url) && !/\.(mp3|m4a|ogg|wav|aac|flac)(\?|$)/i.test(url)) return String(url)
  }
  return null
}

function itemImage(item) {
  const img = item['itunes:image']
  if (img && img['@_href']) return img['@_href']
  return null
}

function parseRssItems(channel, showId) {
  const items = channel.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : []
  const episodes = []
  for (const item of items) {
    const audioUrl = findAudioUrl(item)
    if (!audioUrl) continue // skip entries with no playable audio
    const guid = textOf(item.guid) || textOf(item.link) || audioUrl
    episodes.push({
      id: episodeIdFor(showId, guid),
      show_id: showId,
      guid,
      title: textOf(item.title) || 'Untitled episode',
      description: textOf(item.description) || textOf(item['itunes:summary']) || null,
      audio_url: audioUrl,
      duration_seconds: parseDuration(textOf(item['itunes:duration'])),
      pub_date: parsePubDate(item.pubDate),
      image_url: itemImage(item),
      chapters_url: itemChaptersUrl(item),
      link: itemLink(item),
    })
  }
  return episodes
}

function parseAtomEntries(feed, showId) {
  const entries = feed.entry ? (Array.isArray(feed.entry) ? feed.entry : [feed.entry]) : []
  const episodes = []
  for (const entry of entries) {
    const audioUrl = findAudioUrl(entry)
    if (!audioUrl) continue
    const guid = textOf(entry.id) || textOf(entry.link) || audioUrl
    episodes.push({
      id: episodeIdFor(showId, guid),
      show_id: showId,
      guid,
      title: textOf(entry.title) || 'Untitled episode',
      description: textOf(entry.summary) || textOf(entry.content) || null,
      audio_url: audioUrl,
      duration_seconds: parseDuration(textOf(entry['itunes:duration'])),
      pub_date: parsePubDate(entry.published || entry.updated),
      image_url: itemImage(entry),
      chapters_url: itemChaptersUrl(entry),
      link: itemLink(entry),
    })
  }
  return episodes
}

/** Parse raw feed XML into {show, episodes} in the backend's shapes.
 *  Pure (no network): this is what the Node verify script exercises
 *  against a real feed fetched through the Apple Search flow. */
export function parseFeedXml(xml, feedUrl) {
  let doc
  try {
    doc = parser.parse(xml)
  } catch (err) {
    throw new Error(`Could not parse feed: ${feedUrl} (${err.message})`)
  }
  const showId = showIdFor(feedUrl)

  if (doc.rss && doc.rss.channel) {
    const channel = doc.rss.channel
    const image = first(channel.image)
    const show = {
      id: showId,
      feed_url: feedUrl,
      title: textOf(channel.title) || feedUrl,
      author: textOf(channel['itunes:author']) || textOf(channel.author) || null,
      description: textOf(channel.description) || textOf(channel['itunes:summary']) || null,
      image_url:
        (channel['itunes:image'] && channel['itunes:image']['@_href']) ||
        (image && textOf(image.url)) ||
        null,
    }
    return { show, episodes: parseRssItems(channel, showId) }
  }

  if (doc.feed) {
    const feed = doc.feed
    const show = {
      id: showId,
      feed_url: feedUrl,
      title: textOf(feed.title) || feedUrl,
      author: textOf(feed.author && feed.author.name) || null,
      description: textOf(feed.subtitle) || null,
      image_url: (feed['itunes:image'] && feed['itunes:image']['@_href']) || null,
    }
    return { show, episodes: parseAtomEntries(feed, showId) }
  }

  throw new Error(`Could not parse feed: ${feedUrl} (not RSS or Atom)`)
}

/** Fetch a feed over CapacitorHttp and parse it. */
export async function fetchFeed(feedUrl) {
  const xml = await httpGetText(feedUrl)
  return parseFeedXml(xml, feedUrl)
}
