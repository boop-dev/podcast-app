# Podcast App

A personal, ad-free podcast player for Android. No ads, no tracking, no
accounts, no server: everything lives on the phone.

It is a React app wrapped in a Capacitor Android shell, with a native
Media3 ExoPlayer service for playback.

## Features

- **Subscribe** by RSS URL or by searching the Apple Podcasts directory; OPML
  import and export; full backup and restore (shows, positions, queue).
- **Player**: lock-screen and notification controls, headset and Bluetooth
  buttons, background playback that survives the WebView being frozen,
  resume position, -15s / +30s, speed (remembered per show), sleep timer
  (including end of episode), trim silence, voice boost.
- **Chapters and show notes** (Podcasting 2.0 chapters; tappable timestamps).
- **Queue** with reordering; the native service advances through it on its
  own.
- **Library**: new-episode badges, played / unplayed, search, sort, mark all
  played, unsubscribe, a Home tab with "continue listening".
- **Offline**: a download queue with progress, "download unplayed" per show,
  Wi-Fi-only auto-download for chosen shows, a storage limit that removes the
  oldest downloads, and a storage manager.
- **New-episode alerts** in the background (off by default).
- Light and dark themes that follow the system.

## Build and install

You need Node, Android Studio (for the SDK and JDK 21) and a phone with USB or
wireless debugging on. The full walkthrough is in
[WINDOWS-BUILD.md](WINDOWS-BUILD.md). The short version:

```
cd frontend
npm install --legacy-peer-deps
npm run install:phone     # builds the APK and installs it with adb
```

`npm run apk` builds only. Builds are signed with a local keystore
(`frontend/android/podcast-app.jks`, gitignored): keep it backed up, because
an APK signed with a different key cannot be installed over this one.

## Layout

```
frontend/
  src/
    App.jsx            tabs, Android back button, feed sync on open
    components/        Player (native), PlayerView, Shows, Home, Queue, ...
    mobile/            on-device data layer: IndexedDB store, RSS parsing,
                       downloads, OPML, feed sync
    lib/               native audio bridge, back handling, feed watch
  android/             Capacitor project
    app/src/main/java/dev/boop/podcastapp/
      AudioController  the ExoPlayer, position persistence, sleep timer
      PlaybackService  Media3 session: notification, lock screen, resumption
      NativeAudioPlugin  JS bridge
      FeedCheckWorker  background new-episode check
  scripts/
    apk.mjs            one-command build and install
    verify-mobile.mjs  data-layer checks (run: npm run verify)
```

## Tests

```
cd frontend && npm run verify
```

This exercises the on-device data layer (storage, feed parsing, queue,
chapters, backup and restore) in Node with a fake IndexedDB. The native
player is tested on a device.
