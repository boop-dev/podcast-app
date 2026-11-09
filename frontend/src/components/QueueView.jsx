/* Queue tab: the Up Next list, with move-up / move-down / remove. */

import { api } from '../api'

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
        Your queue is empty. Add episodes from any show with “Add to queue”.
      </div>
    )
  }

  return (
    <div>
      {queue.map((ep, i) => (
        <div key={ep.id} className="card">
          <h3 style={{ margin: '0 0 4px' }}>
            {i + 1}. {ep.title}
          </h3>
          <div className="actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="primary" onClick={() => onPlay(ep)}>
              Play
            </button>
            <button onClick={() => move(ep.id, -1)} disabled={i === 0}>
              ↑ Up
            </button>
            <button onClick={() => move(ep.id, 1)} disabled={i === queue.length - 1}>
              ↓ Down
            </button>
            <button onClick={() => remove(ep.id)}>Remove</button>
          </div>
        </div>
      ))}
    </div>
  )
}
