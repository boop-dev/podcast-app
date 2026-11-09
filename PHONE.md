# Run the app on your phone (Termux)

No hosting needed. The server runs on your phone inside Termux, and you
open it in Chrome. `localhost` counts as a secure origin, so the app
installs to your home screen like a normal app, with offline downloads.

## 1. Install Termux

Install Termux from F-Droid (`f-droid.org`, package `com.termux`).
Do not use the Play Store version: it is outdated and no longer updated.

## 2. Set up the app (once)

In Termux, run:

```
pkg update && pkg install python git -y
git clone https://github.com/boop-dev/podcast-app.git
cd podcast-app
pip install -r backend/requirements.txt
```

The frontend is prebuilt and committed (`frontend/dist`), so the phone
never needs Node or npm. Everything installed is pure Python.

## 3. Start it (every time you want to listen)

```
cd podcast-app
python backend/app.py
```

Leave Termux running. Open Chrome and go to `http://localhost:5001`,
then menu > Add to Home screen. It installs as an app icon.

## Keeping it running

Android can kill background apps. In Android Settings, turn off battery
optimization for Termux so the server stays alive while you listen.
If you want it to keep running with the screen off, install Termux:API
from F-Droid and run `termux-wake-lock` before starting the server.

## Notes

- Your subscriptions, playback positions, and queue live in
  `backend/podcasts.db` inside the Termux folder.
- To stop the server, go back to Termux and press Ctrl+C
  (Volume Down + C on the on-screen keyboard).
- The app is also reachable from other devices on the same Wi-Fi at
  `http://<your phone's IP address>:5001`.
