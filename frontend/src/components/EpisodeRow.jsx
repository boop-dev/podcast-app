/* Shared episode row: title, date/duration, description, progress bar,
 * and the Play / Queue / Download actions. */

import { useState } from 'react'
import { api } from '../api'
import { downloadEpisode, removeDownload } from '../lib/downloads'

export function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) return ''
  const s = Math.round(totalSeconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

export function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function EpisodeRow({ episode, onPlay, inQueue, onToggleQueue, downloaded, onDownloadChanged, onPlayedChanged }) {
  const [busy, setBusy] = useState(false)
  const progress =
    episode.duration_seconds && episode.position_seconds
      ? Math.min(episode.position_seconds / episode.duration_seconds, 1)
      : 0

  async function toggleDownload() {
    setBusy(true)
    try {
      if (downloaded) await removeDownload(episode)
      else await downloadEpisode(episode)
      onDownloadChanged()
    } catch (err) {
      alert(`Download failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function togglePlayed() {
    try {
      await api.setPlayed(episode.id, !episode.completed)
      if (onPlayedChanged) onPlayedChanged()
    } catch (err) {
      alert(`Could not update: ${err.message}`)
    }
  }

  return (
    <article className={`episode${episode.completed ? ' played' : ''}`}>
      <h4>
        {episode.is_new && <span className="new-tag">NEW</span>}
        {episode.title}
      </h4>
      <div className="meta">
        {formatDate(episode.pub_date)}
        {episode.duration_seconds ? ` · ${formatDuration(episode.duration_seconds)}` : ''}
        {episode.completed ? ' · Finished' : ''}
        {downloaded ? ' · Downloaded' : ''}
      </div>
      {episode.description && <p className="desc">{stripHtml(episode.description)}</p>}
      <div className="actions">
        <button className="primary" onClick={() => onPlay(episode)}>
          {episode.position_seconds > 10 && !episode.completed ? 'Resume' : 'Play'}
        </button>
        <button onClick={() => onToggleQueue(episode)}>
          {inQueue ? 'Remove from queue' : 'Add to queue'}
        </button>
        <button onClick={toggleDownload} disabled={busy}>
          {downloaded ? 'Delete download' : 'Download'}
        </button>
        <button onClick={togglePlayed}>
          {episode.completed ? 'Mark unplayed' : 'Mark played'}
        </button>
      </div>
      {progress > 0 && !episode.completed && (
        <div className="progress">
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </article>
  )
}

// Episode descriptions arrive as HTML; show them as plain text.
function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}
