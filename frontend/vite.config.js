import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  // `npm run build:mobile` (mode=mobile) or CAPACITOR_BUILD=true:
  // the native shell serves a local bundle, so the PWA service worker
  // is left out — it would only intercept local requests, and offline
  // audio on native comes from real files instead (see
  // src/mobile/downloads.js). The `virtual:pwa-register` import in
  // main.jsx is aliased to a no-op stub so the mobile build resolves.
  const isCapacitorBuild = mode === 'mobile' || process.env.CAPACITOR_BUILD === 'true'

  return {
    plugins: [
      react(),
      ...(isCapacitorBuild
        ? []
        : [
            VitePWA({
              // Custom service worker (src/sw.js) so offline audio can be handled
              // by hand: the stock workbox audio caching does not do HTTP Range
              // requests, and a podcast player lives or dies by seeking.
              strategies: 'injectManifest',
              srcDir: 'src',
              filename: 'sw.js',
              registerType: 'autoUpdate',
              injectManifest: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
              },
              manifest: {
                name: 'Podcast App',
                short_name: 'Podcasts',
                description: 'A personal, ad-free podcast player.',
                start_url: '/',
                display: 'standalone',
                orientation: 'portrait',
                background_color: '#ffffff',
                theme_color: '#1a1a2e',
                icons: [
                  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                  { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
              },
            }),
          ]),
    ],
    resolve: isCapacitorBuild
      ? {
          alias: {
            'virtual:pwa-register': path.resolve(__dirname, 'src/pwa-register-stub.js'),
          },
        }
      : {},
    server: {
      // In dev, /api calls go to the Flask backend.
      proxy: {
        '/api': 'http://localhost:5001',
      },
    },
  }
})
