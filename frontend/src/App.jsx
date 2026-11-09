/* App shell: three tabs (Shows / Search / Queue) and the player bar.
 * The player state lives here so any view can start playback. */

import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import Player from './components/Player'
import Shows from './components/Shows'
import SearchView from './components/SearchView'
import QueueView from './components/QueueView'

export default function App() {
  const [view, setView] = useState('shows')
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

  function playEpisode(episode, showTitle = '') {
    setNowPlaying({ episode, showTitle, autoplay: true })
  }

  // When an episode ends, play the next queued episode, if any.
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>Podcasts</h1>
        <span className="muted">No ads · No tracking · No account</span>
      </header>

      <nav className="tabs">
        <button className={view === 'shows' ? 'active' : ''} onClick={() => setView('shows')}>
          Shows
        </button>
        <button className={view === 'search' ? 'active' : ''} onClick={() => setView('search')}>
          Search
        </button>
        <button className={view === 'queue' ? 'active' : ''} onClick={() => setView('queue')}>
          Up Next ({queue.length})
        </button>
      </nav>

      {error && <div className="error">{error}</div>}

      {view === 'shows' && (
        <Shows
          shows={shows}
          onPlay={playEpisode}
          queueIds={new Set(queue.map((ep) => ep.id))}
          onToggleQueue={toggleQueue}
          downloadedIds={downloadedIds}
          onDownloadChanged={refreshDownloads}
          onRefresh={refreshShows}
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
        episode={nowPlaying?.episode || null}
        showTitle={nowPlaying?.showTitle || ''}
        autoplay={nowPlaying?.autoplay || false}
        onEnded={handleEnded}
      />
    </div>
  )
}
