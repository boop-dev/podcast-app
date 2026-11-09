import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
  ],
  server: {
    // In dev, /api calls go to the Flask backend.
    proxy: {
      '/api': 'http://localhost:5001',
    },
  },
})
