import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { addListening, listListening, localDate } from '../src/mobile/store.js'

test('localDate is YYYY-MM-DD in local time', () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05')
  assert.equal(localDate(new Date(2026, 11, 31, 0, 0)), '2026-12-31')
})

test('addListening sums per day and show, and ignores empty amounts', async () => {
  await addListening('show_a', 60000, '2026-11-10')
  await addListening('show_a', 30000, '2026-11-10')
  await addListening('show_b', 10000, '2026-11-10')
  await addListening('show_a', 5000, '2026-11-11')
  await addListening('show_a', 0, '2026-11-11') // nothing to add
  await addListening('show_a', -5, '2026-11-11') // nonsense
  await addListening('', 5000, '2026-11-11') // no show
  const rows = await listListening()
  const find = (date, showId) => rows.find((r) => r.date === date && r.showId === showId)
  assert.equal(rows.length, 3)
  assert.equal(find('2026-11-10', 'show_a').ms, 90000)
  assert.equal(find('2026-11-10', 'show_b').ms, 10000)
  assert.equal(find('2026-11-11', 'show_a').ms, 5000)
})
