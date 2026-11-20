const runs = new Map()

export function memoryRuns() {
  return {
    async get(id) {
      return runs.get(id) || null
    },
    async put(run) {
      runs.set(run.runId, run)
    },
  }
}

export function createRuns() {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return memoryRuns()
  return {
    async get(id) {
      const result = await command(url, token, ['GET', key(id)])
      return result ? JSON.parse(result) : null
    },
    async put(run) {
      await command(url, token, ['SET', key(run.runId), JSON.stringify(run), 'EX', '3600'])
    },
  }
}

function key(id) {
  return `eff:run:${id}`
}

async function command(url, token, args) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  })
  const body = await res.json()
  return body.result
}
