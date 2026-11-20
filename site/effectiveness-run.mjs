import { runEffectiveness } from './effectiveness/run.mjs'
import { allowed } from './effectiveness/constants.mjs'
import { hostOf } from './effectiveness/fetch.mjs'
import { writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const out = outAt === -1 ? '' : args[outAt + 1]
const domain = args.find((arg) => !arg.startsWith('--') && arg !== out)

if (!domain) {
  console.error('Usage: node site/effectiveness-run.mjs cosmicjs.com [--out result.json]')
  process.exit(1)
}

const host = hostOf(domain)
if (!host || !allowed(host)) {
  console.error('That domain is not on the effectiveness allowlist.')
  process.exit(1)
}

const result = await runEffectiveness(host, { apiKey: process.env.ANTHROPIC_API_KEY })
const json = JSON.stringify(result, null, 2)
if (out) writeFileSync(out, `${json}\n`)
console.log(json)
