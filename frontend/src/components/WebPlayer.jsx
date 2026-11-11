/* Browser / PWA player: one hidden <audio> element. (On Android the app uses
 * NativePlayer instead, so playback survives the WebView being frozen.)
 * The position is saved every 10 seconds while playing, on pause, and when
 * an episode ends, so it resumes where you left off. */

import { useEffect, useRef, useState } from 'react'
import { api, audioUrl, resolveAudioSrc } from '../api'
import PlayerView, { SPEEDS } from './PlayerView'

export default function WebPlayer({ episode, showTitle, autoplay, onEnded }) {
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [sleepValue, setSleepValue] = useState('0')
  const [sleepLeft, setSleepLeft] = useState(null)
  const [time, setTime] = useState({ current: 0, duration: 0 })
  const showId = episode ? episode.show_id : null
  const sleepTimer = useRef(null)
  const sleepCountdown = useRef(null)
  const lastSaved = useRef(0)

  const title = showTitle || (episode && episode.show_title) || ''
  const artwork = episode ? episode.image_url || episode.show_image || null : null

  // Load a new episode and restore the saved position.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !episode) return undefined
    let cancelled = false
    setTime({ current: 0, duration: 0 })
    const start = (src) => {
      if (cancelled) return
      audio.src = src
      audio.load()
      if (autoplay) audio.play().catch(() => setIsPlaying(false))
    }
    resolveAudioSrc(episode).then(start).catch(() => start(audioUrl(episode)))
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

  // Each show remembers its own speed.
  useEffect(() => {
    if (showId) api.getPlaybackSpeed(showId).then(setSpeed).catch(() => {})
  }, [showId])

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed, episode])

  // Sleep timer: pause when it fires, and show a countdown.
  useEffect(() => {
    clearTimeout(sleepTimer.current)
    clearInterval(sleepCountdown.current)
    setSleepLeft(null)
    if (sleepValue === '0') return undefined
    const audio = audioRef.current
    const ms =
      sleepValue === 'episode'
        ? Math.max((audio.duration - audio.currentTime) * 1000, 0)
        : parseInt(sleepValue, 10) * 60 * 1000
    setSleepLeft(Math.ceil(ms / 1000))
    sleepCountdown.current = setInterval(
      () => setSleepLeft((left) => (left === null ? null : Math.max(left - 1, 0))),
      1000,
    )
    sleepTimer.current = setTimeout(() => {
      audio.pause()
      setSleepValue('0')
    }, ms)
    return () => {
      clearTimeout(sleepTimer.current)
      clearInterval(sleepCountdown.current)
    }
  }, [sleepValue, episode])

  function savePosition(position, completed = false) {
    const audio = audioRef.current
    if (!episode || !audio) return
    api.savePosition(episode.id, position, audio.duration || null, completed).catch(() => {})
  }

  function handleTimeUpdate() {
    const audio = audioRef.current
    if (!audio) return
    setTime({ current: audio.currentTime, duration: audio.duration || 0 })
    if (audio.currentTime - lastSaved.current >= 10) {
      lastSaved.current = audio.currentTime
      savePosition(audio.currentTime)
    }
  }

  return (
    <>
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => {
          setIsPlaying(false)
          savePosition(audioRef.current.currentTime)
        }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleTimeUpdate}
        onEnded={() => {
          savePosition(0, true)
          setIsPlaying(false)
          onEnded()
        }}
      />
      <PlayerView
        episode={episode}
        title={title}
        artwork={artwork}
        isPlaying={isPlaying}
        current={time.current}
        duration={time.duration}
        speed={speed}
        sleepValue={sleepValue}
        sleepLeft={sleepLeft}
        onToggle={() => {
          const a = audioRef.current
          if (!a) return
          if (a.paused) a.play().catch(() => {})
          else a.pause()
        }}
        onSkip={(s) => {
          const a = audioRef.current
          if (a) a.currentTime = Math.max(0, a.currentTime + s)
        }}
        onSeek={(t) => {
          if (audioRef.current) audioRef.current.currentTime = t
          setTime((prev) => ({ ...prev, current: t }))
        }}
        onCycleSpeed={() => {
          const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
          setSpeed(next)
          if (showId) api.setPlaybackSpeed(showId, next).catch(() => {})
        }}
        description={episode ? episode.description : null}
        onSleepChange={setSleepValue}
      />
    </>
  )
}
