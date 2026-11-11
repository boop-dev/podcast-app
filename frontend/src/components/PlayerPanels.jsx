/* Panels under the full-screen player: the chapter list and the show notes. */

import { useState } from 'react'
import { formatDuration } from './EpisodeRow'
import { currentChapter, splitTimestamps } from '../lib/notes'

export { currentChapter }

function ChapterThumb({ src }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span className="chapter-thumb placeholder" aria-hidden="true" />
  return <img className="chapter-thumb" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
}

export function ChapterList({ chapters, current, onSeek }) {
  const active = currentChapter(chapters, current)
  const hasImages = chapters.some((c) => c.image) // reserve the thumbnail column so titles line up
  return (
    <ul className="chapter-list">
      {chapters.map((c) => (
        <li key={c.start}>
          <button className={c === active ? 'active' : ''} onClick={() => onSeek(c.start)}>
            {hasImages && <ChapterThumb src={c.image} />}
            <span className="chapter-time">{formatDuration(c.start)}</span>
            <span className="chapter-title">{c.title || 'Untitled'}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** HTML show notes -> plain text, keeping paragraph/line breaks. */
export function htmlToText(html) {
  if (!html) return ''
  const prepared = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
  const doc = new DOMParser().parseFromString(prepared, 'text/html')
  return (doc.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function ShowNotes({ html, onSeek }) {
  const text = htmlToText(html)
  if (!text) return <p className="muted">No show notes for this episode.</p>
  return (
    <div className="show-notes">
      {text.split('\n').map((line, i) => (
        <p key={i}>
          {splitTimestamps(line).map((part, j) =>
            part.seconds === undefined ? (
              part.text
            ) : (
              <button key={j} className="timestamp" onClick={() => onSeek(part.seconds)}>
                {part.text}
              </button>
            ),
          )}
        </p>
      ))}
    </div>
  )
}
