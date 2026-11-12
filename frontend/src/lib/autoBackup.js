/* Scheduled automatic backup, JS half.
 *
 * The data lives in IndexedDB, which the native background worker cannot read, so the app hands the
 * native side a fresh backup (the same JSON as "Back up now") whenever it is used. On schedule the
 * worker (BackupWorker.java) copies the latest staged backup into the folder the user picked. That
 * folder can be on a cloud drive, so the file reaches the cloud through that drive's own sync. */

import { api } from '../api'
import { NativeAudio } from './nativeAudio'

/** Build a backup and stage it for the worker. Does nothing if no backup folder is chosen. */
export async function stageBackupNow() {
  const s = await NativeAudio.getBackupSettings()
  if (!s.hasFolder) return false
  await NativeAudio.stageBackup({ json: JSON.stringify(await api.buildBackup()) })
  return true
}

let timer = null
/** Debounced: staging is cheap but there is no point doing it several times in a row. */
export function stageBackupSoon(delayMs = 5000) {
  clearTimeout(timer)
  timer = setTimeout(() => stageBackupNow().catch(() => {}), delayMs)
}
