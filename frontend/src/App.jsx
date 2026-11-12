/* App shell: three tabs (Shows / Search / Queue) and the player bar.
 * The player state lives here so any view can start playback. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { App as CapApp } from '@capacitor/app'
import { syncAll } from './mobile/sync'
import * as store from './mobile/store'
import { episodeIdFor } from './mobile/store'
import { parseSharedLink } from './lib/shareTarget'
import { stageBackupSoon } from './lib/autoBackup'
import { stageLibrarySoon } from './lib/autoLibrary'
import { handleBack } from './lib/back'
import { NativeAudio } from './lib/nativeAudio'
import { refreshFeedWatchList } from './lib/feedWatch'
import { cleanupOrphans, enforceCap, onCompleted } from './lib/downloadManager'
import Player from './components/Player'
import Shows from './components/Shows'
import SearchView from './components/SearchView'
import QueueView from './components/QueueView'
import Home from './components/Home'
import Settings from './components/Settings'
import Icon from './components/Icon'
import EpisodeDetail from './components/EpisodeDetail'

const TITLES = {
  home: 'Home',
  shows: 'Library',
  search: 'Search',
  queue: 'Up Next',
  settings: 'Settings',
}

async function recordBackgroundDownloads() {
  const res = await NativeAudio.consumeDownloads().catch(() => null)
  for (const d of (res && res.downloads) || []) {
    await store.putDownload(episodeIdFor(d.showId, d.guid), {
      episodeId: episodeIdFor(d.showId, d.guid),
      path: d.fileName,
      fileName: d.fileName,
      bytes: d.bytes,
      downloadedAt: new Date().toISOString(),
    })
  }
}

export default function App() {
  const [view, setView] = useState('home')
  const [playTick, setPlayTick] = useState(0)
  const [shows, setShows] = useState([])
  const [queue, setQueue] = useState([])
  const [downloadedIds, setDownloadedIds] = useState(new Set())
  const [nowPlaying, setNowPlaying] = useState(null) // {episode, showTitle, autoplay}
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('') // a short status line, clears itself
  useEffect(() => {
    if (!notice) return undefined
    const id = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(id)
  }, [notice])

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
    let running = false
    async function sync() {
      if (running) return
      running = true
      try {
        // The background checker may have found new episodes while we were away:
        // if so, refresh right now instead of waiting for the normal interval.
        const alerts = await NativeAudio.consumeFeedAlerts().catch(() => ({ count: 0 }))
        const res = await syncAll({ force: alerts.count > 0 })
        await applyNotificationActions()
        if (res) {
          refreshShows()
          refreshDownloads()
          refreshFeedWatchList()
        }
      } finally {
        running = false
      }
    }
    sync().then(() => {
      stageBackupSoon(8000)
      stageLibrarySoon(8000)
    })
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync()
      else {
        // Leaving the app: the page may be frozen soon, so stage the latest data now (backup + car screen).
        stageBackupSoon(0)
        stageLibrarySoon(0)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    // A notification button was pressed while the app was already open.
    const onAction = () => applyNotificationActions()
    window.addEventListener('notificationaction', onAction)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('notificationaction', onAction)
    }
  }, [refreshShows, refreshDownloads])

  // Downloads finish in the background: refresh the "downloaded" badges when they do.
  // On start, remove half-written files and apply the storage cap.
  useEffect(() => {
    const off = onCompleted(() => refreshDownloads())
    // Record files the background worker downloaded first, or cleanup would delete them as orphans.
    recordBackgroundDownloads().then(() => cleanupOrphans()).then(() => enforceCap()).then(() => refreshDownloads()).catch(() => {})
    return off
  }, [refreshDownloads])

  // Keep the background checker's feed list current (new subscriptions, etc.).
  useEffect(() => {
    const id = setTimeout(refreshFeedWatchList, 1500)
    return () => clearTimeout(id)
  }, [shows])

  // A link shared to the app: resolve it to a feed and subscribe.
  async function applySharedLink(text) {
    const link = parseSharedLink(text)
    if (!link) {
      setError('That shared text has no podcast link in it.')
      return
    }
    if (link.kind === 'unsupported') {
      setError(`${link.host} links do not include the podcast's feed. Share the show's Apple Podcasts link or its RSS URL instead.`)
      return
    }
    setError('')
    setNotice('Subscribing…')
    try {
      const feedUrl = link.kind === 'apple' ? await api.lookupFeedUrl(link.id) : link.url
      const show = await api.subscribe(feedUrl)
      refreshShows()
      setView('shows')
      setNotice(show._isNew ? `Subscribed to ${show.title}.` : `You already follow ${show.title}.`)
    } catch (err) {
      setNotice('')
      setError(`Could not subscribe: ${err.message}`)
    }
  }

  // Buttons pressed on a new-episode notification: queue the episodes / play the newest.
  async function applyNotificationActions() {
    const act = await NativeAudio.consumePendingActions().catch(() => null)
    if (!act) return
    if (act.share) await applySharedLink(act.share)
    for (const { showId, guid } of act.queue || []) {
      const ep = await api.getEpisode(episodeIdFor(showId, guid)).catch(() => null)
      if (ep) await api.addToQueue(ep.id).catch(() => {})
    }
    if ((act.queue || []).length) refreshQueue()
    if (act.play) {
      const ep = await api.getEpisode(episodeIdFor(act.play.showId, act.play.guid)).catch(() => null)
      if (ep) playEpisode(ep, ep.show_title || '')
    }
  }

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

  async function playNext(episode) {
    await api.playNext(episode.id)
    refreshQueue()
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
    { id: 'home', label: 'Home', icon: 'home' },
    { id: 'shows', label: 'Library', icon: 'library' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'queue', label: 'Up Next', icon: 'queue' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ]

  return (
    <div className="app">
      <header className="app-header">
        <h1>{TITLES[view]}</h1>
      </header>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

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
          onPlayNext={playNext}
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
          onPlay={playEpisode}
          onToggleQueue={toggleQueue}
          onPlayNext={playNext}
          queueIds={new Set(queue.map((ep) => ep.id))}
        />
      )}
      {view === 'queue' && (
        <QueueView queue={queue} onPlay={playEpisode} onQueueChanged={refreshQueue} />
      )}

      <EpisodeDetail
        onPlay={playEpisode}
        onToggleQueue={toggleQueue}
        onPlayNext={playNext}
        queueIds={new Set(queue.map((ep) => ep.id))}
        downloadedIds={downloadedIds}
      />

      <Player
        nowPlaying={nowPlaying}
        queue={queue}
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
