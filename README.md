# Podcast App

A personal, ad-free podcast player. No ads, no tracking, no accounts.
Everything lives in a local SQLite database, and the app installs on
Android as a PWA with offline listening.

## What v1 does

1. **Subscribe** by pasting an RSS feed URL, or by searching shows through
   the Apple Podcasts Search API (free, no key).
2. **Episode lists** per show: title, description, duration, publish date.
3. **Player**: play/pause, seek, speed 0.75x–2x, and playback position is
   remembered per episode, so it resumes where you left off.
4. **Queue / Up Next**, with reorder.
5. **Offline downloads**: episode audio is saved on the device and keeps
   playing (and seeking) with no connection.
6. **Sleep timer**: 5–60 minutes, or end of episode.
7. **OPML export** of subscriptions, so the list can move to another app.

What v1 does **not** do: detect or skip sponsor/ad segments inside the
audio. See "Possible later phases" below.

## Architecture

```
podcast-app/
  backend/            Flask + SQLite
    app.py            all API endpoints (see below)
    db.py             schema + connection
    requirements.txt
  frontend/           React + Vite
    src/
      App.jsx         tabs (Shows / Search / Queue) + player state
      api.js          backend client
      sw.js           service worker (offline audio + app shell)
      lib/downloads.js  Cache Storage helpers for offline episodes
      components/     Player, Shows, SearchView, QueueView, EpisodeRow
    public/icons/     PWA icons
```

**Backend** (`backend/app.py`): Flask, stdlib `sqlite3`, `feedparser`
for RSS. Tables: `shows`, `episodes`, `positions`, `queue`,
`downloads`. Notable endpoints:

- `GET /api/search?q=...` — proxies the Apple Search API, returns
  `feedUrl` per show.
- `POST /api/subscribe {feedUrl}` — fetches and parses the RSS feed.
- `GET /api/audio?url=...` — range-aware audio proxy. Podcast hosts
  often omit CORS headers and seeking needs HTTP Range, so the player
  never talks to the host directly; it talks to this proxy.
- `GET /api/opml` — OPML export.

When the frontend has been built (`frontend/dist` exists), the Flask
app serves it too, so one process runs the whole app.

**Frontend**: React 18 + Vite 5. The PWA is built with
`vite-plugin-pwa` in `injectManifest` mode, because the service
worker (`src/sw.js`) is custom: it precaches the app shell with
Workbox and handles `/api/audio` by hand. That hand-rolled part
matters — the Cache API stores whole responses, and an `<audio>`
element seeks with Range requests, so the worker slices cached bytes
and answers `206 Partial Content` itself. Only episodes you
explicitly download are put in the `podcast-episodes` cache.

## Run it locally

Requirements: Python 3.12+, Node 20+.

```bash
./run-dev.sh
```

That starts the backend on http://localhost:5001 and the frontend on
http://localhost:5173 (which proxies `/api` to the backend). Or run
each half by hand:

```bash
# backend
python3 -m venv backend/venv
backend/venv/bin/pip install -r backend/requirements.txt
backend/venv/bin/python backend/app.py        # http://localhost:5001

# frontend
cd frontend
npm install
npm run dev                                   # http://localhost:5173
```

To run the built app as one process (what the phone will use once
deployed):

```bash
cd frontend && npm run build
backend/venv/bin/python backend/app.py        # serves API + app on :5001
```

### Install on Android

Serve the built app over HTTPS (a PWA requirement for install +
service worker), open it in Chrome, then "Add to Home screen" /
"Install app". Episodes downloaded in the app are stored in Cache
Storage on the phone and play offline.

The database file is `backend/podcasts.db` (created on first run).
Override with the `PODCAST_DB` env var, e.g. for a scratch database
while testing: `PODCAST_DB=/tmp/test.db backend/venv/bin/python backend/app.py`.

## Verified

Built and checked 2026-11-08 against real feeds found through the
Apple Search API (no feed URLs guessed):

- **Stuff You Should Know** (`omnycontent.com` feed) subscribed:
  2,922 episodes, newest first, with durations and playable audio
  URLs. Audio proxy answered a `Range: bytes=0-1023` request with
  `206` and exactly 1,024 bytes.
- **Hidden Brain** (`feeds.simplecast.com/kwWc0lhf`) subscribed:
  633 episodes.
- Queue add, playback position save/get (123.5s round-tripped), and
  OPML export (both shows, correct feed URLs) all verified by curl.
- `npm run build` completes cleanly; the built app, manifest and
  service worker are all served by Flask.

## Possible later phases

- **Sponsor/ad segment skipping**: transcribe episodes (e.g. Whisper)
  and classify segments, then skip them at playback like STFUAI /
  Castria do. Needs a transcription + detection pipeline; deliberately
  out of v1.
- **Sync**: positions/queue across devices (needs an account or a
  sync service; out of scope for a local-first v1).
- **Chapters and transcripts** in the player.
- **Auto-download** of new episodes per show.
