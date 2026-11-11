/* Presentational player: a mini bar above the tab bar and the full-screen
 * sheet it expands into. It owns no audio: Player.jsx feeds it state from the
 * native ExoPlayer service and handles its callbacks. */

import { useState } from 'react'
import { useBackHandler } from '../lib/back'
import Icon from './Icon'
import { ChapterList, ShowNotes, currentChapter } from './PlayerPanels'
import { formatDuration } from './EpisodeRow'

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5]
export const SLEEP_OPTIONS = [
  { label: 'Off', value: '0' },
  { label: '5 min', value: '5' },
  { label: '10 min', value: '10' },
  { label: '15 min', value: '15' },
  { label: '30 min', value: '30' },
  { label: '45 min', value: '45' },
  { label: '60 min', value: '60' },
  { label: 'End of episode', value: 'episode' },
]

function formatLeft(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function PlayerView({
  episode,
  title,
  artwork,
  isPlaying,
  current,
  duration,
  speed,
  sleepValue, // '0' | '5' | ... | 'episode'
  sleepLeft, // seconds, or null
  onToggle,
  onSkip,
  onSeek,
  onCycleSpeed,
  onSleepChange,
  chapters = [],
  description = null,
}) {
  const [expanded, setExpanded] = useState(false)
  const [panel, setPanel] = useState(null) // null | 'chapters' | 'notes'
  useBackHandler(expanded, () => setExpanded(false))

  if (!episode) return null
  const pct = duration ? Math.min((current / duration) * 100, 100) : 0
  const chapter = currentChapter(chapters, current)
  const showChapters = chapters.length > 0
  const activePanel = panel === 'chapters' && !showChapters ? null : panel

  return (
    <>
      <div className="mini-player">
        <div className="mini-progress" style={{ width: `${pct}%` }} />
        <button className="mini-open" onClick={() => setExpanded(true)} aria-label="Open player">
          <Artwork src={artwork} size={44} />
          <span className="mini-text">
            <span className="mini-title">{episode.title}</span>
            <span className="mini-show">{title}</span>
          </span>
        </button>
        <button className="icon-btn" onClick={() => onSkip(-15)} aria-label="Back 15 seconds">
          <Icon name="back15" size={26} />
        </button>
        <button className="icon-btn play-btn" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
          <Icon name={isPlaying ? 'pause' : 'play'} size={26} />
        </button>
      </div>

      {expanded && (
        <div className="sheet" role="dialog" aria-label="Now playing">
          <div className="sheet-top">
            <button className="icon-btn" onClick={() => setExpanded(false)} aria-label="Close player">
              <Icon name="chevronDown" size={28} />
            </button>
            <span className="muted">Now playing</span>
            <span style={{ width: 44 }} />
          </div>

          <div className="sheet-art">
            <Artwork src={artwork} size="100%" large />
          </div>

          <div className="sheet-info">
            <h2>{episode.title}</h2>
            <p className="muted">{title}</p>
            {chapter && chapter.title && <p className="now-chapter">{chapter.title}</p>}
          </div>

          <div className="seek">
            <input
              type="range"
              min="0"
              max={duration || 0}
              step="1"
              value={Math.min(current, duration || 0)}
              onChange={(e) => onSeek(Number(e.target.value))}
              style={{ '--pct': `${pct}%` }}
              aria-label="Seek"
            />
            <div className="seek-times">
              <span>{formatDuration(current)}</span>
              <span>-{formatDuration(Math.max(duration - current, 0))}</span>
            </div>
          </div>

          <div className="transport">
            <button className="icon-btn" onClick={() => onSkip(-15)} aria-label="Back 15 seconds">
              <Icon name="back15" size={38} />
            </button>
            <button className="big-play" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
              <Icon name={isPlaying ? 'pause' : 'play'} size={34} />
            </button>
            <button className="icon-btn" onClick={() => onSkip(30)} aria-label="Forward 30 seconds">
              <Icon name="fwd30" size={38} />
            </button>
          </div>

          <div className="sheet-extras">
            <button className="chip" onClick={onCycleSpeed} title="Playback speed">
              {speed}×
            </button>
            <label className="chip select-chip">
              <Icon name="moon" size={16} />
              <select value={sleepValue} onChange={(e) => onSleepChange(e.target.value)} title="Sleep timer">
                {SLEEP_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.value === '0' ? 'Sleep timer' : opt.label}
                  </option>
                ))}
              </select>
              {sleepLeft !== null && sleepValue !== '0' && sleepValue !== 'episode' && (
                <span>{formatLeft(sleepLeft)}</span>
              )}
            </label>
          </div>

          <div className="panel-tabs">
            {showChapters && (
              <button
                className={activePanel === 'chapters' ? 'on' : ''}
                onClick={() => setPanel(activePanel === 'chapters' ? null : 'chapters')}
              >
                Chapters ({chapters.length})
              </button>
            )}
            <button
              className={activePanel === 'notes' ? 'on' : ''}
              onClick={() => setPanel(activePanel === 'notes' ? null : 'notes')}
            >
              Show notes
            </button>
          </div>
          {activePanel === 'chapters' && <ChapterList chapters={chapters} current={current} onSeek={onSeek} />}
          {activePanel === 'notes' && <ShowNotes html={description} onSeek={onSeek} />}
        </div>
      )}
    </>
  )
}

function Artwork({ src, size, large = false }) {
  const style = large ? {} : { width: size, height: size }
  return src ? (
    <img className={`art${large ? ' art-large' : ''}`} src={src} alt="" style={style} />
  ) : (
    <div className={`art art-empty${large ? ' art-large' : ''}`} style={style} />
  )
}
