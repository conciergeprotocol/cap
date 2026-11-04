import { waitUntil } from '@vercel/functions'
import { parseHost } from '../site/check.mjs'
import { getDoor, needsRecheck, publicDoor, recheckDoor } from '../site/doors.mjs'
import { getStore } from '../site/store.mjs'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET')
    res.status(405).json({ error: { message: 'GET a domain.' } })
    return
  }
  const host = parseHost(new URL(req.url, 'http://localhost').searchParams.get('domain'))
  if (!host.ok) {
    res.status(400).json({ error: { message: host.detail } })
    return
  }
  try {
    const store = getStore()
    const door = await getDoor(store, host.hostname)
    res.setHeader('cache-control', 'public, max-age=0, s-maxage=60')
    if (!door) {
      res.status(404).json({ error: { message: `${host.hostname} is not in the directory.` } })
      return
    }
    // Viewing a door rechecks it in the background, at most once a day. The question goes out only when due.
    if (needsRecheck(door)) waitUntil(recheckDoor(store, door).catch((err) => console.warn('cap-recheck', err?.message || err)))
    res.status(200).json(publicDoor(door))
  } catch {
    res.status(500).json({ error: { message: 'The directory could not be read.' } })
  }
}
