/* Settings tab (native): storage manager + backup / restore. */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

function formatBytes(n) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function Settings({ onChanged }) {
  const [usage, setUsage] = useState(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(() => {
    api.storageUsage().then(setUsage).catch((err) => setMsg(err.message))
  }, [])
  useEffect(load, [load])

  async function run(label, fn) {
    setMsg(`${label}…`)
    try {
      setMsg(await fn())
    } catch (err) {
      setMsg(`${label} failed: ${err.message}`)
    }
    load()
    onChanged()
  }

  const deletePlayed = () =>
    run('Deleting played downloads', async () => {
      const r = await api.deleteDownloads({ onlyPlayed: true })
      return `Deleted ${r.removed} played download${r.removed === 1 ? '' : 's'}.`
    })

  const deleteShow = (row) =>
    run('Deleting downloads', async () => {
      if (!window.confirm(`Delete all ${row.count} downloads for ${row.title}?`)) return 'Cancelled.'
      const r = await api.deleteDownloads({ showId: row.showId })
      return `Deleted ${r.removed} download${r.removed === 1 ? '' : 's'}.`
    })

  const backup = () =>
    run('Backing up', async () => `Backup saved to ${await api.saveBackupToFile()}`)

  const restore = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    run('Restoring', async () => {
      const r = await api.restoreBackup(await file.text())
      return (
        `Restored ${r.shows} shows, ${r.positions} positions, ${r.queued} queued episodes.` +
        (r.failed.length ? ` ${r.failed.length} feeds could not be reached.` : '')
      )
    })
  }

  return (
    <div>
      <h2 className="section">Downloads</h2>
      {usage === null ? (
        <p className="muted">Measuring…</p>
      ) : usage.rows.length === 0 ? (
        <p className="muted">No downloaded episodes.</p>
      ) : (
        <>
          <p className="muted">Using {formatBytes(usage.total)}</p>
          {usage.rows.map((row) => (
            <div key={row.showId} className="card list-row">
              <span className="row-text" style={{ flex: 1 }}>
                <span className="row-title">{row.title}</span>
                <span className="muted">
                  {row.count} episode{row.count === 1 ? '' : 's'} · {formatBytes(row.bytes)}
                </span>
              </span>
              <button className="pill" onClick={() => deleteShow(row)}>Delete</button>
            </div>
          ))}
          <button className="pill" onClick={deletePlayed}>Delete played downloads</button>
        </>
      )}

      <h2 className="section">Backup</h2>
      <p className="muted">
        Saves your shows, listening positions, played state and queue to a file in Documents. Restore it
        after reinstalling or on a new phone.
      </p>
      <button className="pill primary" onClick={backup}>Back up now</button>
      <p className="muted">
        Restore from backup: <input type="file" accept=".json,application/json" onChange={restore} />
      </p>
      {msg && <p className="muted">{msg}</p>}
    </div>
  )
}
