import { readFileSync, writeFileSync } from 'node:fs'
import { VERSION, scoreSite } from './readiness.mjs'
import { withRun } from './readiness-store.mjs'

const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? null : args[at + 1]
}
const file = flag('--file')
const out = flag('--out')
const skip = new Set([file, out].filter(Boolean))
const list = [...new Set([...(file ? readDomains(file) : []), ...args.filter((arg) => !arg.startsWith('--') && !skip.has(arg))])]

if (!list.length) {
  console.error('Usage: node site/readiness-run.mjs [--file domains.txt|cohort.json] [--out edition.json] [domain...]')
  process.exit(1)
}

function readDomains(path) {
  const text = readFileSync(path, 'utf8')
  if (!path.endsWith('.json')) {
    return text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  }
  const found = []
  const walk = (value) => {
    if (typeof value === 'string') found.push(value)
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') {
      if (typeof value.domain === 'string') found.push(value.domain)
      else Object.values(value).forEach(walk)
    }
  }
  walk(JSON.parse(text))
  return found
}

const records = []
let cursor = 0

async function worker() {
  while (cursor < list.length) {
    const domain = list[cursor++]
    const started = Date.now()
    try {
      const result = await Promise.race([
        scoreSite(domain),
        new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'Timed out.' }), 70_000)),
      ])
      const seconds = Math.round((Date.now() - started) / 1000)
      if (!result.ok) {
        console.log(`${domain}\tERROR\t${seconds}s\t${result.error}`)
        continue
      }
      records.push(withRun(null, result))
      const bits = result.checks.map((check) => `${check.id}:${check.status}:${check.points}`).join(' ')
      console.log(`${domain}\t${result.blocked ? 'blocked ' + result.score + '/' + result.checkedMax : result.score}\t${seconds}s\t${bits}`)
    } catch (err) {
      console.log(`${domain}\tERROR\t${err?.message || err}`)
    }
  }
}

await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker))

if (out) {
  records.sort((a, b) => list.indexOf(a.domain) - list.indexOf(b.domain))
  const month = records[0]?.history[0]?.month || new Date().toISOString().slice(0, 7)
  writeFileSync(out, `${JSON.stringify({ month, methodology: VERSION, records }, null, 2)}\n`)
  console.log(`wrote ${records.length} of ${list.length} records for ${month} to ${out}`)
}
