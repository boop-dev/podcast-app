/* Pure helpers for the listening-stats screen (no React, no storage). */

const DAY = 24 * 60 * 60 * 1000

function dateKey(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "2h 05m" / "14 min" / "0 min" from milliseconds. */
export function formatListen(ms) {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`
}

/**
 * rows: [{date: 'YYYY-MM-DD', showId, ms}]. Returns totals for today / the last
 * 7 and 30 days / all time, the last 7 days one by one (oldest first), and the
 * shows ranked by the last 30 days.
 */
export function summarize(rows, now = new Date()) {
  const todayKey = dateKey(now)
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY)
    days.push({ date: dateKey(d), label: d.toLocaleDateString(undefined, { weekday: 'short' }), ms: 0 })
  }
  const weekKeys = new Set(days.map((d) => d.date))
  const monthKeys = new Set()
  for (let i = 0; i < 30; i++) monthKeys.add(dateKey(new Date(now.getTime() - i * DAY)))

  let today = 0, week = 0, month = 0, total = 0
  const byShow = new Map()
  for (const r of rows) {
    total += r.ms
    if (r.date === todayKey) today += r.ms
    if (weekKeys.has(r.date)) {
      week += r.ms
      days.find((d) => d.date === r.date).ms += r.ms
    }
    if (monthKeys.has(r.date)) {
      month += r.ms
      byShow.set(r.showId, (byShow.get(r.showId) || 0) + r.ms)
    }
  }
  const shows = [...byShow.entries()].map(([showId, ms]) => ({ showId, ms })).sort((a, b) => b.ms - a.ms)
  return { today, week, month, total, days, shows }
}
