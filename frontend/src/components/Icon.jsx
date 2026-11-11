/* Small inline icon set (24px, stroke-based) so the UI needs no icon font. */

const PATHS = {
  home: <path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10" />,
  library: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  queue: <path d="M4 6h16M4 12h10M4 18h7M17 15l4 3-4 3z" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  back15: (label = 15) => (
    <>
      <path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4" />
      <text x="12" y="15.5" fontSize={String(label).length > 2 ? 6 : 7.5} textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">{label}</text>
    </>
  ),
  fwd30: (label = 30) => (
    <>
      <path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4" />
      <text x="12" y="15.5" fontSize={String(label).length > 2 ? 6 : 7.5} textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">{label}</text>
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="19" r="2.6" />
      <path d="M8.3 10.8l7.4-4.3M8.3 13.2l7.4 4.3" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  retry: <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />,
  skipAhead: <path d="M5 5l7 7-7 7M13 5l7 7-7 7" />,
  download: <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />,
  downloaded: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l3 3 5-6" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  up: <path d="M12 19V6M6 11l6-6 6 6" />,
  down: <path d="M12 5v13M6 13l6 6 6-6" />,
  sort: <path d="M4 7h16M7 12h10M10 17h4" />,
  top: <path d="M5 4h14M12 20V8M6 13l6-6 6 6" />,
  bottom: <path d="M5 20h14M12 4v12M6 11l6 6 6-6" />,
  more: (
    <>
      <circle cx="12" cy="5" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" />
    </>
  ),
  playNext: (
    <>
      <path d="M4 6h10M4 12h6M4 18h6" />
      <path d="M15 11v8l6-4z" fill="currentColor" stroke="none" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
}

export default function Icon({ name, size = 22, className = '', label }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {typeof PATHS[name] === 'function' ? PATHS[name](label) : PATHS[name]}
    </svg>
  )
}
