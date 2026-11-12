/* Settings: automatic backups to a folder the user picks (any folder the system picker offers,
 * including a cloud drive's). See lib/autoBackup.js and BackupWorker.java. */

import { useCallback, useEffect, useState } from 'react'
import { NativeAudio } from '../lib/nativeAudio'
import { stageBackupNow } from '../lib/autoBackup'
import Picker from './Picker'

function when(ms) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function AutoBackup() {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = useCallback(() => NativeAudio.getBackupSettings().then(setS).catch(() => {}), [])
  useEffect(() => {
    refresh()
  }, [refresh])

  async function pick() {
    setMsg('')
    try {
      setS(await NativeAudio.pickBackupFolder())
      await stageBackupNow().catch(() => {})
    } catch (err) {
      if (err && err.message !== 'cancelled') setMsg(`Could not use that folder: ${err.message}`)
    }
  }

  async function save(next) {
    setS(await NativeAudio.setBackupSettings({ enabled: s.enabled, intervalDays: s.intervalDays, ...next }))
  }

  async function backupNow() {
    setBusy(true)
    setMsg('Backing up…')
    try {
      await stageBackupNow()
      await NativeAudio.runBackupNow()
      // The worker runs in the background: look at the result a few seconds later.
      await new Promise((r) => setTimeout(r, 4000))
      const next = await NativeAudio.getBackupSettings()
      setS(next)
      setMsg(next.lastError ? '' : 'Backup saved to the folder.')
    } catch (err) {
      setMsg(`Backup failed: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function forget() {
    if (!window.confirm('Stop automatic backups? Backups already in the folder are kept.')) return
    setS(await NativeAudio.clearBackupFolder())
    setMsg('')
  }

  if (!s) return null
  return (
    <>
      <h2 className="section">Automatic backup</h2>
      {!s.hasFolder ? (
        <>
          <p className="muted">
            Saves a backup file to a folder you choose on a schedule, keeping the newest 7. Pick a folder inside a
            cloud drive (Google Drive, Dropbox, OneDrive…) and it is copied off the phone for you.
          </p>
          <button className="pill primary" onClick={pick}>Choose backup folder</button>
        </>
      ) : (
        <>
          <label className="setting-row">
            <span>
              Back up automatically
              <small>Folder: {s.folderName}</small>
            </span>
            <input type="checkbox" checked={s.enabled} onChange={() => save({ enabled: !s.enabled })} />
          </label>
          {s.enabled && (
            <div className="setting-row">
              <span>Every</span>
              <Picker title="Back up every" value={s.intervalDays} onChange={(v) => save({ intervalDays: Number(v) })}
                options={[{ value: 1, label: 'Day' }, { value: 3, label: '3 days' }, { value: 7, label: 'Week' }]} />
            </div>
          )}
          <p className="muted">
            {s.lastError
              ? `Last attempt failed: ${s.lastError}`
              : s.lastOkAt
                ? `Last backup: ${when(s.lastOkAt)}`
                : 'No backup made yet.'}
            {s.stagedAt ? ` The app prepared the data at ${when(s.stagedAt)}; backups reflect your last time in the app.` : ''}
          </p>
          <div className="chip-row">
            <button className="pill primary" onClick={backupNow} disabled={busy}>Back up now</button>
            <button className="pill" onClick={pick}>Change folder</button>
            <button className="pill danger" onClick={forget}>Stop</button>
          </div>
        </>
      )}
      {msg && <p className="muted">{msg}</p>}
    </>
  )
}
