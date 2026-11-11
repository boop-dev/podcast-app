/* App shell: three tabs (Shows / Search / Queue) and the player bar.
 * The player state lives here so any view can start playback. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, isNative } from './api'
import { App as CapApp } from '@capacitor/app'
import { syncAll } from './mobile/sync'
import { handleBack } from './lib/back'
import { NativeAudio } from './lib/nativeAudio'
import { refreshFeedWatchList } from './lib/feedWatch'
import Player from './components/Player'
import Shows from './components/Shows'
import SearchView from './components/SearchView'
import QueueView from './components/QueueView'
import Home from './components/Home'
import Settings from './components/Settings'
import Icon from './components/Icon'

const TITLES = {
  home: 'Home',
  shows: 'Library',
  search: 'Search',
  queue: 'Up Next',
  settings: 'Settings',
}

export default function App() {
  const [view, setView] = useState(isNative() ? 'home' : 'shows')
  const [playTick, setPlayTick] = useState(0)
  const [shows, setShows] = useState([])
  const [queue, setQueue] = useState([])
  const [downloadedIds, setDownloadedIds] = useState(new Set())
  const [nowPlaying, setNowPlaying] = useState(null) // {episode, showTitle, autoplay}
  const [error, setError] = useState('')

  const refreshShows = useCallback(() => {
    api
      .listShows()
      .then(setShows)
      .catch((err) => setError(err.message))
  }, [])

  const refreshQueue = useCallback(() => {
    api
      .listQueue()
      .then(setQueue)
      .catch((err) => setError(err.message))
  }, [])

  const refreshDownloads = useCallback(() => {
    api
      .listDownloads()
      .then((ids) => setDownloadedIds(new Set(ids)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshShows()
    refreshQueue()
    refreshDownloads()
  }, [refreshShows, refreshQueue, refreshDownloads])

  // Native back button: close the player sheet / leave a show first, then
  // return to the first tab, and only then minimise (never destroy the
  // activity, which would stop playback).
  const viewRef = useRef(view)
  viewRef.current = view
  useEffect(() => {
    if (!isNative()) return undefined
    const home = 'home'
    const sub = CapApp.addListener('backButton', () => {
      if (handleBack()) return
      if (viewRef.current !== home) {
        setView(home)
        setPlayTick((n) => n + 1)
        return
      }
      CapApp.minimizeApp()
    })
    return () => {
      sub.then((h) => h.remove())
    }
  }, [])

  // Native only: refresh feeds (and auto-download) on start and on resume.
  useEffect(() => {
    if (!isNative()) return
    let running = false
    async function sync() {
      if (running) return
      running = true
      try {
        // The background checker may have found new episodes while we were away:
        // if so, refresh right now instead of waiting for the normal interval.
        const alerts = await NativeAudio.consumeFeedAlerts().catch(() => ({ count: 0 }))
        const res = await syncAll({ force: alerts.count > 0 })
        if (res) {
          refreshShows()
          refreshDownloads()
          refreshFeedWatchList()
        }
      } finally {
        running = false
      }
    }
    sync()
    const onVisible = () => document.visibilityState === 'visible' && sync()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshShows, refreshDownloads])

  // Keep the background checker's feed list current (new subscriptions, etc.).
  useEffect(() => {
    if (!isNative()) return undefined
    const id = setTimeout(refreshFeedWatchList, 1500)
    return () => clearTimeout(id)
  }, [shows])

  function playEpisode(episode, showTitle = '') {
    setNowPlaying({ episode, showTitle, autoplay: true, token: Date.now() + Math.random() })
  }

  // Native player: the service moved to another episode on its own (queue
  // auto-advance, or the app was reopened while it kept playing). Show it.
  async function followNative(id) {
    const ep = await api.getEpisode(id).catch(() => null)
    if (!ep) return
    setNowPlaying({
      episode: ep,
      showTitle: ep.show_title || '',
      autoplay: false,
      native: true,
      token: Date.now() + Math.random(),
    })
  }

  // Web player only: when an episode ends, play the next queued episode, if any.
  async function handleEnded() {
    if (queue.length === 0) return
    const next = queue[0]
    await api.removeFromQueue(next.id)
    await refreshQueue()
    playEpisode(next)
  }

  async function toggleQueue(episode) {
    if (queue.some((ep) => ep.id === episode.id)) {
      await api.removeFromQueue(episode.id)
    } else {
      await api.addToQueue(episode.id)
    }
    refreshQueue()
  }

  const tabs = [
    ...(isNative() ? [{ id: 'home', label: 'Home', icon: 'home' }] : []),
    { id: 'shows', label: 'Library', icon: 'library' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'queue', label: 'Up Next', icon: 'queue' },
    ...(isNative() ? [{ id: 'settings', label: 'Settings', icon: 'settings' }] : []),
  ]

  return (
    <div className="app">
      <header className="app-header">
        <h1>{TITLES[view]}</h1>
      </header>

      {error && <div className="error">{error}</div>}

      {view === 'settings' && (
        <Settings
          onChanged={() => {
            refreshShows()
            refreshQueue()
            refreshDownloads()
          }}
        />
      )}
      {view === 'home' && <Home onPlay={playEpisode} refreshKey={playTick} />}
      {view === 'shows' && (
        <Shows
          shows={shows}
          onPlay={playEpisode}
          queueIds={new Set(queue.map((ep) => ep.id))}
          onToggleQueue={toggleQueue}
          downloadedIds={downloadedIds}
          onDownloadChanged={refreshDownloads}
          onRefresh={() => {
            refreshShows()
            refreshQueue()
          }}
        />
      )}
      {view === 'search' && (
        <SearchView
          onSubscribed={() => {
            refreshShows()
            setView('shows')
          }}
        />
      )}
      {view === 'queue' && (
        <QueueView queue={queue} onPlay={playEpisode} onQueueChanged={refreshQueue} />
      )}

      <Player
        nowPlaying={nowPlaying}
        queue={queue}
        onEnded={handleEnded}
        onNativeChange={followNative}
        onQueueChanged={refreshQueue}
      />

      <nav className="tabbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={view === t.id ? 'active' : ''}
            onClick={() => {
              if (t.id === 'home') setPlayTick((n) => n + 1)
              setView(t.id)
            }}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.id === 'queue' && queue.length > 0 && <b className="badge">{queue.length}</b>}
          </button>
        ))}
      </nav>
    </div>
  )
}
