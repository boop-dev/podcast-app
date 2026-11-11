/* A small download queue: bounded concurrency, progress, retry, de-duplication.
 * Pure logic with an injected `run` function, so it is testable in Node; the app
 * wires it to the Filesystem plugin in downloadManager.js.
 *
 * Job: { id, episode, status: 'queued'|'downloading'|'done'|'failed',
 *        bytes, total, error }
 */

export class DownloadQueue {
  /**
   * @param run   async (job, report) => {bytes}   does the transfer; call
   *              report(bytes, total) as it progresses. Throw to fail the job.
   * @param concurrency  how many transfers at once
   * @param onChange     called after any state change
   * @param onDone       called with the job after a successful transfer
   */
  constructor({ run, concurrency = 2, onChange = () => {}, onDone = () => {} }) {
    this.run = run
    this.concurrency = concurrency
    this.onChange = onChange
    this.onDone = onDone
    this.jobs = new Map()
    this.active = 0
    this.doneTimers = new Map()
  }

  snapshot() {
    return [...this.jobs.values()].map((j) => ({ ...j }))
  }

  has(id) {
    const j = this.jobs.get(id)
    return Boolean(j) && (j.status === 'queued' || j.status === 'downloading')
  }

  /** Queue one episode. Returns false if it is already queued or downloading. */
  add(episode) {
    if (this.has(episode.id)) return false
    this.jobs.set(episode.id, { id: episode.id, episode, status: 'queued', bytes: 0, total: 0, error: null })
    this.onChange()
    this.pump()
    return true
  }

  /** Queue several; returns how many were new. */
  addMany(episodes) {
    let added = 0
    for (const ep of episodes) {
      if (this.has(ep.id)) continue
      this.jobs.set(ep.id, { id: ep.id, episode: ep, status: 'queued', bytes: 0, total: 0, error: null })
      added++
    }
    if (added) {
      this.onChange()
      this.pump()
    }
    return added
  }

  /** Drop a job that has not started (or a finished / failed one). */
  remove(id) {
    const j = this.jobs.get(id)
    if (!j || j.status === 'downloading') return false
    this.jobs.delete(id)
    this.onChange()
    return true
  }

  /** Remove every job that has not started. Returns how many. */
  clearQueued() {
    let n = 0
    for (const [id, j] of this.jobs) {
      if (j.status === 'queued') {
        this.jobs.delete(id)
        n++
      }
    }
    if (n) this.onChange()
    return n
  }

  retry(id) {
    const j = this.jobs.get(id)
    if (!j || j.status !== 'failed') return false
    Object.assign(j, { status: 'queued', bytes: 0, total: 0, error: null })
    this.onChange()
    this.pump()
    return true
  }

  pump() {
    while (this.active < this.concurrency) {
      const next = [...this.jobs.values()].find((j) => j.status === 'queued')
      if (!next) return
      this.start(next)
    }
  }

  async start(job) {
    this.active++
    job.status = 'downloading'
    this.onChange()
    try {
      const { bytes } = await this.run(job, (received, total) => {
        job.bytes = received
        if (total) job.total = total
        this.onChange()
      })
      job.status = 'done'
      job.bytes = bytes || job.bytes
      this.onChange()
      this.onDone(job)
      // Leave the finished job visible briefly, then forget it.
      this.doneTimers.set(
        job.id,
        setTimeout(() => {
          if (this.jobs.get(job.id) === job && job.status === 'done') {
            this.jobs.delete(job.id)
            this.onChange()
          }
          this.doneTimers.delete(job.id)
        }, 1500),
      )
    } catch (err) {
      job.status = 'failed'
      job.error = String((err && err.message) || err)
      this.onChange()
    } finally {
      this.active--
      this.pump()
    }
  }
}
