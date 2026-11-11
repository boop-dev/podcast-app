/* Up Next: the queue, with reorder arrows and a menu per item
 * (play now, move to top / bottom, remove) and a clear-all button. */

import { useState } from 'react'
import { api } from '../api'
import Icon from './Icon'

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
