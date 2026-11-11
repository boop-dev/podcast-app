/* The app's download manager: a DownloadQueue wired to the Filesystem plugin,
 * with progress for the UI, size tracking, a storage cap and cleanup of
 * half-written files. See downloadQueue.js and storageCap.js for the logic. */

import { useSyncExternalStore } from 'react'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { api } from '../api.js'
import * as store from '../mobile/store.js'
import { FILE_PATTERN, downloadEpisodeNative, fileNameFor, localName, removeDownloadNative } from '../mobile/downloads.js'
import { DownloadQueue } from './downloadQueue.js'
import { pickEvictions } from './storageCap.js'
import { NativeAudio } from './nativeAudio.js'

const GB = 1024 * 1024 * 1024
const CAP_KEY = 'download-cap-gb'

// --- cap setting (0 = no cap; stored durably in IndexedDB) -------------------

export async function getCapGb() {
  return Number(await store.getSetting(CAP_KEY, 0)) || 0
}

export async function setCapGb(gb) {
  await store.setSetting(CAP_KEY, Number(gb) || 0)
}

// --- queue + UI state -------------------------------------------------------

const reports = new Map() // audio url -> report(bytes, total) for the running job
const subscribers = new Set()
const completedCallbacks = new Set()
let byId = new Map()
let flushTimer = null

function flush() {
  flushTimer = null
  byId = new Map(queue.snapshot().map((j) => [j.id, j]))
  subscribers.forEach((fn) => fn())
}

// Throttle UI updates: progress events arrive every ~100 ms per transfer.
function scheduleFlush() {
  if (!flushTimer) flushTimer = setTimeout(flush, 150)
}

async function runJob(job, report) {
  const episode = job.episode
  reports.set(episode.audio_url, report)
  try {
    const { bytes } = await downloadEpisodeNative(episode)
    await api.markDownloaded(episode.id)
    return { bytes }
  } catch (err) {
    // Do not leave a half-written file behind.
    await Filesystem.deleteFile({ path: fileNameFor(episode), directory: Directory.Data }).catch(() => {})
    await store.removeDownload(episode.id).catch(() => {})
    throw err
  } finally {
    reports.delete(episode.audio_url)
  }
}

const queue = new DownloadQueue({
  run: runJob,
  concurrency: 2,
  onChange: scheduleFlush,
  onDone: (job) => {
    completedCallbacks.forEach((cb) => cb(job))
    enforceCap().then((res) => {
      if (res.removed) completedCallbacks.forEach((cb) => cb(null)) // storage changed: refresh the UI
    })
  },
})

let progressHandle = null
function ensureProgressListener() {
  if (progressHandle) return
  progressHandle = Filesystem.addListener('progress', (status) => {
    const report = reports.get(status.url)
    if (report) report(status.bytes, status.contentLength)
  })
}

export function subscribe(fn) {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

/** All current jobs (queued, downloading, failed, and briefly done). */
export function getJobs() {
  return [...byId.values()]
}

/** React: every job. Re-renders on progress, so use it for a list, not per row. */
export function useDownloads() {
  const snap = useSyncExternalStore(subscribe, () => byId)
  return [...snap.values()]
}

/** React: one episode's job (undefined if none). A row only re-renders when its own job changes. */
export function useDownloadJob(id) {
  return useSyncExternalStore(subscribe, () => byId.get(id))
}

/** Call back when a download finishes (job) or storage changed (null). Returns an unsubscribe. */
export function onCompleted(cb) {
  completedCallbacks.add(cb)
  return () => completedCallbacks.delete(cb)
}

async function notDownloaded(episodes) {
  const out = []
  for (const ep of episodes) {
    const rec = await store.getDownload(ep.id)
    if (!(rec && rec.path)) out.push(ep)
  }
  return out
}

export async function enqueue(episode) {
  ensureProgressListener()
  const [fresh] = await notDownloaded([episode])
  return fresh ? queue.add(fresh) : false
}

/** Queue several episodes; returns how many were actually added. */
export async function enqueueMany(episodes) {
  ensureProgressListener()
  return queue.addMany(await notDownloaded(episodes))
}

export const removeJob = (id) => queue.remove(id)
export const retryJob = (id) => queue.retry(id)
export const clearQueued = () => queue.clearQueued()

// --- storage cap ------------------------------------------------------------

/** Delete old downloads until usage is under the cap (finished episodes first,
 *  never what is playing, queued or being downloaded). */
export async function enforceCap() {
  const gb = await getCapGb()
  if (!gb) return { removed: 0, freedBytes: 0 }
  const records = []
  for (const id of await store.listDownloadIds()) {
    const rec = await store.getDownload(id)
    if (!rec || !rec.path) continue
    let bytes = rec.bytes
    if (!bytes) { // missing or 0 (an earlier build could not measure it)
      try {
        bytes = Number((await Filesystem.stat({ path: localName(rec), directory: Directory.Data })).size) || 0
      } catch {
        bytes = 0
      }
      await store.putDownload(id, { ...rec, bytes })
    }
    const pos = await store.getPosition(id)
    records.push({ id, bytes, downloadedAt: rec.downloadedAt, completed: Boolean(pos && pos.completed) })
  }

  const protectedIds = [...(await store.getQueueOrder()), ...queue.snapshot().map((j) => j.id)]
  try {
    const now = await NativeAudio.getState()
    if (now.currentId) protectedIds.push(now.currentId)
  } catch {
    /* player not available */
  }

  const evict = pickEvictions(records, gb * GB, protectedIds)
  let freed = 0
  for (const id of evict) {
    const ep = await store.getEpisode(id)
    freed += (records.find((r) => r.id === id) || {}).bytes || 0
    if (ep) await removeDownloadNative(ep)
    else await store.removeDownload(id)
  }
  return { removed: evict.length, freedBytes: freed }
}

/** Delete episode audio files that have no record (left by an interrupted download). */
export async function cleanupOrphans() {
  if (queue.snapshot().some((j) => j.status === 'downloading')) return 0
  let names = []
  try {
    names = (await Filesystem.readdir({ path: '', directory: Directory.Data })).files.map((f) => f.name)
  } catch {
    return 0
  }
  const known = new Set()
  for (const id of await store.listDownloadIds()) {
    const rec = await store.getDownload(id)
    if (rec && rec.fileName) known.add(rec.fileName)
    if (rec && rec.path) known.add(localName(rec))
  }
  let removed = 0
  for (const name of names) {
    if (!FILE_PATTERN.test(name) || known.has(name)) continue
    await Filesystem.deleteFile({ path: name, directory: Directory.Data }).catch(() => {})
    removed++
  }
  return removed
}
