/* Episode detail page: full-screen sheet with artwork, status, the actions
 * and the complete show notes and chapter list. Opened from any episode row. */

import { useEffect, useState } from 'react'
import { api } from '../api'
import { useBackHandler } from '../lib/back'
import { onOpenEpisodeDetail } from '../lib/episodeDetail'
import { shareEpisode } from '../lib/share'
import Icon from './Icon'
import { formatDate, formatDuration } from './EpisodeRow'
import { htmlToText } from './PlayerPanels'

export default function EpisodeDetail({ onPlay, onToggleQueue, onPlayNext, queueIds, downloadedIds }) {
  const [episode, setEpisode] = useState(null)
  const [chapters, setChapters] = useState([])

  useEffect(() => onOpenEpisodeDetail(setEpisode), [])
  useBackHandler(Boolean(episode), () => setEpisode(null))

  // Fresh copy (played state, position) plus chapters, which may need fetching.
  const id = episode && episode.id
  useEffect(() => {
    setChapters([])
    if (!id) return undefined
    let cancelled = false
    api.getEpisode(id).then((fresh) => !cancelled && fresh && setEpisode((cur) => (cur && cur.id === id ? { ...cur, ...fresh } : cur))).catch(() => {})
    api.getChapters(id).then((c) => !cancelled && setChapters(c)).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id])

  if (!episode) return null
  const inQueue = queueIds.has(episode.id)
  const art = episode.image_url || episode.show_image
  const notes = htmlToText(episode.description)
  const resumable = episode.position_seconds > 10 && !episode.completed
  const left = episode.duration_seconds && episode.position_seconds
    ? Math.max(episode.duration_seconds - episode.position_seconds, 0) : null

  const play = () => {
    setEpisode(null)
    onPlay(episode, episode.show_title)
  }

  return (
    <div className="sheet detail" role="dialog" aria-label="Episode details">
      <div className="sheet-top">
        <button className="icon-btn" onClick={() => setEpisode(null)} aria-label="Close">
          <Icon name="chevronDown" size={28} />
        </button>
        <span className="muted">Episode</span>
        <span style={{ width: 44 }} />
      </div>

      <div className="detail-head">
        {art ? <img className="detail-art" src={art} alt="" /> : <span className="detail-art art-empty" />}
        <div>
          <h2>{episode.title}</h2>
          <p className="muted">{episode.show_title}</p>
          <p className="meta">
            {formatDate(episode.pub_date)}
            {episode.duration_seconds ? ` · ${formatDuration(episode.duration_seconds)}` : ''}
          </p>
          <p className="meta">
            {episode.completed ? 'Finished' : resumable && left !== null ? `${formatDuration(left)} left` : 'Not started'}
            {downloadedIds.has(episode.id) ? ' · Downloaded' : ''}
          </p>
        </div>
      </div>

      <div className="detail-actions">
        <button className="pill primary" onClick={play}>
          <Icon name="play" size={16} /> {resumable ? 'Resume' : 'Play'}
        </button>
        <button className="pill" onClick={() => onToggleQueue(episode)}>
          <Icon name={inQueue ? 'minus' : 'plus'} size={16} /> {inQueue ? 'In queue' : 'Queue'}
        </button>
        <button className="pill" onClick={() => onPlayNext(episode)}>
          <Icon name="playNext" size={16} /> Play next
        </button>
        <button className="pill" onClick={() => shareEpisode(episode, episode.show_title)}>
          <Icon name="share" size={16} /> Share
        </button>
      </div>

      <h3 className="section">Show notes</h3>
      {notes ? (
        <div className="show-notes">
          {notes.split('\n').map((line, i) => <p key={i}>{line}</p>)}
        </div>
      ) : (
        <p className="muted">No show notes for this episode.</p>
      )}

      {chapters.length > 0 && (
        <>
          <h3 className="section">Chapters ({chapters.length})</h3>
          <ul className="chapter-list">
            {chapters.map((c) => (
              <li key={c.start}>
                <div className="chapter-static">
                  <span className="chapter-time">{formatDuration(c.start)}</span>
                  <span className="chapter-title">{c.title || 'Untitled'}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
