export const EFFECTIVENESS_VERSION = 1
export const RUBRIC_VERSION = 1
export const TASKSET_VERSION = '2026Q4'
export const SCHEMA_VERSION = 2

export const VISITOR_MODEL = process.env.EFFECTIVENESS_MODEL || 'claude-sonnet-4-5'
export const JUDGE_MODEL = process.env.EFFECTIVENESS_JUDGE_MODEL || VISITOR_MODEL
export const WALL_MS = 90_000
export const VISITOR_CEILING_USD = 0.5
export const FETCH_MAX_CHARS = 5000
export const USER_AGENT = 'CAP-Effectiveness/1.0 (+https://conciergeprotocol.org/effectiveness)'
export const CACHE_MS = 7 * 24 * 60 * 60 * 1000

export const ALLOWLIST = new Set(
  (process.env.EFFECTIVENESS_ALLOWLIST || 'cosmicjs.com,marlow.cosmic.site')
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/^www\./, ''))
    .filter(Boolean)
)

export function allowed(domain) {
  return ALLOWLIST.has(String(domain || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, ''))
}
