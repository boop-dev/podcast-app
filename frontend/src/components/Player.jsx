/* Android player UI over the native ExoPlayer service.
 *
 * The service is the source of truth. This component loads episodes into it,
 * polls its state while the page is visible (timers do not run when the
 * WebView is frozen, which is fine: nothing here is needed then), and on
 * resume collects what the service recorded in the meantime. */

import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { NativeAudio, applyDrain, toItem } from '../lib/nativeAudio'
import { adRanges } from '../lib/adChapters'
import { shareEpisode } from '../lib/share'
import PlayerView from './PlayerView'

const ERROR_TEXT = {
  network: "Can't reach the server. Check your connection.",
  unavailable: "This episode isn't available. The link may be dead.",
  unsupported: "This audio file can't be played.",
  unknown: 'Something went wrong playing this episode.',
}
const DEFAULT_OPTIONS = { skipBackSec: 15, skipForwardSec: 30, skipAheadSec: 60, skipAdChapters: false }

const POLL_MS = 500
const DRAIN_EVERY = 10 // polls

export default function Player({ nowPlaying, queue, onNativeChange, onQueueChanged }) {
  const [snap, setSnap] = useState(null)
  const [sleepChoice, setSleepChoice] = useState('0')
  const [chapters, setChapters] = useState([])
  const [opts, setOpts] = useState(DEFAULT_OPTIONS)
  const [adToast, setAdToast] = useState(null)
  const undone = useRef(new Set()) // ad ranges the listener chose to un-skip, by startMs
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
        const skips = await api.getShowSkips(ep.show_id).catch(() => ({ intro: 0, outro: 0 }))
        const upNext = await Promise.all(
          queueRef.current.filter((q) => q.id !== ep.id).map((q) => toItem(q)),
        )
        await NativeAudio.load({
          item: await toItem(ep, nowPlaying.showTitle),
          upNext,
          // Resume where you left off; a fresh episode starts after the show's intro.
          startPositionMs: resume ? Math.round(pos.position_seconds * 1000) : skips.intro * 1000,
          autoplay: nowPlaying.autoplay,
          speed: await api.getPlaybackSpeed(ep.show_id).catch(() => 1),
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

  // Skip amounts and the ad-chapter switch live in Settings (native prefs).
  useEffect(() => {
    const load = () => NativeAudio.getOptions().then((o) => setOpts({ ...DEFAULT_OPTIONS, ...o })).catch(() => {})
    load()
    window.addEventListener('podcast-options-changed', load)
    return () => window.removeEventListener('podcast-options-changed', load)
  }, [])

  // "Skipped an ad" notice with Undo (only if it just happened and we can see it).
  useEffect(() => {
    let timer
    const listener = NativeAudio.addListener('adSkipped', (e) => {
      if (Date.now() - e.at > 15000 || document.visibilityState !== 'visible') return
      setAdToast({ ...e, text: 'Skipped an ad' })
      clearTimeout(timer)
      timer = setTimeout(() => setAdToast(null), 8000)
    })
    return () => {
      clearTimeout(timer)
      Promise.resolve(listener).then((l) => l && l.remove && l.remove())
    }
  }, [])

  // Chapters for the current episode (fetched once, then cached on-device).
  useEffect(() => {
    setChapters([])
    if (!episodeId) return undefined
    let cancelled = false
    api
      .getChapters(episodeId)
      .then((c) => !cancelled && setChapters(c))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [episodeId])

  // Tell the player which chapters are ads, so it skips them even with the screen off.
  const durationMs = snap ? snap.durationMs : 0
  const adSwitch = snap ? snap.skipAdChapters : opts.skipAdChapters
  useEffect(() => {
    if (!episodeId || !durationMs) return
    undone.current = new Set()
    const ranges = adSwitch ? adRanges(chapters, durationMs / 1000) : []
    NativeAudio.setSkipRanges({ id: episodeId, ranges }).catch(() => {})
  }, [episodeId, chapters, durationMs, adSwitch])

  // Chapter titles go to the native side so the notification / lock screen can show them.
  useEffect(() => {
    if (!episodeId) return
    const list = chapters.map((c) => ({ startMs: Math.round(c.start * 1000), title: c.title || '' }))
    NativeAudio.setChapters({ id: episodeId, chapters: list }).catch(() => {})
  }, [episodeId, chapters])

  function undoAdSkip() {
    if (!adToast) return
    undone.current.add(adToast.startMs)
    NativeAudio.seekTo({ positionMs: adToast.startMs })
    const ranges = adRanges(chapters, durationMs / 1000).filter((r) => !undone.current.has(r.startMs))
    NativeAudio.setSkipRanges({ id: adToast.id, ranges }).catch(() => {})
    setAdToast(null)
  }

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
      chapters={chapters}
      description={episode ? episode.description : null}
      skipBack={opts.skipBackSec}
      skipForward={opts.skipForwardSec}
      skipAhead={opts.skipAheadSec}
      onSkipAhead={() => NativeAudio.seekBy({ deltaMs: opts.skipAheadSec * 1000 })}
      buffering={Boolean(snap && snap.playWhenReady && snap.state === 'buffering' && !snap.error)}
      errorMessage={snap && snap.error ? ERROR_TEXT[snap.error] || ERROR_TEXT.unknown : null}
      onRetry={() => NativeAudio.retry().catch(() => {})}
      adToast={adToast}
      onUndoAd={undoAdSkip}
      onShare={episode ? () => shareEpisode(episode, nowPlaying && nowPlaying.showTitle) : undefined}
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
      onSetSpeed={(next) => {
        NativeAudio.setSpeed({ speed: next })
        patch({ speed: next })
        if (episode) api.setPlaybackSpeed(episode.show_id, next).catch(() => {}) // remembered per show
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
