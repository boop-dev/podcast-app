/* Subscriptions tab: the list of shows, and the episode list for one show. */

import { useEffect, useState } from 'react'
import { api, exportOpmlToFile, isNative } from '../api'
import EpisodeRow from './EpisodeRow'

export default function Shows({ shows, onPlay, queueIds, onToggleQueue, downloadedIds, onDownloadChanged, onRefresh }) {
  const [selected, setSelected] = useState(null) // a show row
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [opmlMsg, setOpmlMsg] = useState('')

  // On native there is no backend /api/opml: build the file on-device
  // instead and tell the user where it landed.
  async function exportOpml(e) {
    if (!isNative()) return // web: let the plain /api/opml link work
    e.preventDefault()
    setOpmlMsg('')
    try {
      const uri = await exportOpmlToFile()
      setOpmlMsg(`Subscriptions saved to ${uri}`)
    } catch (err) {
      setOpmlMsg(`Export failed: ${err.message}`)
    }
  }

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    setError('')
    api
      .listEpisodes(selected.id)
      .then(setEpisodes)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [selected])

  async function refresh() {
    if (!selected) return
    setLoading(true)
    try {
      const res = await api.refreshShow(selected.id)
      const eps = await api.listEpisodes(selected.id)
      setEpisodes(eps)
      onRefresh()
      if (res.new_episodes === 0) setError('No new episodes.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (selected) {
    return (
      <div>
        <button onClick={() => setSelected(null)}>← All shows</button>
        <div className="show-detail" style={{ marginTop: 12 }}>
          {selected.image_url && <img src={selected.image_url} alt="" />}
          <div>
            <h2>{selected.title}</h2>
            <p className="muted">{selected.author}</p>
            <p className="muted">{episodes.length} episodes</p>
          </div>
        </div>
        <button onClick={refresh} disabled={loading}>
          Check for new episodes
        </button>
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
        {loading && <p className="muted">Loading episodes…</p>}
        {episodes.map((ep) => (
          <EpisodeRow
            key={ep.id}
            episode={ep}
            onPlay={onPlay}
            inQueue={queueIds.has(ep.id)}
            onToggleQueue={onToggleQueue}
            downloaded={downloadedIds.has(ep.id)}
            onDownloadChanged={onDownloadChanged}
          />
        ))}
      </div>
    )
  }

  if (shows.length === 0) {
    return (
      <div className="empty">
        No subscriptions yet. Go to the Search tab and add your first show.
      </div>
    )
  }

  return (
    <div>
      {shows.map((show) => (
        <div key={show.id} className="card show-row" onClick={() => setSelected(show)}>
          {show.image_url && <img src={show.image_url} alt="" />}
          <div>
            <h3>{show.title}</h3>
            <p>
              {show.author}
              {show.episode_count ? ` · ${show.episode_count} episodes` : ''}
            </p>
          </div>
        </div>
      ))}
      <p className="muted">
        <a href="/api/opml" download onClick={exportOpml}>Export subscriptions as OPML</a> to move them to
        another app.
      </p>
      {opmlMsg && <p className="muted">{opmlMsg}</p>}
    </div>
  )
}
