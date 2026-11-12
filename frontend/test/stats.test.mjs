import test from 'node:test'
import assert from 'node:assert/strict'
import { formatListen, summarize } from '../src/lib/stats.js'

const MIN = 60 * 1000
const DAY = 24 * 60 * MIN
const key = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

test('formatListen rounds to minutes and switches to hours', () => {
  assert.equal(formatListen(0), '0 min')
  assert.equal(formatListen(29 * 1000), '0 min')
  assert.equal(formatListen(45 * 1000), '1 min')
  assert.equal(formatListen(59 * MIN), '59 min')
  assert.equal(formatListen(60 * MIN), '1h')
  assert.equal(formatListen(65 * MIN), '1h 05m')
})

test('summarize buckets by day and ranks shows over the last 30 days', () => {
  const now = new Date(2026, 10, 12, 12, 0, 0)
  const at = (daysAgo) => key(new Date(now.getTime() - daysAgo * DAY))
  const rows = [
    { date: at(0), showId: 'a', ms: 10 * MIN },
    { date: at(0), showId: 'b', ms: 5 * MIN },
    { date: at(1), showId: 'a', ms: 20 * MIN },
    { date: at(6), showId: 'b', ms: 30 * MIN }, // last day of the 7-day window
    { date: at(7), showId: 'b', ms: 40 * MIN }, // just outside the week, inside the month
    { date: at(29), showId: 'c', ms: 1 * MIN }, // last day of the 30-day window
    { date: at(30), showId: 'c', ms: 99 * MIN }, // outside the month, still counted in the total
  ]
  const s = summarize(rows, now)
  assert.equal(s.today, 15 * MIN)
  assert.equal(s.week, (10 + 5 + 20 + 30) * MIN)
  assert.equal(s.month, (10 + 5 + 20 + 30 + 40 + 1) * MIN)
  assert.equal(s.total, (10 + 5 + 20 + 30 + 40 + 1 + 99) * MIN)
  assert.equal(s.days.length, 7)
  assert.equal(s.days[6].date, at(0)) // oldest first, today last
  assert.equal(s.days[6].ms, 15 * MIN)
  assert.equal(s.days[0].ms, 30 * MIN)
  assert.deepEqual(s.shows.map((x) => x.showId), ['b', 'a', 'c']) // 75, 30, 1 minutes
})

test('summarize with no rows is all zeros', () => {
  const s = summarize([], new Date(2026, 10, 12))
  assert.equal(s.total, 0)
  assert.equal(s.week, 0)
  assert.deepEqual(s.shows, [])
  assert.equal(s.days.length, 7)
})
