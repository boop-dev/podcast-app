/* Home tab (native): continue listening, then new episodes. */

import { useEffect, useState } from 'react'
import { api } from '../api'
import { formatDate } from './EpisodeRow'

export default function Home({ onPlay, refreshKey }) {
  const [resume, setResume] = useState([])
  const [fresh, setFresh] = useState([])

  useEffect(() => {
    api.listContinue().then(setResume).catch(() => {})
    api.listNew().then(setFresh).catch(() => {})
  }, [refreshKey])

  function Row({ ep, label }) {
    return (
      <div className="card home-row" onClick={() => onPlay(ep, ep.show_title)}>
        {ep.show_image && <img src={ep.show_image} alt="" />}
        <div>
          <h3>{ep.title}</h3>
          <p>
            {ep.show_title}
            {label ? ` · ${label}` : ''}
          </p>
        </div>
      </div>
    )
  }

  if (resume.length === 0 && fresh.length === 0) {
    return (
      <div className="empty">
        Nothing here yet. Episodes you start, and new episodes from your shows, will show up on this tab.
      </div>
    )
  }

  return (
    <div>
      {resume.length > 0 && <h2 className="section">Continue listening</h2>}
      {resume.map((ep) => (
        <Row key={ep.id} ep={ep} label={`${Math.round(ep.position_seconds / 60)} min in`} />
      ))}
      {fresh.length > 0 && <h2 className="section">New episodes</h2>}
      {fresh.map((ep) => (
        <Row key={ep.id} ep={ep} label={formatDate(ep.pub_date)} />
      ))}
    </div>
  )
}
