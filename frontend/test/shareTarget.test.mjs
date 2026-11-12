import test from 'node:test'
import assert from 'node:assert/strict'
import { extractUrl, parseSharedLink } from '../src/lib/shareTarget.js'

test('extractUrl finds the first link and trims trailing punctuation', () => {
  assert.equal(extractUrl('look https://example.com/a.rss, nice'), 'https://example.com/a.rss')
  assert.equal(extractUrl('(https://example.com/x)'), 'https://example.com/x')
  assert.equal(extractUrl('no link here'), null)
  assert.equal(extractUrl(''), null)
  assert.equal(extractUrl(null), null)
})

test('Apple Podcasts pages give the numeric id', () => {
  assert.deepEqual(parseSharedLink('https://podcasts.apple.com/us/podcast/rotten-mango/id1472761773'), {
    kind: 'apple',
    id: '1472761773',
  })
  assert.deepEqual(parseSharedLink('Listen! https://podcasts.apple.com/gb/podcast/x/id123?i=456 cool'), {
    kind: 'apple',
    id: '123',
  })
})

test('feed://, pcast:// and itpc:// become https feeds', () => {
  assert.deepEqual(parseSharedLink('feed://feeds.example.com/show.xml'), { kind: 'feed', url: 'https://feeds.example.com/show.xml' })
  assert.deepEqual(parseSharedLink('pcast://feeds.example.com/a'), { kind: 'feed', url: 'https://feeds.example.com/a' })
  assert.deepEqual(parseSharedLink('itpc://feeds.example.com/a'), { kind: 'feed', url: 'https://feeds.example.com/a' })
})

test('plain RSS links are kept, http stays http', () => {
  assert.deepEqual(parseSharedLink('http://feeds.example.com/a.rss'), { kind: 'feed', url: 'http://feeds.example.com/a.rss' })
  assert.deepEqual(parseSharedLink('https://feeds.megaphone.fm/ABC123).'), { kind: 'feed', url: 'https://feeds.megaphone.fm/ABC123' })
})

test('services that do not expose feeds are reported, not subscribed', () => {
  assert.deepEqual(parseSharedLink('https://open.spotify.com/show/xyz'), { kind: 'unsupported', host: 'open.spotify.com' })
  assert.equal(parseSharedLink('https://www.youtube.com/watch?v=1').kind, 'unsupported')
  assert.equal(parseSharedLink('https://podcasts.apple.com/us/browse').kind, 'unsupported') // an Apple page with no show id
})

test('text without a link gives null', () => {
  assert.equal(parseSharedLink('just words'), null)
})
