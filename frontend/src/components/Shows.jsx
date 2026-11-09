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
  const [hidePlayed, setHidePlayed] = useState(false)

  // On native there is no backend /api/opml: build the file on-device
  // instead and tell the user where it landed.
  async function importOpml(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setOpmlMsg('Importing…')
    try {
      const res = await api.importOpml(await file.text())
      setOpmlMsg(
        `Imported ${res.added} new of ${res.total} feeds` +
          (res.failed.length ? `; ${res.failed.length} failed` : ''),
      )
      onRefresh()
    } catch (err) {
      setOpmlMsg(`Import failed: ${err.message}`)
    }
  }

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

  function reloadEpisodes() {
    if (selected) api.listEpisodes(selected.id).then(setEpisodes).catch(() => {})
    onRefresh()
  }

  // Leaving a show counts as having seen its new episodes.
  async function leaveShow() {
    if (selected) await api.markShowSeen(selected.id).catch(() => {})
    setSelected(null)
    onRefresh()
  }

  async function toggleAutoDownload() {
    const enabled = !selected.auto_download
    await api.setAutoDownload(selected.id, enabled)
    setSelected({ ...selected, auto_download: enabled })
    onRefresh()
  }

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
        <button onClick={leaveShow}>← All shows</button>
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
        </button>{' '}
        <button onClick={() => setHidePlayed(!hidePlayed)}>
          {hidePlayed ? 'Show played' : 'Hide played'}
        </button>
        {isNative() && (
          <label className="muted" style={{ display: 'block', marginTop: 8 }}>
            <input type="checkbox" checked={Boolean(selected.auto_download)} onChange={toggleAutoDownload} />{' '}
            Auto-download new episodes (Wi-Fi) and delete after playing
          </label>
        )}
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
        {loading && <p className="muted">Loading episodes…</p>}
        {episodes.filter((ep) => !(hidePlayed && ep.completed)).map((ep) => (
          <EpisodeRow
            key={ep.id}
            episode={ep}
            onPlay={onPlay}
            inQueue={queueIds.has(ep.id)}
            onToggleQueue={onToggleQueue}
            downloaded={downloadedIds.has(ep.id)}
            onDownloadChanged={onDownloadChanged}
            onPlayedChanged={reloadEpisodes}
          />
        ))}
      </div>
    )
  }

  if (shows.length === 0) {
    return (
      <div className="empty">
        No subscriptions yet. Go to the Search tab and add your first show.
        {isNative() && (
          <p className="muted">
            Or import an OPML file: <input type="file" accept=".opml,.xml,text/xml" onChange={importOpml} />
          </p>
        )}
        {opmlMsg && <p className="muted">{opmlMsg}</p>}
      </div>
    )
  }

  return (
    <div>
      {shows.map((show) => (
        <div key={show.id} className="card show-row" onClick={() => setSelected(show)}>
          {show.image_url && <img src={show.image_url} alt="" />}
          <div>
            <h3>
              {show.title}
              {show.new_count > 0 && <span className="new-tag">{show.new_count} new</span>}
            </h3>
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
      {isNative() && (
        <p className="muted">
          Import subscriptions from OPML: <input type="file" accept=".opml,.xml,text/xml" onChange={importOpml} />
        </p>
      )}
      {opmlMsg && <p className="muted">{opmlMsg}</p>}
    </div>
  )
}
