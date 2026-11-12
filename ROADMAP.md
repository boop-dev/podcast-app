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
- [x] Bundled modern typefaces (Inter for text, Plus Jakarta Sans for headings)
- [x] Compact show page: filter strip, sort, collapsible options panel
- [x] Styled picker sheets in place of native dropdowns; self-clearing notices
- [x] "On air" colour scheme: warm paper / warm charcoal with a tangerine accent, matching icon and splash

## Queue

- [x] Play next (insert at the front of the queue) — S
- [x] Move to top / move to bottom — S
- [x] Clear queue, with confirmation — S
- [x] Playing an episode from the queue removes it from the queue — S
- [x] Swipe to remove — M

## Branding

- [x] Custom launcher icon (adaptive + legacy, round) — S
- [x] Custom splash screen — S
- [x] Manual light / dark / system theme setting — S

## Ad skipping

Automatic in-episode ad removal is genuinely hard: host-read ads vary every
episode, and dynamically inserted ads differ per download, so shared
timestamps do not line up. The plan is to start with cheap, reliable helpers
and decide on detection only after a feasibility spike.

- [x] Configurable skip back / forward and a long-skip button in the player — S
- [x] Long-skip in the notification or as a headset gesture — S
- [x] Per-show skip intro / outro seconds — S
- [x] Auto-skip chapters titled "Ad" / "Sponsor" when a feed marks them (opt-in) — S
- [x] Manual "mark ad" while listening: remember skip ranges per episode — M
- [x] Feasibility spike: on-device detection (repeated-segment fingerprinting
      per show, transcript keywords, chapter hints). Findings and decision in
      docs/ad-detection-spike.md — M
- [ ] Implement "mark once, skip everywhere": fingerprint marked ads, skip the same audio in
      other episodes (downloaded first, then pre-roll on streams), suggest repeated clips,
      keep the Undo notice — L

## Listening

- [x] Sleep timer: shake to extend, fade-out before pausing — S
- [x] Finer speed control (0.05x steps) — S
- [x] Buffering and error states in the player (spinner, message, retry) — S
- [x] Chapter artwork in the player — S
- [x] Current chapter in the lock-screen / notification card — M

## Library and discovery

- [x] Per-show settings screen (speed, skip intro, auto-download, alerts) — M
- [x] Search across all episodes — M
- [x] Sort / filter by duration, downloaded, unplayed — S
- [x] Search tab: mark already-subscribed shows, show genre / episode count / latest release — S
- [x] Episode detail page — M
- [x] Share episode link — S
- [x] Listening stats (time per show / week) — M

## Downloads

- [x] Download all unplayed from a show — S
- [x] Download progress display — M
- [x] Storage cap (delete oldest past a limit) — S
- [x] Download new episodes in the background — M

## Alerts and backup

- [x] Notification actions: Play / Add to queue — M
- [x] Alert check covers more than the newest 12 items — S
- [x] Scheduled automatic backups to a cloud folder — M

## Platform

- [x] Home-screen widget — L
- [ ] Android Auto — L
- [x] Share target for podcast links — M
- [x] Edge-to-edge insets and tablet layout — M

## Distribution and engineering

- [x] Signed release build (not a debug APK) — M
- [x] Human-readable versionName — S
- [ ] GitHub Actions release builds + Obtainium updates — M (build, tests and signing verified by a manual run on 2026-11-12; still to prove: the tagged-release upload and an Obtainium update)
- [x] `.gitattributes` to stop line-ending noise — S
- [x] Offline unit tests for the pure logic (`npm test`, run in the release workflow) — S
- [ ] Automated UI / native (Java) tests — L

## Still to validate (not new features)

- [ ] Chapters against a real feed that publishes them
- [ ] Streaming through network drops and long episodes
- [x] Downloaded episodes through the native player
- [ ] Background alert timing over a full day of real use
