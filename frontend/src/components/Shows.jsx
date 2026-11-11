/* Subscriptions tab: the list of shows, and the episode list for one show. */

import { useEffect, useState } from 'react'
import { api, exportOpmlToFile } from '../api'
import EpisodeRow from './EpisodeRow'
import Icon from './Icon'
import { useBackHandler } from '../lib/back'
import { enqueueMany } from '../lib/downloadManager'
import { FILTERS, SORTS, applyListView, isInProgress, isUnplayed } from '../lib/episodeList'
import Picker from './Picker'

export default function Shows({ shows, onPlay, queueIds, onToggleQueue, onPlayNext, downloadedIds, onDownloadChanged, onRefresh }) {
  const [selected, setSelected] = useState(null) // a show row
  const [episodes, setEpisodes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [opmlMsg, setOpmlMsg] = useState('')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('new')
  const [skips, setSkips] = useState({ intro: 0, outro: 0 })
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [notice, setNotice] = useState('') // short, neutral feedback that clears by itself

  useEffect(() => {
    if (!notice) return undefined
    const id = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(id)
  }, [notice])

  useEffect(() => {
    if (selected) {
      api.getShowSkips(selected.id).then(setSkips).catch(() => {})
      api.getPlaybackSpeed(selected.id).then(setSpeed).catch(() => {})
    }
  }, [selected])

  function changeSpeed(value) {
    const v = Number(value)
    setSpeed(v)
    api.setPlaybackSpeed(selected.id, v).catch(() => {})
  }

  async function toggleAlerts() {
    const enabled = Boolean(selected.mute_alerts) // currently muted -> turn on
    await api.setShowAlerts(selected.id, enabled)
    setSelected({ ...selected, mute_alerts: !enabled })
    onRefresh()
  }

  function changeSkip(which, value) {
    const next = { ...skips, [which]: Number(value) }
    setSkips(next)
    api.setShowSkips(selected.id, next).catch(() => {})
  }

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

  // Download the newest unplayed, not-yet-downloaded episodes of this show.
  async function downloadUnplayed(limit) {
    const todo = episodes.filter((ep) => !ep.completed && !downloadedIds.has(ep.id))
    const picked = limit ? todo.slice(0, limit) : todo
    if (picked.length === 0) return setNotice('Nothing to download: every unplayed episode is already saved.')
    if (picked.length > 10 && !window.confirm(`Download ${picked.length} episodes? This can use a lot of storage.`)) return
    const added = await enqueueMany(picked)
    setNotice(`Queued ${added} episode${added === 1 ? '' : 's'}. Progress shows on each episode and in Settings.`)
  }

  async function markAllPlayed() {
    if (!window.confirm(`Mark every episode of ${selected.title} as played?`)) return
    setLoading(true)
    try {
      const res = await api.markShowPlayed(selected.id)
      setEpisodes(await api.listEpisodes(selected.id))
      onRefresh()
      setError('')
      setNotice(res.changed ? `Marked ${res.changed} episodes as played.` : 'Everything was already played.')
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
    setError('')
    setNotice('')
    try {
      const res = await api.refreshShow(selected.id)
      const eps = await api.listEpisodes(selected.id)
      setEpisodes(eps)
      onRefresh()
      setNotice(res.new_episodes === 0 ? 'No new episodes.' : `${res.new_episodes} new episode${res.new_episodes === 1 ? '' : 's'}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const needle = query.trim().toLowerCase()
  const visibleEpisodes = applyListView(episodes, { filter, sort, query, downloadedIds })
  const counts = {
    all: episodes.length,
    unplayed: episodes.filter(isUnplayed).length,
    progress: episodes.filter(isInProgress).length,
    downloaded: episodes.filter((e) => downloadedIds.has(e.id)).length,
  }

  if (selected) {
    const unplayedCount = counts.unplayed
    // A fine-tuned speed set from the player (e.g. 1.35) must still show as the current value.
    const speedOptions = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5]
    if (!speedOptions.includes(speed)) speedOptions.push(speed), speedOptions.sort((a, b) => a - b)
    const secondsOptions = [0, 10, 15, 30, 45, 60, 90, 120]
    const downloadable = episodes.filter((ep) => !ep.completed && !downloadedIds.has(ep.id)).length
    return (
      <div className="show-page">
        <div className="show-topbar">
          <button className="back-link" onClick={leaveShow}>
            <Icon name="chevronLeft" size={18} /> All shows
          </button>
          <span className="spacer" />
          <button
            className="icon-btn"
            onClick={refresh}
            disabled={loading}
            title="Check for new episodes"
            aria-label="Check for new episodes"
          >
            <Icon name="retry" />
          </button>
          <button
            className={`icon-btn${optionsOpen ? ' on' : ''}`}
            onClick={() => setOptionsOpen(!optionsOpen)}
            aria-expanded={optionsOpen}
            title="Show options"
            aria-label="Show options"
          >
            <Icon name="settings" />
          </button>
        </div>

        <header className="show-hero">
          {selected.image_url ? <img src={selected.image_url} alt="" /> : <span className="art-empty hero-art" />}
          <div className="hero-text">
            <h2>{selected.title}</h2>
            {selected.author && <p className="muted">{selected.author}</p>}
            <p className="muted">
              {episodes.length} episodes · {unplayedCount} unplayed
            </p>
          </div>
        </header>

        {notice && <p className="notice" role="status">{notice}</p>}

        {optionsOpen && (
          <section className="show-options card" aria-label="Show options">
            <div className="opt-row">
              <span>Playback speed</span>
              <Picker
                title="Playback speed"
                value={speed}
                onChange={changeSpeed}
                options={speedOptions.map((v) => ({ value: v, label: `${v}×` }))}
              />
            </div>
            <div className="opt-row">
              <span>Skip intro</span>
              <Picker
                title="Skip intro"
                value={skips.intro}
                onChange={(v) => changeSkip('intro', v)}
                options={secondsOptions.map((v) => ({ value: v, label: v === 0 ? 'Off' : `${v} seconds` }))}
              />
            </div>
            <div className="opt-row">
              <span>Skip outro</span>
              <Picker
                title="Skip outro"
                value={skips.outro}
                onChange={(v) => changeSkip('outro', v)}
                options={secondsOptions.map((v) => ({ value: v, label: v === 0 ? 'Off' : `${v} seconds` }))}
              />
            </div>
            <label className="opt-row">
              <span>
                Auto-download new episodes
                <small>Wi-Fi only. Deleted after you finish them.</small>
              </span>
              <input type="checkbox" checked={Boolean(selected.auto_download)} onChange={toggleAutoDownload} />
            </label>
            <label className="opt-row">
              <span>
                New-episode alerts
                <small>Notify me when this show publishes.</small>
              </span>
              <input type="checkbox" checked={!selected.mute_alerts} onChange={toggleAlerts} />
            </label>
            <div className="opt-block">
              <span className="opt-label">Download unplayed</span>
              <div className="chip-row">
                <button className="pill" onClick={() => downloadUnplayed(3)}>Newest 3</button>
                <button className="pill" onClick={() => downloadUnplayed(5)}>Newest 5</button>
                <button className="pill" onClick={() => downloadUnplayed(10)}>Newest 10</button>
                <button className="pill" onClick={() => downloadUnplayed(0)}>All ({downloadable})</button>
              </div>
            </div>
            <div className="opt-block opt-danger">
              <button className="pill" onClick={markAllPlayed} disabled={loading}>
                Mark all played
              </button>
              <button className="pill danger" onClick={unsubscribe}>
                Unsubscribe
              </button>
            </div>
          </section>
        )}

        <div className="find-row">
          <input
            type="search"
            className="episode-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search episodes…"
            aria-label="Search episodes"
          />
          <Picker
            title="Sort episodes"
            ariaLabel="Sort episodes"
            triggerClass="icon-btn sort-btn"
            value={sort}
            onChange={setSort}
            options={SORTS.map((o) => ({ value: o.id, label: o.label }))}
          >
            <Icon name="sort" />
          </Picker>
        </div>
        <div className="filter-strip" role="group" aria-label="Filter episodes">
          {FILTERS.map((f) => (
            <button key={f.id} className={`pill${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id !== 'all' && <span className="count">{counts[f.id]}</span>}
            </button>
          ))}
        </div>

        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}
        {loading && <p className="muted">Loading episodes…</p>}
        {!loading && visibleEpisodes.length === 0 && (needle || filter !== 'all') && (
          <p className="muted">
            {needle ? `No episodes match “${query.trim()}”.` : 'No episodes in this view.'}
          </p>
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
