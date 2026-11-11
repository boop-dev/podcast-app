/* Search tab: find shows through the Apple Podcasts Search API, or
 * subscribe directly by pasting an RSS feed URL. */

import { useState } from 'react'
import { api } from '../api'

export default function SearchView({ onSubscribed }) {
  const [query, setQuery] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function runSearch(e) {
    e.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setDone('')
    try {
      const data = await api.search(query.trim())
      setResults(data.results)
      if (data.results.length === 0) setError('No shows found for that search.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function subscribe(url, name) {
    setLoading(true)
    setError('')
    setDone('')
    try {
      const show = await api.subscribe(url)
      setDone(`Subscribed to ${show.title}.`)
      onSubscribed(show)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <form className="search-box" onSubmit={runSearch}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search podcasts…"
        />
        <button className="pill primary" type="submit" disabled={loading}>
          Search
        </button>
      </form>

      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault()
          if (feedUrl.trim()) subscribe(feedUrl.trim())
        }}
      >
        <input
          type="url"
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          placeholder="…or paste an RSS feed URL"
        />
        <button className="pill" type="submit" disabled={loading}>
          Add feed
        </button>
      </form>

      {error && <div className="error">{error}</div>}
      {done && <div className="card">{done}</div>}
      {loading && <p className="muted">Working…</p>}

      {results.map((r) => (
        <div key={r.feedUrl} className="card list-row">
          {r.artworkUrl ? <img className="thumb" src={r.artworkUrl} alt="" /> : <span className="art-empty thumb" />}
          <span className="row-text" style={{ flex: 1 }}>
            <span className="row-title">{r.collectionName}</span>
            <span className="muted">{r.artistName}</span>
          </span>
          <button className="pill primary" onClick={() => subscribe(r.feedUrl)} disabled={loading}>
            Subscribe
          </button>
        </div>
      ))}
    </div>
  )
}
