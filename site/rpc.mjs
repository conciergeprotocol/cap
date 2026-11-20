// Streamable HTTP servers can answer a single request as JSON or as one server-sent event.
export function readRpc(text, type) {
  const source = String(text || '')
  const body = /event-stream/i.test(type || '')
    ? source.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('')
    : source
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}
