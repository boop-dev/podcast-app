# Roadmap

The checklist for this project. Tick items off as they ship (`[x]`).
Check progress any time:

```
cd frontend && npm run progress
```

Effort: **S** under an hour, **M** a session, **L** a multi-step project.

## Shipped

- [x] Subscribe by RSS URL or Apple Podcasts search
- [x] Standalone on-device app (IndexedDB, native HTTP, real-file downloads)
- [x] One-command USB/wireless build and install, stable signing key
- [x] Native Media3 ExoPlayer service (survives the frozen WebView)
- [x] Lock-screen and notification controls, headset and Bluetooth buttons
- [x] Playback resumption after the process is killed
- [x] Resume position, -15s / +30s skip, speed, sleep timer (incl. end of episode)
- [x] Per-show playback speed
- [x] Trim silence and voice boost
- [x] Chapters and show notes with tappable timestamps
- [x] Queue with reorder; native auto-advance
- [x] Played / unplayed, NEW badges, hide played
- [x] Foreground feed refresh on open
- [x] Background new-episode alerts (WorkManager)
- [x] Per-show Wi-Fi auto-download, deleted when played
- [x] Home tab with continue listening and new episodes
- [x] Episode search within a show, sort, mark all played, unsubscribe
- [x] OPML import / export, full backup / restore, storage manager
- [x] Bottom tab bar, artwork grid, mini + full-screen player, light/dark theme
- [x] Android back button (close sheet, leave show, minimize)
- [x] Android-only codebase (web, PWA, Flask, deploy files removed)

## Queue

- [x] Play next (insert at the front of the queue) — S
- [x] Move to top / move to bottom — S
- [x] Clear queue, with confirmation — S
- [x] Playing an episode from the queue removes it from the queue — S
- [ ] Swipe to remove — M

## Branding

- [x] Custom launcher icon (adaptive + legacy, round) — S
- [x] Custom splash screen — S
- [ ] Manual light / dark / system theme setting — S

## Ad skipping

Automatic in-episode ad removal is genuinely hard: host-read ads vary every
episode, and dynamically inserted ads differ per download, so shared
timestamps do not line up. The plan is to start with cheap, reliable helpers
and decide on detection only after a feasibility spike.

- [ ] Configurable long-skip button (e.g. +60s) in the player and notification — S
- [ ] Per-show skip intro / outro seconds — S
- [ ] Auto-skip chapters titled "Ad" / "Sponsor" when a feed marks them (opt-in) — S
- [ ] Manual "mark ad" while listening: remember skip ranges per episode — M
- [ ] Feasibility spike: on-device detection (repeated-segment fingerprinting
      per show, transcript keywords, chapter hints). Written findings + decision — M
- [ ] Implement the chosen detection, with an undo / "skipped an ad" indicator — L

## Listening

- [ ] Sleep timer: shake to extend, fade-out before pausing — S
- [ ] Finer speed control (0.05x steps) — S
- [ ] Buffering and error states in the player (spinner, message, retry) — S
- [ ] Chapter artwork in the player — S
- [ ] Current chapter in the lock-screen / notification card — M

## Library and discovery

- [ ] Per-show settings screen (speed, skip intro, auto-download, alerts) — M
- [ ] Search across all episodes — M
- [ ] Sort / filter by duration, downloaded, unplayed — S
- [ ] Search tab: mark already-subscribed shows, show description — S
- [ ] Episode detail page — M
- [ ] Share episode link — S
- [ ] Listening stats (time per show / week) — M

## Downloads

- [ ] Download all unplayed from a show — S
- [ ] Download progress display — M
- [ ] Storage cap (delete oldest past a limit) — S
- [ ] Download new episodes in the background — M

## Alerts and backup

- [ ] Notification actions: Play / Add to queue — M
- [ ] Alert check covers more than the newest 12 items — S
- [ ] Scheduled automatic backups to a cloud folder — M

## Platform

- [ ] Home-screen widget — L
- [ ] Android Auto — L
- [ ] Share target for podcast links — M
- [ ] Edge-to-edge insets and tablet layout — M

## Distribution and engineering

- [ ] Signed release build (not a debug APK) — M
- [ ] Human-readable versionName — S
- [ ] GitHub Actions release builds + Obtainium updates — M
- [ ] `.gitattributes` to stop line-ending noise — S
- [ ] Automated UI / native tests — L

## Still to validate (not new features)

- [ ] Chapters against a real feed that publishes them
- [ ] Streaming through network drops and long episodes
- [ ] Downloaded episodes through the native player
- [ ] Background alert timing over a full day of real use
