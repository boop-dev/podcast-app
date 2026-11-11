/* Pure helpers for chapters and show notes (no React, testable in Node). */

/** The chapter playing at time t (seconds), or null. */
export function currentChapter(chapters, t) {
  let found = null
  for (const c of chapters) {
    if (c.start <= t + 0.25) found = c
    else break
  }
  return found
}

const TIMESTAMP = /\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/g

/** "1:02:03" / "12:34" -> seconds. */
export function timestampToSeconds(h, m, s) {
  return (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s)
}

/** Split text into plain strings and tappable timestamps. */
export function splitTimestamps(text) {
  const parts = []
  let last = 0
  for (const match of text.matchAll(TIMESTAMP)) {
    const seconds = timestampToSeconds(match[1], match[2], match[3])
    if (Number(match[3]) > 59 || (match[1] && Number(match[2]) > 59)) continue // not a real time
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    parts.push({ text: match[0], seconds })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

