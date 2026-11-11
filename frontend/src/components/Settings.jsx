/* Settings tab (native): storage manager + backup / restore. */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { NativeAudio } from '../lib/nativeAudio'
import { configureFeedWatch } from '../lib/feedWatch'

function formatBytes(n) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function Settings({ onChanged }) {
  const [usage, setUsage] = useState(null)
  const [msg, setMsg] = useState('')
  const [options, setOptions] = useState({
    skipSilence: false,
    boost: false,
    skipBackSec: 15,
    skipForwardSec: 30,
    skipAheadSec: 60,
    skipAdChapters: false,
  })
  const [watch, setWatch] = useState({ enabled: false, intervalHours: 3 })

  useEffect(() => {
    NativeAudio.getFeedWatch()
      .then((s) => setWatch({ enabled: s.enabled, intervalHours: s.intervalHours }))
      .catch(() => {})
  }, [])

  async function toggleWatch() {
    if (!watch.enabled) {
      const { granted } = await NativeAudio.requestNotificationPermission()
      if (!granted) {
        setMsg('Allow notifications for Podcasts in Android settings to get new-episode alerts.')
        return
      }
    }
    const next = { ...watch, enabled: !watch.enabled }
    setWatch(next)
    configureFeedWatch(next).catch(() => setWatch(watch))
  }

  function changeInterval(hours) {
    const next = { ...watch, intervalHours: hours }
    setWatch(next)
    if (watch.enabled) configureFeedWatch(next).catch(() => {})
  }

  async function checkNow() {
    setMsg('Checking your feeds in the background. You will get a notification if anything is new.')
    await configureFeedWatch(watch).catch(() => {})
    NativeAudio.checkFeedsNow().catch(() => {})
  }

  useEffect(() => {
    NativeAudio.getOptions().then(setOptions).catch(() => {})
  }, [])

  function saveOptions(next) {
    setOptions(next)
    NativeAudio.setOptions(next)
      .then(() => window.dispatchEvent(new Event('podcast-options-changed')))
      .catch(() => setOptions(options))
  }

  const changeOption = (key) => saveOptions({ ...options, [key]: !options[key] })
  const changeNumber = (key, value) => saveOptions({ ...options, [key]: Number(value) })

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
      <h2 className="section">Playback</h2>
      <label className="setting-row">
        <span>
          Trim silence
          <small>Shortens long pauses in speech.</small>
        </span>
        <input type="checkbox" checked={options.skipSilence} onChange={() => changeOption('skipSilence')} />
      </label>
      <label className="setting-row">
        <span>
          Boost voices
          <small>Louder output for quiet recordings.</small>
        </span>
        <input type="checkbox" checked={options.boost} onChange={() => changeOption('boost')} />
      </label>

      <label className="setting-row">
        <span>
          Skip ad chapters
          <small>Auto-skips chapters a feed labels Ad or Sponsor. Undo shows after each skip.</small>
        </span>
        <input type="checkbox" checked={options.skipAdChapters} onChange={() => changeOption('skipAdChapters')} />
      </label>
      <div className="setting-row">
        <span>Skip back</span>
        <select value={options.skipBackSec} onChange={(e) => changeNumber('skipBackSec', e.target.value)}>
          {[5, 10, 15, 30].map((s) => <option key={s} value={s}>{s} s</option>)}
        </select>
      </div>
      <div className="setting-row">
        <span>Skip forward</span>
        <select value={options.skipForwardSec} onChange={(e) => changeNumber('skipForwardSec', e.target.value)}>
          {[15, 30, 45, 60].map((s) => <option key={s} value={s}>{s} s</option>)}
        </select>
      </div>
      <div className="setting-row">
        <span>
          Skip ahead button
          <small>The long jump in the player, for getting past an ad.</small>
        </span>
        <select value={options.skipAheadSec} onChange={(e) => changeNumber('skipAheadSec', e.target.value)}>
          {[30, 60, 90, 120, 180].map((s) => <option key={s} value={s}>{s} s</option>)}
        </select>
      </div>

      <h2 className="section">New episodes</h2>
      <label className="setting-row">
        <span>
          Alert me about new episodes
          <small>Checks your feeds in the background and sends a notification.</small>
        </span>
        <input type="checkbox" checked={watch.enabled} onChange={toggleWatch} />
      </label>
      {watch.enabled && (
        <div className="setting-row">
          <span>Check every</span>
          <select value={watch.intervalHours} onChange={(e) => changeInterval(Number(e.target.value))}>
            <option value={1}>hour</option>
            <option value={3}>3 hours</option>
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
          </select>
        </div>
      )}
      {watch.enabled && (
        <button className="pill" onClick={checkNow}>
          Check now
        </button>
      )}

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
