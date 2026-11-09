/* OPML export, built on-device from the stored shows.
 * Mirrors the backend's GET /api/opml output (opml 1.0, one <outline>
 * per show with type=rss, text/title and xmlUrl). */

import { XMLParser } from 'fast-xml-parser'

/** Feed URLs from an OPML document (any nesting depth, de-duplicated). */
export function parseOpmlFeedUrls(xml) {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml)
  const urls = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const url = node['@_xmlUrl'] || node['@_xmlurl']
    if (url) urls.push(String(url).trim())
    walk(node.outline)
    walk(node.body)
  }
  walk(doc.opml)
  return [...new Set(urls)].filter((u) => /^https?:\/\//i.test(u))
}

export function buildOpmlXml(shows) {
  const escape = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  const outlines = [...shows]
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .map(
      (show) =>
        `    <outline type="rss" text="${escape(show.title)}" title="${escape(show.title)}" xmlUrl="${escape(show.feed_url)}" />`,
    )
    .join('\n')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<opml version="1.0">\n` +
    `  <head>\n` +
    `    <title>Podcast App subscriptions</title>\n` +
    `  </head>\n` +
    `  <body>\n` +
    (outlines ? outlines + '\n' : '') +
    `  </body>\n` +
    `</opml>\n`
  )
}
