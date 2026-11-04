import { waitUntil } from '@vercel/functions'
import { listDoors, needsRecheck, publicDoor, recheckAll } from '../site/doors.mjs'
import { getStore } from '../site/store.mjs'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('allow', 'GET')
    res.status(405).json({ error: { message: 'GET the directory.' } })
    return
  }
  try {
    const store = getStore()
    const doors = await listDoors(store)
    // Viewing the directory rechecks a few of the stalest doors in the background.
    if (doors.some((door) => needsRecheck(door))) {
      waitUntil(recheckAll(store, { limit: 5 }).catch((err) => console.warn('cap-recheck', err?.message || err)))
    }
    res.setHeader('cache-control', 'public, max-age=0, s-maxage=300')
    res.status(200).json({ doors: doors.map(publicDoor).map(({ lastChecks, lastDetail, ...door }) => door) })
  } catch {
    res.status(500).json({ error: { message: 'The directory could not be read.' } })
  }
}
