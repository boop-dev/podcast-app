/* Subscriptions tab: the list of shows, and the episode list for one show. */

import { useEffect, useState } from 'react'
import { api, exportOpmlToFile } from '../api'
import EpisodeRow from './EpisodeRow'
import Icon from './Icon'
import { useBackHandler } from '../lib/back'

export default function Shows({ shows, onPlay, queueIds, onToggleQueue, onPlayNext, downloadedIds, onDownloadChanged, onRefresh }) {
  const [selected, setSelected] = useState(null) // a show row
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [opmlMsg, setOpmlMsg] = useState('')
  const [hidePlayed, setHidePlayed] = useState(false)
  const [query, setQuery] = useState('')
  const [oldestFirst, setOldestFirst] = useState(false)

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

  async function exportOpml() {
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

  useBackHandler(Boolean(selected), () => leaveShow())

  // Leaving a show counts as having seen its new episodes.
  async function leaveShow() {
    if (selected) await api.markShowSeen(selected.id).catch(() => {})
    setSelected(null)
    onRefresh()
  }

  async function markAllPlayed() {
    if (!window.confirm(`Mark every episode of ${selected.title} as played?`)) return
    setLoading(true)
    try {
      const res = await api.markShowPlayed(selected.id)
      setEpisodes(await api.listEpisodes(selected.id))
      onRefresh()
      setError(res.changed ? `Marked ${res.changed} episodes as played.` : 'Everything was already played.')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function unsubscribe() {
    const ok = window.confirm(
      `Unsubscribe from ${selected.title}?\n\nIts episodes, listening progress and downloads on this device will be removed.`,
    )
    if (!ok) return
    try {
      await api.deleteShow(selected.id)
      setSelected(null)
      setEpisodes([])
      onRefresh()
      onDownloadChanged()
    } catch (err) {
      setError(err.message)
    }
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

  const needle = query.trim().toLowerCase()
  const visibleEpisodes = episodes
    .filter((ep) => !(hidePlayed && ep.completed))
    .filter(
      (ep) =>
        !needle ||
        (ep.title || '').toLowerCase().includes(needle) ||
        (ep.description || '').toLowerCase().includes(needle),
    )
  if (oldestFirst) visibleEpisodes.reverse()

  if (selected) {
    return (
      <div>
        <button className="back-link" onClick={leaveShow}>
          <Icon name="chevronLeft" size={18} /> All shows
        </button>
        <div className="show-detail">
          {selected.image_url && <img src={selected.image_url} alt="" />}
          <div>
            <h2>{selected.title}</h2>
            <p className="muted">{selected.author}</p>
            <p className="muted">{episodes.length} episodes</p>
          </div>
        </div>
        <input
          type="search"
          className="episode-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search episodes…"
          aria-label="Search episodes"
        />
        <div className="toolbar">
          <button className="pill" onClick={refresh} disabled={loading}>
            Refresh
          </button>
          <button className="pill" onClick={() => setOldestFirst(!oldestFirst)}>
            {oldestFirst ? 'Oldest first' : 'Newest first'}
          </button>
          <button className={`pill${hidePlayed ? ' on' : ''}`} onClick={() => setHidePlayed(!hidePlayed)}>
            {hidePlayed ? 'Showing unplayed' : 'Hide played'}
          </button>
        </div>
                <label className="setting-row">
          <span>
            Auto-download new episodes
            <small>On Wi-Fi only. Deleted after you finish them.</small>
          </span>
          <input type="checkbox" checked={Boolean(selected.auto_download)} onChange={toggleAutoDownload} />
        </label>
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button className="pill" onClick={markAllPlayed} disabled={loading}>
            Mark all played
          </button>
          <button className="pill danger" onClick={unsubscribe}>
            Unsubscribe
          </button>
        </div>
        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
        {loading && <p className="muted">Loading episodes…</p>}
        {!loading && needle && visibleEpisodes.length === 0 && (
          <p className="muted">No episodes match “{query.trim()}”.</p>
        )}
        {visibleEpisodes.map((ep) => (
          <EpisodeRow
            key={ep.id}
            episode={ep}
            onPlay={onPlay}
            inQueue={queueIds.has(ep.id)}
            onToggleQueue={onToggleQueue}
            onPlayNext={onPlayNext}
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
                <p className="muted">
          Or import an OPML file: <input type="file" accept=".opml,.xml,text/xml" onChange={importOpml} />
        </p>
        {opmlMsg && <p className="muted">{opmlMsg}</p>}
      </div>
    )
  }

  return (
    <div>
      <div className="show-grid">
        {shows.map((show) => (
          <button key={show.id} className="show-tile" onClick={() => setSelected(show)}>
            <span className="tile-art">
              {show.image_url ? <img src={show.image_url} alt="" /> : <span className="art-empty" />}
              {show.new_count > 0 && <b className="badge">{show.new_count}</b>}
            </span>
            <span className="tile-title">{show.title}</span>
          </button>
        ))}
      </div>
      <div className="card footnote">
        <p className="muted">
          <button className="link" onClick={exportOpml}>Export subscriptions (OPML)</button> to move them to
          another app.
        </p>
                <p className="muted">
          Import OPML: <input type="file" accept=".opml,.xml,text/xml" onChange={importOpml} />
        </p>
      </div>
      {opmlMsg && <p className="muted">{opmlMsg}</p>}
    </div>
  )
}
