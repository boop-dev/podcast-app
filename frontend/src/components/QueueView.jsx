/* Queue tab: the Up Next list, with move-up / move-down / remove. */

import { api } from '../api'
import Icon from './Icon'

export default function QueueView({ queue, onPlay, onQueueChanged }) {
  async function move(episodeId, direction) {
    const ids = queue.map((ep) => ep.id)
    const i = ids.indexOf(episodeId)
    const j = i + direction
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await api.reorderQueue(ids)
    onQueueChanged()
  }

  async function remove(episodeId) {
    await api.removeFromQueue(episodeId)
    onQueueChanged()
  }

  if (queue.length === 0) {
    return (
      <div className="empty">
        Your queue is empty. Add episodes from any show with the + button.
      </div>
    )
  }

  return (
    <div>
      {queue.map((ep, i) => (
        <div key={ep.id} className="card list-row">
          <button className="row-main" onClick={() => onPlay(ep, ep.show_title)}>
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
          <button className="icon-btn" onClick={() => remove(ep.id)} aria-label="Remove">
            <Icon name="trash" size={20} />
          </button>
        </div>
      ))}
    </div>
  )
}
