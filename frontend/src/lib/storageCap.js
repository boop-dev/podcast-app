/* Which downloads to delete to stay under a storage cap. Pure, testable in Node.
 *
 * Order: episodes you have already finished first, oldest download first; then
 * everything else, oldest download first. Anything protected (playing now,
 * queued, or just downloaded) is never chosen, so if only protected files are
 * left the result may still be over the cap. */

export const CAP_OPTIONS_GB = [0, 1, 2, 5, 10, 20] // 0 = no cap

/**
 * @param records  [{id, bytes, downloadedAt (ISO string or ms), completed}]
 * @param capBytes cap in bytes; 0 or less means no cap
 * @param protectedIds ids that must be kept
 * @returns ids to delete, in deletion order
 */
export function pickEvictions(records, capBytes, protectedIds = []) {
  if (!(capBytes > 0)) return []
  const keep = new Set(protectedIds)
  let total = records.reduce((n, r) => n + (r.bytes || 0), 0)
  if (total <= capBytes) return []

  const time = (r) => (typeof r.downloadedAt === 'number' ? r.downloadedAt : Date.parse(r.downloadedAt) || 0)
  const candidates = records
    .filter((r) => !keep.has(r.id))
    .sort((a, b) => Number(Boolean(b.completed)) - Number(Boolean(a.completed)) || time(a) - time(b))

  const out = []
  for (const r of candidates) {
    if (total <= capBytes) break
    out.push(r.id)
    total -= r.bytes || 0
  }
  return out
}

export function formatBytes(n) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
