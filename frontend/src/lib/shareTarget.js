/* Turn text shared to the app (or a feed:// / Apple Podcasts link) into something
 * we can subscribe to. Pure parsing lives here so it can be tested in Node. */

/** The first URL in a piece of shared text, or null. */
export function extractUrl(text) {
  const m = String(text || '').match(/(?:https?|feed|pcast|itpc):\/\/[^\s<>"']+/i)
  return m ? m[0].replace(/[).,;]+$/, '') : null
}

/**
 * Classify shared text:
 *   {kind: 'apple', id}   an Apple Podcasts page (feed URL comes from the iTunes lookup)
 *   {kind: 'feed', url}   anything that should be an RSS feed
 *   {kind: 'unsupported', host}  a link to a service that does not expose feeds (Spotify...)
 *   null                  no URL at all
 */
export function parseSharedLink(text) {
  const raw = extractUrl(text)
  if (!raw) return null
  const url = raw.replace(/^(feed|pcast|itpc):\/\//i, 'https://')
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\./, '')
  if (host === 'podcasts.apple.com' || host === 'itunes.apple.com') {
    const m = u.pathname.match(/\/id(\d+)/) || u.search.match(/[?&]id=(\d+)/)
    return m ? { kind: 'apple', id: m[1] } : { kind: 'unsupported', host }
  }
  if (/(^|\.)(spotify\.com|youtube\.com|youtu\.be|music\.youtube\.com|pca\.st|overcast\.fm)$/.test(host)) {
    return { kind: 'unsupported', host }
  }
  // feed:// and friends were upgraded to https; a plain http:// feed keeps its scheme.
  return { kind: 'feed', url: /^http:\/\//i.test(raw) ? raw : url }
}
