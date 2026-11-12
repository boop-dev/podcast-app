# Podcast app: notes for Claude

A standalone Android podcast player. React (Vite) UI in a Capacitor WebView, with a native Java audio
engine. There is no backend: everything is on the device. Package id `dev.boop.podcastapp`.
The to-do list is `ROADMAP.md` (tick items as they ship). `README.md` and `WINDOWS-BUILD.md` cover setup.

## Layout

- `frontend/src/` React app. `components/` screens, `lib/` helpers, `mobile/` on-device data layer.
- `frontend/src/mobile/store.js` IndexedDB via localforage (shows, episodes, positions, queue, downloads,
  settings, listening). Ids are FNV hashes: `episodeIdFor(showId, guid)`. The Java side re-implements that
  hash (`FeedCheckWorker.fnv`), so change both or neither.
- `frontend/src/mobile/api.js` the app's API (subscribe, refresh, queue, positions). `src/api.js` re-exports it.
- `frontend/android/app/src/main/java/dev/boop/podcastapp/` native code:
  - `AudioController` owns the single ExoPlayer: position persistence, queue auto-advance, sleep timer,
    ad-skip ranges, chapter titles in the notification, listening-time counting.
  - `PlaybackService` media session (notification, lock screen, headset buttons).
  - `NativeAudioPlugin` the Capacitor bridge. JS calls it as `NativeAudio.*` (`src/lib/nativeAudio.js`).
  - `FeedCheckWorker` / `FeedWatch` WorkManager background check for new episodes. It also posts
    notification buttons and downloads new episodes for auto-download shows.
  - `NotificationActionReceiver`, `MainActivity` notification Play / Add to queue handling.

## Key design rule

Playback lives in the native service because Chromium freezes the WebView in the background. Anything that
must keep working with the screen off (position saving, skipping, timers, counting) belongs in Java.
Native records what happened in SharedPreferences, and JS collects it with `NativeAudio.drain()` (and the
`consume*` plugin methods) when the page is awake. Follow that pattern for new background features.

## Commands (run from `frontend/`)

```
npm run build            # vite build only (fast type/syntax check of the JS)
npm run install:phone    # build debug APK and `adb install -r` it (keeps app data), then launches it
npm test                 # offline unit tests (frontend/test/*.test.mjs)
npm run progress         # ROADMAP.md progress
```

Quick Java compile check without a full APK, from `frontend/android/`:
`./gradlew --offline :app:compileDebugJavaWithJavac -q`. Gradle needs JDK 21: if it fails with "Unsupported class
file major version", set `JAVA_HOME` to the JDK 21 under `~/.jdks/jbr-21.0.11` first (`npm run install:phone` finds
it itself). A new dependency is not in the offline cache, so build once without `--offline`.

Tests: `npm test` runs the offline unit tests in `frontend/test/` (Node's built-in runner, `fake-indexeddb` for the
store; the release workflow runs it too). `node scripts/verify-mobile.mjs` is a larger data-layer check that needs the
network (Apple search, a real feed). There are no UI or native (Java) tests yet, so anything in Java or the player is
verified by a compile plus testing on the phone. Put new pure logic in `src/lib/` so it can be tested without a device.

## Testing on the phone

The owner uses wireless debugging, and the port changes every time it is toggled, so ask for the current
`IP:port` and run `adb connect <ip:port>`. `adb devices` showing nothing means it dropped. Then:

- Screenshot: `adb exec-out screencap -p > file.png` (save under the scratchpad), then read the image.
  The screen is 1008x2244. Tab bar is at y~2090 (Home x~100, Library 302, Search 504, Up Next 705, Settings 907).
- Tap/swipe/keys: `adb shell input tap x y`, `input swipe`, `input keyevent KEYCODE_MEDIA_PAUSE`.
- Notification shade: `adb shell cmd statusbar expand-notifications`. Its layout shifts as notifications arrive,
  so screenshot before every tap. `uiautomator dump` did not work here.
- `adb shell "run-as dev.boop.podcastapp ..."` reads app files (debug build), e.g. `shared_prefs/feed_watch.xml`,
  `files/`. A running app caches SharedPreferences, so force-stop it before editing a file from outside.
- To test tablet / wide layouts, make the phone pretend to be bigger: `adb shell wm size 1800x2400` and
  `adb shell wm density 280` (about 900dp wide), launch the app with `monkey` (do not tap blind: the Settings app
  may be in front, and Wireless debugging lives there). ALWAYS restore afterwards with `adb shell wm size reset`
  and `adb shell wm density 456` (the owner's own density override; `wm density` reports it). Screenshots at a
  fake size are bigger than 1008x2244, so check the "multiply by" note on the image before computing taps.
- To test the new-episode flow without waiting for a real episode, add a TEMPORARY hook in `FeedCheckWorker.checkFeed`
  that drops the newest known guid when a pref flag is set, install, set the flag, press Check now in Settings, then
  remove the hook and reinstall. Never commit the hook. This found a real bug once, so it is worth doing.

## How to work with this owner

- Commit locally when a piece is done. Push only when asked, and only after testing on the phone: they were
  unhappy when untested code was pushed. Say plainly what was and was not tested.
- Tick finished items in `ROADMAP.md`. Pick the next items from it when told to keep going.
- Prefer small, working slices over large unverified ones. Compile (`npm run build` + the Gradle command above)
  before installing.
- Leave the phone clean: remove any test hooks and test data you created, or tell them what is left behind.

## Gotchas

- Windows host. `.gitattributes` forces LF, so git warns about CRLF on edits. That is harmless.
- `FeedCheckWorker` and the JS `buildFeedList` must agree on the feed config shape (`autoDownload`, `known`).
- Background-downloaded files are recorded by the app on next open (`recordBackgroundDownloads` in `App.jsx`),
  and that must run before `cleanupOrphans`, or the files are deleted as orphans.
- Notification button presses made while the app is open reach JS through the `notificationaction` window event
  (`MainActivity.pokeJs`). Without it they wait until the next resume.
- ExoPlayer applies a metadata-only `replaceMediaItem` in place (used for the chapter title). The item carries a
  `refresh` extra so `onMediaItemTransition` ignores it.
- Automatic backup: JS stages a backup JSON into app storage (`NativeAudio.stageBackup`) whenever the app is used,
  and `BackupWorker` copies it to the folder the user picked (Storage Access Framework, so cloud drives work).
  Backups therefore reflect the last time the app was open. In git-bash, adb paths like `/sdcard/...` get mangled:
  prefix the command with `MSYS_NO_PATHCONV=1`.
- Home-screen widget (`PodcastWidget`): redrawn from `AudioController.notifyChange()` (debounced), reads state from the
  live player, or from the saved resume data when the process is new. Play / pause is a media-button broadcast to Media3's
  `MediaButtonReceiver` (so it also restarts the service after the process died); the skips use `WidgetActionReceiver`.
  To test the dead-process path use `adb shell am kill dev.boop.podcastapp`: `force-stop` replaces widgets with a grey
  loading placeholder, so taps then hit nothing. Add the widget from Settings > Home screen (launcher dialog), and
  remove it after testing (long-press > Remove).
- Android Auto: `PlaybackService` is a `MediaLibraryService`. The browse tree (Continue listening / Up next / Shows >
  episodes, plus search) is served from `files/library.json`, a snapshot the app stages (`lib/autoLibrary.js`,
  `LibrarySnapshot.java`) whenever it is used, so the car shows what the app knew the last time it was open. `onConnect`
  must grant `DEFAULT_SESSION_AND_LIBRARY_COMMANDS`, or Android Auto is refused at the root and spins forever.
  Testing without a car uses Google's Desktop Head Unit: `sdkmanager "extras;google;auto"` (needs JDK 21), then on the
  phone open Android Auto settings (`am start -n com.google.android.projection.gearhead/.companion.settings.DefaultSettingsActivity`),
  tap "Version" until "Allow development settings?" appears, then menu > Developer settings > tick "Unknown sources"
  (debug builds are hidden otherwise), then menu > "Start head unit server". Run `adb forward tcp:5277 tcp:5277`, then
  `(sleep 1200) | desktop-head-unit.exe` in the background (it exits at once without an open stdin). Tools cannot see
  the DHU window: capture it with PowerShell `CopyFromScreen` on its window rect and click with `SetCursorPos` +
  `mouse_event`. If Android Auto crashes with "Already connected", `am force-stop com.google.android.projection.gearhead`
  and start the server again. Afterwards untick Unknown sources and choose "Quit developer mode", and note the phone
  may be rotated (auto-rotate) so screenshots can be 2244x1008.
- `install:phone` kills the running app, so playback stops after each install.
- `versionCode` is the git commit count. After committing, an older debug APK on disk is a "downgrade" and
  `adb install -r` refuses it (`INSTALL_FAILED_VERSION_DOWNGRADE`): rebuild with `npm run install:phone`.
- `npm run release` builds the signed release APK. A release build is not debuggable, so `run-as` stops working
  on the phone: reinstall the debug build before testing again. Releases are cut by pushing a `vX.Y.Z` tag
  (see `.github/workflows/release.yml` and the README "Releases" section).
