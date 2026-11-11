import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app is a local bundle inside the Capacitor Android shell: no service
// worker, no PWA manifest, no dev server proxy.
export default defineConfig({
  plugins: [react()],
})
