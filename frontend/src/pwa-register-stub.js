/* No-op stand-in for `virtual:pwa-register`, used only by the Capacitor
 * build where the VitePWA plugin is disabled (see vite.config.js).
 * main.jsx guards the call with isNativePlatform() anyway; this just
 * keeps the import resolvable so the mobile build succeeds. */

export function registerSW() {
  return () => {}
}

export default registerSW
