/* Shared episode row: title, date/duration, description, progress bar,
 * and the Play / Queue / Download actions. */

import { useState } from 'react'
import { api } from '../api'
import Icon from './Icon'
import { downloadEpisode, removeDownload } from '../lib/downloads'
import { removeJob, retryJob, useDownloadJob } from '../lib/downloadManager'

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

export default function EpisodeRow({ episode, onPlay, inQueue, onToggleQueue, onPlayNext, downloaded, onDownloadChanged, onPlayedChanged }) {
  const [busy, setBusy] = useState(false)
  const job = useDownloadJob(episode.id)
  const dlStatus = job && job.status !== 'done' ? job.status : null // queued | downloading | failed
  const dlPct = job && job.total ? Math.min(100, Math.round((job.bytes / job.total) * 100)) : 0
  const progress =
    episode.duration_seconds && episode.position_seconds
      ? Math.min(episode.position_seconds / episode.duration_seconds, 1)
      : 0

  async function toggleDownload() {
    if (dlStatus === 'downloading') return // a running transfer cannot be cancelled
    if (dlStatus === 'queued') return void removeJob(episode.id) // take it back out of the queue
    if (dlStatus === 'failed') return void retryJob(episode.id)
    setBusy(true)
    try {
      if (downloaded) await removeDownload(episode)
      else await downloadEpisode(episode) // queued; the app refreshes when it finishes
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
        <button className="pill primary" onClick={() => onPlay(episode)}>
          <Icon name="play" size={16} />
          {episode.position_seconds > 10 && !episode.completed ? 'Resume' : 'Play'}
        </button>
        <span className="spacer" />
        <button
          className={`icon-btn${inQueue ? ' on' : ''}`}
          onClick={() => onToggleQueue(episode)}
          title={inQueue ? 'Remove from queue' : 'Add to queue'}
          aria-label={inQueue ? 'Remove from queue' : 'Add to queue'}
        >
          <Icon name={inQueue ? 'minus' : 'plus'} />
        </button>
        {onPlayNext && (
          <button
            className="icon-btn"
            onClick={() => onPlayNext(episode)}
            title="Play next"
            aria-label="Play next"
          >
            <Icon name="playNext" />
          </button>
        )}
        <button
          className={`icon-btn${downloaded ? ' on' : ''}`}
          onClick={toggleDownload}
          disabled={busy}
          title={
            dlStatus === 'downloading' ? `Downloading ${dlPct}%` :
            dlStatus === 'queued' ? 'Queued: tap to cancel' :
            dlStatus === 'failed' ? 'Download failed: tap to retry' :
            downloaded ? 'Delete download' : 'Download'
          }
          aria-label={downloaded ? 'Delete download' : 'Download'}
        >
          {dlStatus === 'downloading' ? (
            <ProgressRing pct={dlPct} />
          ) : dlStatus === 'queued' ? (
            <Icon name="clock" />
          ) : dlStatus === 'failed' ? (
            <Icon name="retry" className="failed" />
          ) : (
            <Icon name={downloaded ? 'downloaded' : 'download'} />
          )}
        </button>
        <button
          className={`icon-btn${episode.completed ? ' on' : ''}`}
          onClick={togglePlayed}
          title={episode.completed ? 'Mark unplayed' : 'Mark played'}
          aria-label={episode.completed ? 'Mark unplayed' : 'Mark played'}
        >
          <Icon name="check" />
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

function ProgressRing({ pct }) {
  const r = 9
  const c = 2 * Math.PI * r
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="3" />
      <circle
        cx="12" cy="12" r={r} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(pct, 3) / 100)}
        transform="rotate(-90 12 12)"
      />
    </svg>
  )
}

// Episode descriptions arrive as HTML; show them as plain text.
function stripHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}
