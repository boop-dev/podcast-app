/* Presentational player: a mini bar above the tab bar and the full-screen
 * sheet it expands into. It owns no audio: Player.jsx feeds it state from the
 * native ExoPlayer service and handles its callbacks. */

import { useState } from 'react'
import { useBackHandler } from '../lib/back'
import Icon from './Icon'
import Picker from './Picker'
import { ChapterList, ShowNotes, currentChapter } from './PlayerPanels'
import { formatDuration } from './EpisodeRow'

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5]
export const SPEED_MIN = 0.5
export const SPEED_MAX = 3
export const SPEED_STEP = 0.05

const clampSpeed = (v) =>
  Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(v / SPEED_STEP) * SPEED_STEP))

/** Fine speed control: slider and -/+ in 0.05x steps, plus the usual presets. */
function SpeedPanel({ speed, onChange }) {
  const set = (v) => onChange(Number(clampSpeed(v).toFixed(2)))
  return (
    <div className="speed-panel">
      <div className="speed-fine">
        <button className="icon-btn" onClick={() => set(speed - SPEED_STEP)} aria-label="Slower">−</button>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={speed}
          onChange={(e) => set(Number(e.target.value))}
          aria-label="Playback speed"
        />
        <button className="icon-btn" onClick={() => set(speed + SPEED_STEP)} aria-label="Faster">+</button>
      </div>
      <div className="speed-presets">
        {SPEEDS.map((s) => (
          <button key={s} className={`chip${s === speed ? ' on' : ''}`} onClick={() => set(s)}>{s}×</button>
        ))}
      </div>
    </div>
  )
}
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
  onSetSpeed,
  onSleepChange,
  chapters = [],
  description = null,
  skipBack = 15,
  skipForward = 30,
  skipAhead = 60,
  onSkipAhead,
  buffering = false,
  errorMessage = null,
  onRetry,
  adToast = null, // {text} while a "skipped an ad" notice is showing
  onUndoAd,
  onShare,
}) {
  const [expanded, setExpanded] = useState(false)
  const [panel, setPanel] = useState(null) // null | 'chapters' | 'notes'
  const [showSpeed, setShowSpeed] = useState(false)
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
            {errorMessage ? (
              <span className="mini-show mini-error">{errorMessage}</span>
            ) : (
              <span className="mini-show">{title}</span>
            )}
          </span>
        </button>
        <button className="icon-btn" onClick={() => onSkip(-skipBack)} aria-label={`Back ${skipBack} seconds`}>
          <Icon name="back15" size={26} label={skipBack} />
        </button>
        {errorMessage ? (
          <button className="icon-btn play-btn" onClick={onRetry} aria-label="Retry">
            <Icon name="retry" size={26} />
          </button>
        ) : (
          <button className="icon-btn play-btn" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {buffering ? <span className="spinner" aria-label="Loading" /> : <Icon name={isPlaying ? 'pause' : 'play'} size={26} />}
          </button>
        )}
      </div>

      {adToast && (
        <div className="ad-toast" role="status">
          <span>{adToast.text}</span>
          <button onClick={onUndoAd}>Undo</button>
        </div>
      )}

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
            <Artwork src={(chapter && chapter.image) || artwork} fallback={artwork} size="100%" large />
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
            <button className="icon-btn" onClick={() => onSkip(-skipBack)} aria-label={`Back ${skipBack} seconds`}>
              <Icon name="back15" size={38} label={skipBack} />
            </button>
            <button className="big-play" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
              {buffering ? <span className="spinner big" aria-label="Loading" /> : <Icon name={isPlaying ? 'pause' : 'play'} size={34} />}
            </button>
            <button className="icon-btn" onClick={() => onSkip(skipForward)} aria-label={`Forward ${skipForward} seconds`}>
              <Icon name="fwd30" size={38} label={skipForward} />
            </button>
          </div>

          {errorMessage && (
            <div className="player-error" role="alert">
              <span>{errorMessage}</span>
              <button className="pill" onClick={onRetry}>
                Retry
              </button>
            </div>
          )}

          <div className="sheet-extras">
            {onShare && (
              <button className="chip" onClick={onShare} title="Share episode">
                <Icon name="share" size={16} /> Share
              </button>
            )}
            {onSkipAhead && (
              <button className="chip" onClick={onSkipAhead} title="Skip ahead (e.g. past an ad)">
                <Icon name="skipAhead" size={16} /> {formatDuration(skipAhead)}
              </button>
            )}
            <button className={`chip${showSpeed ? ' on' : ''}`} onClick={() => setShowSpeed((v) => !v)} title="Playback speed">
              {speed}×
            </button>
            <Picker
              title="Sleep timer"
              triggerClass="chip"
              value={sleepValue}
              onChange={onSleepChange}
              options={SLEEP_OPTIONS.map((opt) => ({ value: opt.value, label: opt.value === '0' ? 'Off' : opt.label }))}
            >
              <Icon name="moon" size={16} />
              <span>{sleepValue === '0' ? 'Sleep timer' : SLEEP_OPTIONS.find((o) => o.value === sleepValue)?.label}</span>
              {sleepLeft !== null && sleepValue !== '0' && sleepValue !== 'episode' && (
                <span>{formatLeft(sleepLeft)}</span>
              )}
            </Picker>
          </div>

          {showSpeed && <SpeedPanel speed={speed} onChange={onSetSpeed} />}

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

function Artwork({ src, fallback = null, size, large = false }) {
  const [failed, setFailed] = useState(null) // a chapter image that did not load: fall back to the show art
  const shown = failed === src ? fallback : src
  const style = large ? {} : { width: size, height: size }
  return shown ? (
    <img className={`art${large ? ' art-large' : ''}`} src={shown} alt="" style={style} onError={() => setFailed(src)} />
  ) : (
    <div className={`art art-empty${large ? ' art-large' : ''}`} style={style} />
  )
}
