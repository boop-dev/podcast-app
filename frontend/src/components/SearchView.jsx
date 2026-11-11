/* Search tab: two modes.
 *  - Find shows: the Apple Podcasts directory (or paste an RSS feed URL).
 *  - My episodes: search every episode you already have, by title and notes. */

import { useEffect, useState } from 'react'
import { api } from '../api'
import Icon from './Icon'
import { formatDate, formatDuration } from './EpisodeRow'

// Compare feed URLs loosely: protocol, "www." and a trailing slash do not matter.
const normUrl = (u) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')

export default function SearchView({ onSubscribed, onPlay, onToggleQueue, onPlayNext, queueIds }) {
  const [mode, setMode] = useState('shows') // 'shows' | 'episodes'
  return (
    <div>
      <div className="segmented" role="tablist">
        <button className={mode === 'shows' ? 'on' : ''} onClick={() => setMode('shows')} role="tab">
          Find shows
        </button>
        <button className={mode === 'episodes' ? 'on' : ''} onClick={() => setMode('episodes')} role="tab">
          My episodes
        </button>
      </div>
      {mode === 'shows' ? (
        <FindShows onSubscribed={onSubscribed} />
      ) : (
        <MyEpisodes onPlay={onPlay} onToggleQueue={onToggleQueue} onPlayNext={onPlayNext} queueIds={queueIds} />
      )}
    </div>
  )
}

function FindShows({ onSubscribed }) {
  const [query, setQuery] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [subscribed, setSubscribed] = useState(new Set())

  useEffect(() => {
    api.listShows().then((shows) => setSubscribed(new Set(shows.map((s) => normUrl(s.feed_url))))).catch(() => {})
  }, [])

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

  async function subscribe(url) {
    setLoading(true)
    setError('')
    setDone('')
    try {
      const show = await api.subscribe(url)
      setSubscribed((prev) => new Set(prev).add(normUrl(url)))
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

      {results.map((r) => {
        const isSub = subscribed.has(normUrl(r.feedUrl))
        const details = [
          r.genre,
          r.trackCount ? `${r.trackCount} episodes` : null,
          r.lastRelease ? `latest ${formatDate(r.lastRelease)}` : null,
        ].filter(Boolean)
        return (
          <div key={r.feedUrl} className="card list-row">
            {r.artworkUrl ? <img className="thumb" src={r.artworkUrl} alt="" /> : <span className="art-empty thumb" />}
            <span className="row-text" style={{ flex: 1 }}>
              <span className="row-title">{r.collectionName}</span>
              <span className="muted">{r.artistName}</span>
              {details.length > 0 && <span className="muted">{details.join(' · ')}</span>}
            </span>
            {isSub ? (
              <span className="pill on" aria-label="Already subscribed">
                <Icon name="check" size={16} /> Subscribed
              </span>
            ) : (
              <button className="pill primary" onClick={() => subscribe(r.feedUrl)} disabled={loading}>
                Subscribe
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function MyEpisodes({ onPlay, onToggleQueue, onPlayNext, queueIds }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // null = nothing searched yet

  // Search as you type, after a short pause.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null)
      return undefined
    }
    let cancelled = false
    const id = setTimeout(() => {
      api
        .searchEpisodes(query)
        .then((r) => !cancelled && setResults(r))
        .catch(() => !cancelled && setResults([]))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [query])

  return (
    <div>
      <input
        type="search"
        className="episode-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your episodes by title or notes…"
        aria-label="Search your episodes"
        autoFocus
      />
      {results === null && (
        <p className="muted">Searches every episode of every show you are subscribed to.</p>
      )}
      {results && results.length === 0 && <div className="empty">No episodes match “{query.trim()}”.</div>}
      {results && results.length > 0 && <p className="muted">{results.length >= 50 ? 'Top 50 matches' : `${results.length} match${results.length === 1 ? '' : 'es'}`}</p>}
      {results &&
        results.map((ep) => {
          const queued = queueIds.has(ep.id)
          return (
            <div key={ep.id} className="card list-row">
              <button className="row-main" onClick={() => onPlay(ep, ep.show_title)}>
                {ep.show_image ? <img src={ep.show_image} alt="" /> : <span className="art-empty thumb" />}
                <span className="row-text">
                  <span className="row-title">{ep.title}</span>
                  <span className="muted">
                    {[ep.show_title, formatDate(ep.pub_date), ep.duration_seconds ? formatDuration(ep.duration_seconds) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </button>
              <button
                className="icon-btn"
                onClick={() => onPlayNext(ep)}
                aria-label="Play next"
                title="Play next"
              >
                <Icon name="playNext" size={20} />
              </button>
              <button
                className={`icon-btn${queued ? ' on' : ''}`}
                onClick={() => onToggleQueue(ep)}
                aria-label={queued ? 'Remove from queue' : 'Add to queue'}
                title={queued ? 'Remove from queue' : 'Add to queue'}
              >
                <Icon name={queued ? 'minus' : 'plus'} size={20} />
              </button>
            </div>
          )
        })}
    </div>
  )
}
