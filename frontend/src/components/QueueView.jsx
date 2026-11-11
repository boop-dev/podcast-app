/* Up Next: the queue, with reorder arrows and a menu per item
 * (play now, move to top / bottom, remove) and a clear-all button. */

import { useRef, useState } from 'react'
import { api } from '../api'
import Icon from './Icon'
import { shareEpisode } from '../lib/share'

const SWIPE_COMMIT_PX = 96 // drag left this far and let go to remove

/** Wraps a row so a left swipe slides it away and calls onSwipe. Vertical scrolling is untouched. */
function SwipeToRemove({ onSwipe, children }) {
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const drag = useRef(null) // {x, y, locked}
  const swiped = useRef(false) // a swipe must not also fire the row's tap

  function down(e) {
    if (leaving) return
    drag.current = { x: e.clientX, y: e.clientY, locked: false }
    swiped.current = false
  }
  function move(e) {
    const d = drag.current
    if (!d) return
    const mx = e.clientX - d.x
    const my = e.clientY - d.y
    if (!d.locked) {
      if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { drag.current = null; return } // a scroll
      if (Math.abs(mx) < 8) return
      d.locked = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    swiped.current = true
    setDx(Math.min(0, mx)) // only leftwards
  }
  function up() {
    const d = drag.current
    drag.current = null
    if (!d || !d.locked) return
    if (dx <= -SWIPE_COMMIT_PX) {
      setLeaving(true)
      setDx(-window.innerWidth)
      setTimeout(onSwipe, 180)
    } else {
      setDx(0)
    }
  }

  return (
    <div className="swipe-wrap">
      <div className="swipe-bg" aria-hidden="true"><Icon name="trash" size={20} /> Remove</div>
      <div
        className="swipe-fg"
        style={{ transform: `translateX(${dx}px)`, transition: drag.current && drag.current.locked ? 'none' : 'transform 0.18s ease' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(e) => { if (swiped.current) { e.stopPropagation(); e.preventDefault(); swiped.current = false } }}
      >
        {children}
      </div>
    </div>
  )
}

export default function QueueView({ queue, onPlay, onQueueChanged }) {
  const [menuFor, setMenuFor] = useState(null) // episode id whose menu is open

  async function move(episodeId, direction) {
    const ids = queue.map((ep) => ep.id)
    const i = ids.indexOf(episodeId)
    const j = i + direction
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await api.reorderQueue(ids)
    onQueueChanged()
  }

  async function moveTo(episodeId, where) {
    setMenuFor(null)
    await api.moveInQueue(episodeId, where)
    onQueueChanged()
  }

  async function remove(episodeId) {
    setMenuFor(null)
    await api.removeFromQueue(episodeId)
    onQueueChanged()
  }

  // Playing something from the queue takes it out of the queue.
  async function playNow(ep) {
    setMenuFor(null)
    await api.removeFromQueue(ep.id)
    onQueueChanged()
    onPlay(ep, ep.show_title)
  }

  async function clearAll() {
    if (!window.confirm(`Remove all ${queue.length} episodes from Up Next?`)) return
    setMenuFor(null)
    await api.clearQueue()
    onQueueChanged()
  }

  if (queue.length === 0) {
    return (
      <div className="empty">
        Your queue is empty. Use the + button on an episode to add it, or the play-next button to
        put it first.
      </div>
    )
  }

  return (
    <div>
      <div className="queue-header">
        <span className="muted">
          {queue.length} episode{queue.length === 1 ? '' : 's'}
        </span>
        <button className="pill" onClick={clearAll}>
          Clear queue
        </button>
      </div>

      {queue.map((ep, i) => (
        <div key={ep.id} className="card queue-item">
          <SwipeToRemove onSwipe={() => remove(ep.id)}>
          <div className="list-row" style={{ padding: 0 }}>
            <button className="row-main" onClick={() => playNow(ep)}>
              {ep.show_image ? <img src={ep.show_image} alt="" /> : <span className="art-empty thumb" />}
              <span className="row-text">
                <span className="row-title">{ep.title}</span>
                <span className="muted">{ep.show_title}</span>
              </span>
            </button>
            <button className="icon-btn" onClick={() => move(ep.id, -1)} disabled={i === 0} aria-label="Move up">
              <Icon name="up" size={20} />
            </button>
            <button
              className="icon-btn"
              onClick={() => move(ep.id, 1)}
              disabled={i === queue.length - 1}
              aria-label="Move down"
            >
              <Icon name="down" size={20} />
            </button>
            <button
              className={`icon-btn${menuFor === ep.id ? ' on' : ''}`}
              onClick={() => setMenuFor(menuFor === ep.id ? null : ep.id)}
              aria-label="More actions"
              aria-expanded={menuFor === ep.id}
            >
              <Icon name="more" size={20} />
            </button>
          </div>
          </SwipeToRemove>
          {menuFor === ep.id && (
            <div className="queue-menu" role="menu">
              <button role="menuitem" onClick={() => playNow(ep)}>
                <Icon name="play" size={16} /> Play now
              </button>
              <button role="menuitem" onClick={() => moveTo(ep.id, 'top')} disabled={i === 0}>
                <Icon name="top" size={16} /> Move to top
              </button>
              <button role="menuitem" onClick={() => moveTo(ep.id, 'bottom')} disabled={i === queue.length - 1}>
                <Icon name="bottom" size={16} /> Move to bottom
              </button>
              <button role="menuitem" onClick={() => { setMenuFor(null); shareEpisode(ep, ep.show_title) }}>
                <Icon name="share" size={16} /> Share
              </button>
              <button role="menuitem" className="danger" onClick={() => remove(ep.id)}>
                <Icon name="trash" size={16} /> Remove
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
