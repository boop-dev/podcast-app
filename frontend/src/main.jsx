import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'

// Install the service worker so the app works offline and can be
// added to the Android home screen — web only. Inside the Capacitor
// native shell the app is a local bundle, so there is no service
// worker: offline audio comes from real files instead (see
// src/mobile/downloads.js), and nothing needs intercepting.
if (!Capacitor.isNativePlatform()) {
  registerSW({ immediate: true })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
