import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FETCH_MAX_CHARS } from './constants.mjs'

const here = dirname(fileURLToPath(import.meta.url))

export function loadTasks(domain) {
  const key = String(domain || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '')
  try {
    return JSON.parse(readFileSync(join(here, 'tasks', `${key}.json`), 'utf8'))
  } catch {
    return null
  }
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n')
    .trim()
    .slice(0, FETCH_MAX_CHARS)
}

export function linksIn(text) {
  return [...String(text || '').matchAll(/https:\/\/[^\s)>"']+/g)].map((match) =>
    match[0].replace(/[.,;]+$/, '')
  )
}

export function looksLikeRefusal(text) {
  return /\b(cannot|can't|can not|unable|not available|don't know|do not know|not published|no information|login required)\b/i.test(
    String(text || '')
  )
}
