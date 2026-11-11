/* Finding ad breaks from chapter titles (feeds that mark them, e.g. "Ad",
 * "Sponsor", "Sponsored by X"). Pure functions, testable in Node. */

const AD_TITLE = /\b(ads?|adverts?|advertisements?|sponsors?|sponsored|sponsorships?|promos?|commercials?|ad[ -]breaks?|ad[ -]reads?)\b/i

export function isAdChapter(title) {
  return AD_TITLE.test(title || '')
}

/** Ranges to skip, in ms: [{startMs, endMs}]. A chapter lasts until the next one
 *  starts (the last one until the end of the episode). Adjacent ad chapters merge.
 *  Needs the episode duration (seconds) to bound a trailing ad chapter. */
export function adRanges(chapters, durationSec) {
  const out = []
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i]
    if (!isAdChapter(c.title)) continue
    const end = i + 1 < chapters.length ? chapters[i + 1].start : durationSec
    if (!(end > c.start)) continue
    const last = out[out.length - 1]
    if (last && c.start * 1000 <= last.endMs + 500) last.endMs = Math.round(end * 1000)
    else out.push({ startMs: Math.round(c.start * 1000), endMs: Math.round(end * 1000) })
  }
  return out
}
