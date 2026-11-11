/* Android player UI over the native ExoPlayer service.
 *
 * The service is the source of truth. This component loads episodes into it,
 * polls its state while the page is visible (timers do not run when the
 * WebView is frozen, which is fine: nothing here is needed then), and on
 * resume collects what the service recorded in the meantime. */

import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { NativeAudio, applyDrain, toItem } from '../lib/nativeAudio'
import PlayerView, { SPEEDS } from './PlayerView'

const POLL_MS = 500
const DRAIN_EVERY = 10 // polls

export default function NativePlayer({ nowPlaying, queue, onNativeChange, onQueueChanged }) {
  const [snap, setSnap] = useState(null)
  const [sleepChoice, setSleepChoice] = useState('0')
  const [, setTick] = useState(0)

  const episode = nowPlaying ? nowPlaying.episode : null
  const episodeId = episode ? episode.id : null
  const queueRef = useRef(queue)
  queueRef.current = queue
  const episodeIdRef = useRef(episodeId)
  episodeIdRef.current = episodeId
  const loadedToken = useRef(null)
  const loading = useRef(false)
  const cbRef = useRef({ onNativeChange, onQueueChanged })
  cbRef.current = { onNativeChange, onQueueChanged }

  // Load a newly chosen episode (and the up-next list) into the service.
  useEffect(() => {
    if (!nowPlaying || nowPlaying.native || loadedToken.current === nowPlaying.token) return
    loadedToken.current = nowPlaying.token
    const ep = nowPlaying.episode
    loading.current = true
    ;(async () => {
      try {
        const pos = await api.getPosition(ep.id).catch(() => ({ position_seconds: 0 }))
        const resume =
          pos.position_seconds > 10 &&
          !(ep.duration_seconds && pos.position_seconds > ep.duration_seconds - 30)
        const upNext = await Promise.all(
          queueRef.current.filter((q) => q.id !== ep.id).map((q) => toItem(q)),
        )
        await NativeAudio.load({
          item: await toItem(ep, nowPlaying.showTitle),
          upNext,
          startPositionMs: resume ? Math.round(pos.position_seconds * 1000) : 0,
          autoplay: nowPlaying.autoplay,
          speed: 1,
        })
      } catch (err) {
        console.error('NativeAudio.load failed', err)
      } finally {
        loading.current = false
      }
    })()
  }, [nowPlaying])

  // Poll the service while visible; sync with it when it changes under us.
  useEffect(() => {
    let alive = true
    let polls = 0

    async function drain() {
      try {
        if (await applyDrain(api)) cbRef.current.onQueueChanged()
      } catch (err) {
        console.error('drain failed', err)
      }
    }

    async function poll() {
      if (document.visibilityState !== 'visible') return
      let s
      try {
        s = await NativeAudio.getState()
      } catch {
        return
      }
      if (!alive) return
      setSnap(s)
      // The service moved to a different episode (queue auto-advance, or the
      // app was reopened while it kept playing): follow it.
      if (s.currentId && s.currentId !== episodeIdRef.current && !loading.current) {
        cbRef.current.onNativeChange(s.currentId)
      }
      polls++
      if (polls % DRAIN_EVERY === 0 || s.state === 'ended') drain()
    }

    async function onVisible() {
      if (document.visibilityState !== 'visible') return
      await drain() // collect what happened while the page was frozen
      poll()
    }

    drain().then(poll)
    const id = setInterval(poll, POLL_MS)
    const listener = NativeAudio.addListener('change', poll)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      Promise.resolve(listener).then((l) => l && l.remove && l.remove())
    }
  }, [])

  // Keep the service's up-next list in step with the app's queue.
  const currentId = snap ? snap.currentId : null
  const hasMedia = snap ? snap.hasMedia : false
  useEffect(() => {
    if (!hasMedia) return
    let cancelled = false
    Promise.all(queue.filter((q) => q.id !== currentId).map((q) => toItem(q)))
      .then((items) => {
        if (!cancelled) return NativeAudio.setUpNext({ items })
        return undefined
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [queue, currentId, hasMedia])

  // The sleep countdown ticks once a second while a timer runs.
  const sleepActive = snap && snap.sleepEndsAt > 0
  useEffect(() => {
    if (!sleepActive) return undefined
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [sleepActive])

  const speed = snap ? Number(snap.speed.toFixed(2)) : 1
  const isPlaying = Boolean(snap && (snap.playing || (snap.playWhenReady && snap.state === 'buffering')))
  const sleepLeft = sleepActive ? Math.max(0, Math.ceil((snap.sleepEndsAt - Date.now()) / 1000)) : null
  const sleepValue = snap && snap.sleepEndOfEpisode ? 'episode' : sleepActive ? sleepChoice : '0'

  const patch = (changes) => setSnap((s) => (s ? { ...s, ...changes } : s))

  return (
    <PlayerView
      episode={episode}
      title={(nowPlaying && nowPlaying.showTitle) || (episode && episode.show_title) || ''}
      artwork={episode ? episode.image_url || episode.show_image || null : null}
      isPlaying={isPlaying}
      current={snap ? snap.positionMs / 1000 : 0}
      duration={snap ? snap.durationMs / 1000 : 0}
      speed={speed}
      sleepValue={sleepValue}
      sleepLeft={sleepLeft}
      onToggle={() => {
        if (isPlaying) NativeAudio.pause()
        else NativeAudio.play()
        patch({ playing: !isPlaying, playWhenReady: !isPlaying })
      }}
      onSkip={(s) => NativeAudio.seekBy({ deltaMs: s * 1000 })}
      onSeek={(t) => {
        NativeAudio.seekTo({ positionMs: Math.round(t * 1000) })
        patch({ positionMs: Math.round(t * 1000) })
      }}
      onCycleSpeed={() => {
        const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
        NativeAudio.setSpeed({ speed: next })
        patch({ speed: next })
      }}
      onSleepChange={(v) => {
        setSleepChoice(v)
        if (v === '0') NativeAudio.setSleep({ minutes: 0 })
        else if (v === 'episode') NativeAudio.setSleep({ endOfEpisode: true })
        else NativeAudio.setSleep({ minutes: parseInt(v, 10) })
        NativeAudio.getState().then(setSnap).catch(() => {})
      }}
    />
  )
}
