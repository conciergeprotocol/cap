import { parseHost } from '../check.mjs'

export { createDoor, createDoor as createFetcher } from './door.mjs'
export { loadTasks } from './pages.mjs'

export function hostOf(input) {
  const parsed = parseHost(input)
  return parsed.ok ? parsed.hostname : null
}
