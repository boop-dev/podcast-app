// Prints progress from ROADMAP.md: checked vs total, per section and overall.
//   npm run progress
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'ROADMAP.md')
const lines = readFileSync(file, 'utf8').split(/\r?\n/)

const sections = []
let current = null
for (const line of lines) {
  const heading = line.match(/^## (.+)/)
  if (heading) {
    current = { name: heading[1], done: 0, total: 0, open: [] }
    sections.push(current)
    continue
  }
  const item = line.match(/^- \[([ xX])\] (.+)/)
  if (item && current) {
    current.total++
    if (item[1] === ' ') current.open.push(item[2].replace(/ — [SML]$/, ''))
    else current.done++
  }
}

const bar = (done, total, width = 20) => {
  const filled = total ? Math.round((done / total) * width) : 0
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

let done = 0
let total = 0
for (const s of sections) {
  if (!s.total) continue
  done += s.done
  total += s.total
  const pct = Math.round((s.done / s.total) * 100)
  console.log(`${s.name.padEnd(30)} ${bar(s.done, s.total)} ${String(s.done).padStart(2)}/${String(s.total).padEnd(2)} ${String(pct).padStart(3)}%`)
}
console.log('-'.repeat(66))
console.log(`${'Overall'.padEnd(30)} ${bar(done, total)} ${String(done).padStart(2)}/${String(total).padEnd(2)} ${String(Math.round((done / total) * 100)).padStart(3)}%`)

if (process.argv.includes('--open')) {
  console.log('\nOpen items:')
  for (const s of sections) for (const o of s.open) console.log(`  [${s.name}] ${o}`)
}
