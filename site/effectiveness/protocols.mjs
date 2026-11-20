const WRITE_TOOL = /(^|_)(create|checkout|update|delete|pay|purchase|refund|charge|cancel|book)(_|$)/i
const ARG_NAMES = ['query', 'question', 'message', 'prompt', 'text', 'q', 'search', 'input', 'request']
const WORKING = new Set(['submitted', 'working'])
const STOPPED = new Set(['failed', 'canceled', 'cancelled', 'rejected', 'auth-required', 'input-required'])

export function lineValue(text, name) {
  const line = String(text || '')
    .split('\n')
    .map((item) => item.trim())
    .find((item) => new RegExp(`^${name}:`, 'i').test(item))
  if (!line) return ''
  return line.replace(new RegExp(`^${name}:\\s*`, 'i'), '').trim()
}

export function httpsEndpoint(value) {
  if (!value || typeof value !== 'string') return ''
  try {
    const target = new URL(value)
    if (target.protocol !== 'https:' || target.username || target.password) return ''
    if (target.port && target.port !== '443') return ''
    return target.href
  } catch {
    return ''
  }
}

export function poppyEndpoint(doc, types) {
  const wanted = new Set(types.map((type) => type.toLowerCase()))
  const protocols = Array.isArray(doc?.agent?.protocols) ? doc.agent.protocols : []
  const entry = protocols.find((item) => wanted.has(String(item?.type || '').toLowerCase()) && typeof item?.endpoint === 'string')
  return httpsEndpoint(entry?.endpoint)
}

export function ucpMcpEndpoint(profile) {
  const services = Object.values(profile?.ucp?.services || {}).flat()
  const mcp = services.find((service) => service?.transport === 'mcp' && typeof service?.endpoint === 'string')
  return httpsEndpoint(mcp?.endpoint)
}

export function a2aTarget(card) {
  const interfaces = Array.isArray(card?.supportedInterfaces) ? card.supportedInterfaces : []
  const jsonrpc = interfaces.find((entry) => /jsonrpc/i.test(bindingOf(entry)) && httpsEndpoint(entry?.url))
  if (jsonrpc) return { url: httpsEndpoint(jsonrpc.url), binding: 'jsonrpc' }
  const advertised = httpsEndpoint(card?.url)
  if (advertised) return { url: advertised, binding: 'jsonrpc' }
  const http = interfaces.find((entry) => /http/i.test(bindingOf(entry)) && httpsEndpoint(entry?.url))
  if (http) return { url: httpsEndpoint(http.url), binding: 'http' }
  return null
}

export function a2aSendBody(message) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        role: 'user',
        messageId: `eff-${Date.now().toString(36)}`,
        parts: [{ kind: 'text', text: message }],
      },
      configuration: {
        acceptedOutputModes: ['text/plain', 'text/markdown'],
        returnImmediately: true,
      },
    },
  }
}

export function a2aGetBody(id) {
  return { jsonrpc: '2.0', id: 2, method: 'tasks/get', params: { id } }
}

export function a2aSendRequest(target, message) {
  const body = a2aSendBody(message)
  if (target.binding === 'http') return { url: appendPath(target.url, 'message:send'), method: 'POST', body: body.params }
  return { url: target.url, method: 'POST', body }
}

export function a2aGetRequest(target, id) {
  if (target.binding === 'http') return { url: appendPath(target.url, `tasks/${encodeURIComponent(id)}`), method: 'GET' }
  return { url: target.url, method: 'POST', body: a2aGetBody(id) }
}

export function readA2a(rpc) {
  if (!rpc || typeof rpc !== 'object') return { error: 'The A2A endpoint returned no result.' }
  if (rpc.error) return { error: rpc.error.message || 'The A2A endpoint returned an error.' }
  const result = rpc.result && typeof rpc.result === 'object' ? rpc.result : rpcPayload(rpc)
  if (!result) return { error: 'The A2A endpoint returned no result.' }
  const text = a2aText(result)
  const state = a2aState(result)
  const id = typeof result.id === 'string' ? result.id : null
  if (WORKING.has(state)) return { working: true, id, text }
  if (STOPPED.has(state) && !text) return { error: `The A2A task is ${state}.`, id }
  if (!text) {
    if (id) return { working: true, id, text: '' }
    return { error: 'The A2A endpoint returned no text.', id }
  }
  return { text, id, state }
}

export function isWriteTool(name) {
  return WRITE_TOOL.test(String(name || ''))
}

export function pickTool(tools) {
  const list = (Array.isArray(tools) ? tools : []).filter((tool) => typeof tool?.name === 'string' && !isWriteTool(tool.name))
  const ranked = list
    .map((tool) => ({ tool, rank: toolRank(tool.name) }))
    .filter((item) => item.rank < 9 && toolArguments(item.tool, 'x'))
    .sort((a, b) => a.rank - b.rank)
  return ranked[0]?.tool || null
}

export function toolArguments(tool, message) {
  const schema = tool?.inputSchema || tool?.input_schema || {}
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
  const names = Object.keys(props)
  const stringish = (name) => {
    const type = props[name]?.type
    return !type || type === 'string'
  }
  let key = ARG_NAMES.find((name) => names.includes(name) && stringish(name))
  if (!key) key = names.find((name) => stringish(name))
  if (!key && !names.length) key = 'query'
  if (!key) return null
  const args = { [key]: message }
  const required = Array.isArray(schema.required) ? schema.required : []
  for (const req of required) {
    if (req === key) continue
    if (props[req]?.default !== undefined) {
      args[req] = props[req].default
      continue
    }
    return null
  }
  return args
}

export function mcpListBody() {
  return { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }
}

export function mcpCallBody(name, args) {
  return { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }
}

export function mcpInitBody() {
  return {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'cap-effectiveness', version: '1.0' },
    },
  }
}

export function mcpText(result) {
  if (!result || typeof result !== 'object') return { error: 'The MCP tool returned no text.' }
  const text = (Array.isArray(result.content) ? result.content : [])
    .map((part) => (typeof part?.text === 'string' ? part.text.trim() : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
  if (result.isError) return { error: text || 'The MCP tool returned an error.' }
  if (text) return { text }
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return { text: JSON.stringify(result.structuredContent).slice(0, 4000) }
  }
  return { error: 'The MCP tool returned no text.' }
}

function bindingOf(entry) {
  return String(entry?.protocolBinding || entry?.protocol || '')
}

function appendPath(base, suffix) {
  const url = new URL(base)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${suffix}`
  return url.href
}

function rpcPayload(rpc) {
  if (rpc.kind || rpc.status || rpc.parts || rpc.artifacts) return rpc
  return null
}

function a2aState(result) {
  return String(result?.status?.state || '')
    .toLowerCase()
    .replace(/^task_state_/, '')
    .replace(/_/g, '-')
}

function a2aText(result) {
  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts.map((item) => textParts(item)).filter(Boolean).join('\n').trim() : ''
  if (artifacts) return artifacts
  const statusText = textParts(result?.status?.message)
  if (statusText) return statusText
  const own = textParts(result)
  if (own) return own
  const history = Array.isArray(result?.history) ? result.history : []
  const agent = [...history].reverse().find((item) => /agent/i.test(String(item?.role || '')))
  return textParts(agent)
}

function textParts(value) {
  const parts = Array.isArray(value?.parts) ? value.parts : []
  return parts
    .map((part) => {
      if (typeof part?.text === 'string' && part.text.trim()) return part.text.trim()
      if (part?.data && typeof part.data === 'object') return JSON.stringify(part.data).slice(0, 2000)
      return ''
    })
    .filter(Boolean)
    .join('\n')
    .trim()
}

function toolRank(name) {
  const normalized = name.toLowerCase()
  if (normalized === 'ask_business') return 0
  if (/ask|chat|query|question/.test(normalized)) return 1
  if (normalized === 'search_catalog' || normalized === 'search_shop_catalog') return 2
  if (/search|find|lookup/.test(normalized)) return 3
  return 9
}
