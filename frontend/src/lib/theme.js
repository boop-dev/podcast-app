/* Light / dark / system theme preference, stored on the device. */

const KEY = 'theme'
export const THEMES = ['system', 'light', 'dark']

export function getTheme() {
  try {
    const v = localStorage.getItem(KEY)
    return THEMES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Sets data-theme on <html>; "system" removes it so the media query decides. */
export function applyTheme(theme = getTheme()) {
  const root = document.documentElement
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme)
  else root.removeAttribute('data-theme')
}

export function setTheme(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // storage unavailable: still apply for this session
  }
  applyTheme(theme)
}
