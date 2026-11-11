# Building the Android APK (Windows laptop)

This builds a standalone Podcast App APK from the same codebase as the
web app. No server needed: the APK talks directly to podcast feeds on
the phone. Do these steps on the Windows laptop.

> Steps verified end to end on the Windows laptop on 2026-11-09: the
> debug APK built successfully after updating Android Studio to a
> version supporting AGP 8.13.0 (see troubleshooting).

> The first build downloads Gradle and the Android build tools, so it
> takes a while (10–30 minutes on a slow connection). Later builds are
> much faster.

## 1. Install Android Studio

1. Download Android Studio from <https://developer.android.com/studio>
   and run the installer. It bundles everything the build needs: the
   JDK (Java) and the Android SDK. Do **not** install a separate JDK.
2. Open Android Studio once and let the first-run setup wizard finish.
   Accept the defaults: it installs the Android SDK, platform tools,
   and an emulator image. Wait until it says setup is complete.
3. If it asks about SDK updates, accept them.

## 2. Get the code

Open PowerShell or Command Prompt and run:

```powershell
git clone https://github.com/boop-dev/podcast-app.git
cd podcast-app\frontend
npm install
```

This installs the web dependencies plus Capacitor (the tool that wraps
the web app as an Android app). No other setup is needed.

## 3. Build the app for mobile and sync it into the Android project

From inside `podcast-app\frontend`, run:

```powershell
npm run build
npx cap sync
```

- `npm run build` compiles the React frontend into `dist\`.
- `npx cap sync` copies that build into the `android\` folder.

Whenever the app code changes later, repeat these two commands, then
rebuild the APK in Android Studio (step 4). You do **not** need to
re-run `npx cap add android` — the `android\` folder already exists.

## 4. Open the Android project and build the APK

1. In Android Studio: **File > Open** and select the
   `podcast-app\frontend\android` folder. (Open the `android` folder
   itself, not the repo root.)
2. Wait for the Gradle sync to finish — watch the progress bar at the
   bottom. The first sync downloads Gradle and dependencies; leave it
   alone until it reports no errors.
3. Menu: **Build > Build App Bundle(s) / APK(s) > Build APK(s)**.
4. When it finishes, a notification appears: **"APK(s) generated
   successfully"** — click **locate** to open the folder.

The debug APK lands at:

```
podcast-app\frontend\android\app\build\outputs\apk\debug\app-debug.apk
```

## 5. Copy the APK to the phone and install it

1. Copy `app-debug.apk` to the phone — USB cable (drag it into the
   phone's Downloads folder), or send it to yourself (Google Drive,
   email) and download it on the phone.
2. On the phone, open the APK file (Files app > Downloads, or tap the
   downloaded file in the notification).
3. Android will block it at first: tap **Settings** on the blocked
   prompt and turn on **"Allow from this source"** (install from
   unknown apps) for the app you opened it with (Files, Chrome, or
   Drive). Then go back and tap **Install**.
4. Open **Podcast App**. The first launch needs internet to search
   and fetch feeds.

## Fast path: one command, USB install

After the one-time setup above:

```powershell
cd frontend
npm run apk             # build only
npm run install:phone   # build, install over USB, launch
```

One-time phone setup: Settings > About phone > tap Build number 7 times,
then Developer options > turn on USB debugging, plug in, and accept the
"Allow USB debugging" prompt. `adb install -r` replaces the old app and
keeps its data, with no unknown-source prompts.

- `versionCode` is the git commit count, so each commit is a valid update.
- Builds are signed with `frontend/android/podcast-app.jks` (password in
  `keystore.properties`). Both are gitignored: **back them up**. A build
  signed with a different key will not install over this one.
- The script needs a JDK 21 (Capacitor 8). It looks in `~/.jdks`; set
  `JAVA_HOME_FOR_GRADLE` to use another.

## Notes

- **Your data lives on the phone.** Subscriptions, playback positions,
  queue, and downloads are stored inside the app on the device — there
  is no account and no server copy. Uninstalling the app deletes them.
  Use **Shows > Export subscriptions as OPML** before uninstalling or
  switching phones; it saves `podcast-subscriptions.opml` in the
  phone's Documents folder.
- **Updating the app:** after pulling new code (`git pull`), run
  `npm install` (only if dependencies changed), then
  `npm run build`, `npx cap sync`, and rebuild the APK in
  Android Studio. Install the new APK over the old one — your data
  stays.
- **Troubleshooting:**
  - *"The project is using an incompatible version (AGP 8.13.0)... Latest
    supported version is AGP 8.5.1":* your Android Studio is older than
    the project needs. AGP 8.13.0 requires Android Studio Narwhal 3
    Feature Drop (2025.1.3) or later. Update Android Studio via
    **Help > Check for Updates**, or download the latest from
    developer.android.com/studio, then reopen the project and build
    again. Do not downgrade the AGP version in the project: it targets
    API 36, which needs AGP 8.13.0.
  - *Gradle sync fails / SDK not found:* in Android Studio go to
    **File > Settings > Languages & Frameworks > Android SDK** and
    confirm an SDK platform is installed (API 34 or newer), then
    **File > Sync Project with Gradle Files**.
  - *Build complains about Java version:* make sure Android Studio is
    using its bundled JDK — **File > Settings > Build, Execution,
    Deployment > Build Tools > Gradle**, Gradle JDK should be the
    bundled one (JetBrains Runtime, version 17 or newer).
  - *"App not installed" on the phone:* uninstall the old version
    first, then install the new APK.
