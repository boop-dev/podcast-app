/* Thin client for the Flask backend. All calls are same-origin (/api),
 * proxied to the backend in dev and served by Flask in production. */

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${res.status}`)
  }
  return res.json()
}

export const api = {
  search: (q) => request(`/api/search?q=${encodeURIComponent(q)}`),
  subscribe: (feedUrl) =>
    request('/api/subscribe', { method: 'POST', body: JSON.stringify({ feedUrl }) }),
  listShows: () => request('/api/shows'),
  listEpisodes: (showId) => request(`/api/shows/${showId}/episodes`),
  refreshShow: (showId) =>
    request(`/api/shows/${showId}/refresh`, { method: 'POST' }),
  deleteShow: (showId) => request(`/api/shows/${showId}`, { method: 'DELETE' }),

  getPosition: (episodeId) => request(`/api/episodes/${episodeId}/position`),
  savePosition: (episodeId, position, duration, completed = false) =>
    request(`/api/episodes/${episodeId}/position`, {
      method: 'POST',
      body: JSON.stringify({ position, duration, completed }),
    }),

  listQueue: () => request('/api/queue'),
  addToQueue: (episodeId) =>
    request('/api/queue', { method: 'POST', body: JSON.stringify({ episodeId }) }),
  removeFromQueue: (episodeId) => request(`/api/queue/${episodeId}`, { method: 'DELETE' }),
  reorderQueue: (episodeIds) =>
    request('/api/queue/reorder', { method: 'POST', body: JSON.stringify({ episodeIds }) }),

  listDownloads: () => request('/api/downloads'),
  markDownloaded: (episodeId) =>
    request('/api/downloads', { method: 'POST', body: JSON.stringify({ episodeId }) }),
  unmarkDownloaded: (episodeId) =>
    request(`/api/downloads/${episodeId}`, { method: 'DELETE' }),
}

/** Audio goes through the backend proxy, which adds Range support and
 *  sidesteps CORS on podcast hosts that do not send CORS headers. */
export function audioUrl(episode) {
  return `/api/audio?url=${encodeURIComponent(episode.audio_url)}`
}
