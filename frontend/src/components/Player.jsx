/* Bottom player bar: one <audio> element for the whole app.
 *
 * Features: play/pause, seek (native controls), speed 0.75x-2x,
 * sleep timer, and resume. The playback position is saved to the
 * backend every 10 seconds while playing, on pause, and when an
 * episode ends, so it resumes where you left off.
 */

import { useEffect, useRef, useState } from 'react'
import { MediaSession } from '@jofr/capacitor-media-session'
import { api, audioUrl, resolveAudioSrc } from '../api'

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]
const SLEEP_OPTIONS = [
  { label: 'Off', minutes: 0 },
  { label: '5 min', minutes: 5 },
  { label: '10 min', minutes: 10 },
  { label: '15 min', minutes: 15 },
  { label: '30 min', minutes: 30 },
  { label: '45 min', minutes: 45 },
  { label: '60 min', minutes: 60 },
  { label: 'End of episode', minutes: 'episode' },
]

export default function Player({ episode, showTitle, autoplay, onEnded }) {
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [sleepMinutes, setSleepMinutes] = useState(0)
  const [sleepLeft, setSleepLeft] = useState(null) // seconds remaining, or null
  const sleepTimer = useRef(null)
  const sleepCountdown = useRef(null)
  const lastSaved = useRef(0)

  // Load a new episode: resolve the audio source (a downloaded
  // episode's local file on native, otherwise the normal audio URL),
  // restore the saved position, then play if asked.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !episode) return
    let cancelled = false
    resolveAudioSrc(episode)
      .then((src) => {
        if (cancelled) return
        audio.src = src
        audio.load()
        if (autoplay) {
          audio.play().catch(() => setIsPlaying(false))
        }
      })
      .catch(() => {
        // Fall back to the plain audio URL if resolution failed.
        if (cancelled) return
        audio.src = audioUrl(episode)
        audio.load()
        if (autoplay) {
          audio.play().catch(() => setIsPlaying(false))
        }
      })
    api
      .getPosition(episode.id)
      .then(({ position_seconds }) => {
        if (cancelled) return
        const onReady = () => {
          if (position_seconds > 10 && position_seconds < audio.duration - 30) {
            audio.currentTime = position_seconds
          }
          audio.removeEventListener('loadedmetadata', onReady)
        }
        audio.addEventListener('loadedmetadata', onReady)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [episode, autoplay])

  // Lock-screen / notification controls and background playback.
  // On Android this starts a foreground service while a session is
  // "playing", which keeps the WebView audio alive with the screen off.
  // Handlers read the live audio element, so they never go stale.
  useEffect(() => {
    if (!episode) return
    const artwork = episode.image_url ? [{ src: episode.image_url }] : []
    MediaSession.setMetadata({
      title: episode.title,
      artist: showTitle,
      album: showTitle,
      artwork,
    }).catch(() => {})
  }, [episode, showTitle])

  useEffect(() => {
    const audio = () => audioRef.current
    const seekBy = (d) => {
      const a = audio()
      if (a) a.currentTime = Math.max(0, a.currentTime + d)
    }
    const handlers = {
      play: () => audio()?.play(),
      pause: () => audio()?.pause(),
      seekbackward: (d) => seekBy(-(d?.seekOffset || 15)),
      seekforward: (d) => seekBy(d?.seekOffset || 30),
      seekto: (d) => {
        const a = audio()
        if (a && d?.seekTime != null) a.currentTime = d.seekTime
      },
    }
    for (const [action, handler] of Object.entries(handlers)) {
      MediaSession.setActionHandler({ action }, handler).catch(() => {})
    }
    return () => {
      for (const action of Object.keys(handlers)) {
        MediaSession.setActionHandler({ action }, null).catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    MediaSession.setPlaybackState({ playbackState: isPlaying ? 'playing' : 'paused' }).catch(() => {})
  }, [isPlaying])

  // Speed applies to the current audio element.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed, episode])

  // Sleep timer: pause when it fires, and show a countdown.
  useEffect(() => {
    clearTimeout(sleepTimer.current)
    clearInterval(sleepCountdown.current)
    setSleepLeft(null)
    if (!sleepMinutes) return
    const audio = audioRef.current
    const ms =
      sleepMinutes === 'episode'
        ? Math.max((audio.duration - audio.currentTime) * 1000, 0)
        : sleepMinutes * 60 * 1000
    setSleepLeft(Math.ceil(ms / 1000))
    sleepCountdown.current = setInterval(
      () => setSleepLeft((left) => (left === null ? null : Math.max(left - 1, 0))),
      1000,
    )
    sleepTimer.current = setTimeout(() => {
      audio.pause()
      setSleepMinutes(0)
    }, ms)
    return () => {
      clearTimeout(sleepTimer.current)
      clearInterval(sleepCountdown.current)
    }
  }, [sleepMinutes, episode])

  function savePosition(position, completed = false) {
    const audio = audioRef.current
    if (!episode || !audio) return
    api
      .savePosition(episode.id, position, audio.duration || null, completed)
      .catch(() => {})
  }

  function handleTimeUpdate() {
    const audio = audioRef.current
    if (!audio) return
    // Throttle: at most one save every 10 seconds while playing.
    if (audio.duration > 0) {
      MediaSession.setPositionState({
        duration: audio.duration,
        position: audio.currentTime,
        playbackRate: audio.playbackRate || 1,
      }).catch(() => {})
    }
    if (audio.currentTime - lastSaved.current >= 10) {
      lastSaved.current = audio.currentTime
      savePosition(audio.currentTime)
    }
  }

  function handlePause() {
    setIsPlaying(false)
    savePosition(audioRef.current.currentTime)
  }

  function handleEnded() {
    savePosition(0, true)
    setIsPlaying(false)
    onEnded()
  }

  function skip(seconds) {
    const audio = audioRef.current
    if (audio) audio.currentTime = Math.max(0, audio.currentTime + seconds)
  }

  function formatSleepLeft() {
    if (sleepLeft === null) return null
    const m = Math.floor(sleepLeft / 60)
    const s = sleepLeft % 60
    return `Sleep in ${m}:${String(s).padStart(2, '0')}`
  }

  if (!episode) return null

  return (
    <div className="player">
      <div className="player-inner">
        <div className="player-title">{episode.title}</div>
        <div className="player-show">{showTitle}</div>
        <audio
          ref={audioRef}
          controls
          onPlay={() => setIsPlaying(true)}
          onPause={handlePause}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
        />
        <div className="player-controls">
          <button onClick={() => skip(-15)} title="Back 15 seconds">-15s</button>
          <button
            onClick={() => {
              const audio = audioRef.current
              if (!audio) return
              if (audio.paused) audio.play()
              else audio.pause()
            }}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button onClick={() => skip(30)} title="Forward 30 seconds">+30s</button>
          <select value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} title="Playback speed">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>
          <select
            value={String(sleepMinutes)}
            onChange={(e) =>
              setSleepMinutes(e.target.value === 'episode' ? 'episode' : parseInt(e.target.value, 10))
            }
            title="Sleep timer"
          >
            {SLEEP_OPTIONS.map((opt) => (
              <option key={opt.label} value={String(opt.minutes)}>
                Sleep: {opt.label}
              </option>
            ))}
          </select>
          {sleepLeft !== null && sleepMinutes !== 0 && (
            <span className="sleep">{formatSleepLeft()}</span>
          )}
        </div>
      </div>
    </div>
  )
}
