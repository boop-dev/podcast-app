/* Listening stats: time played today / this week / this month, a 7-day bar
 * chart and the most-listened shows. Time is counted by the native player
 * while audio is actually playing (see AudioController.accumulateListening). */

import { useEffect, useState } from 'react'
import * as store from '../mobile/store'
import { formatListen, summarize } from '../lib/stats'

export default function ListeningStats() {
  const [stats, setStats] = useState(null)
  const [titles, setTitles] = useState({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [rows, shows] = await Promise.all([store.listListening(), store.listShows()])
      if (cancelled) return
      setStats(summarize(rows))
      setTitles(Object.fromEntries(shows.map((s) => [s.id, s.title])))
    }
    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!stats) return null
  const max = Math.max(...stats.days.map((d) => d.ms), 1)
  return (
    <>
      <h2 className="section">Listening</h2>
      {stats.total === 0 ? (
        <p className="muted">Nothing counted yet. Time is recorded while an episode plays.</p>
      ) : (
        <div className="card stats">
          <div className="stats-totals">
            <div><b>{formatListen(stats.today)}</b><span>Today</span></div>
            <div><b>{formatListen(stats.week)}</b><span>7 days</span></div>
            <div><b>{formatListen(stats.month)}</b><span>30 days</span></div>
          </div>
          <div className="stats-bars" aria-label="Last 7 days">
            {stats.days.map((d) => (
              <div key={d.date} className="stats-bar" title={`${d.label}: ${formatListen(d.ms)}`}>
                <span className="stats-fill" style={{ height: `${Math.max((d.ms / max) * 100, d.ms ? 4 : 0)}%` }} />
                <small>{d.label.slice(0, 2)}</small>
              </div>
            ))}
          </div>
          {stats.shows.slice(0, 5).map((s) => (
            <div key={s.showId} className="stats-show">
              <span className="row-title">{titles[s.showId] || 'Removed show'}</span>
              <span className="muted">{formatListen(s.ms)}</span>
            </div>
          ))}
          <p className="muted" style={{ margin: '8px 0 0' }}>All time: {formatListen(stats.total)}</p>
        </div>
      )}
    </>
  )
}
