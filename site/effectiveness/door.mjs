import { pinnedRequest, resolvePublic, sameSite } from '../check.mjs'
import { siteKey } from '../readiness-store.mjs'
import { readRpc } from '../rpc.mjs'
import { FETCH_MAX_CHARS, USER_AGENT } from './constants.mjs'
import { htmlToText } from './pages.mjs'
import {
  a2aGetRequest,
  a2aSendRequest,
  a2aTarget,
  httpsEndpoint,
  lineValue,
  mcpCallBody,
  mcpInitBody,
  mcpListBody,
  mcpText,
  pickTool,
  poppyEndpoint,
  readA2a,
  toolArguments,
  ucpMcpEndpoint,
} from './protocols.mjs'

const FROM = 'agent:cap-effectiveness'
const NO_DOOR = 'No CAP, A2A, or MCP endpoint was found.'

export function createDoor(domain, deps = {}) {
  const request = deps.request || pinnedRequest
  const resolve = deps.resolve || resolvePublic
  const pauseMs = deps.pauseMs ?? 1500
  const pages = []
  const dead = new Set()
  let door = null

  async function discover() {
    if (door) return door
    const list = []
    const agent = await fetchUrl(`https://${domain}/agent.txt`)
    const agentText = agent.error ? '' : String(agent.raw || agent.text || '')
    await add(list, httpsEndpoint(lineValue(agentText, 'cap')), { protocol: 'cap' })

    const poppy = await getJson(`https://${domain}/.well-known/poppy.json`)
    await add(list, poppyEndpoint(poppy, ['cap', 'conciergeprotocol.org/cap']), { protocol: 'cap' })

    const card = await getJson(`https://${domain}/.well-known/agent-card.json`)
    const target = a2aTarget(card)
    if (target) await add(list, target.url, { protocol: 'a2a', binding: target.binding })
    await add(list, poppyEndpoint(poppy, ['a2a']), { protocol: 'a2a', binding: 'jsonrpc' })

    const mcpUrls = [
      httpsEndpoint(lineValue(agentText, 'mcp')),
      poppyEndpoint(poppy, ['mcp']),
      await mcpFromUcp(poppy),
    ]
    for (const url of mcpUrls) await add(list, url, { protocol: 'mcp', sessionId: '', tool: null })

    door = list.length ? { candidates: list } : { error: NO_DOOR }
    return door
  }

  async function add(list, endpoint, extra) {
    const resolved = await resolveEndpoint(endpoint)
    if (!resolved) return
    if (list.some((item) => item.protocol === extra.protocol && item.endpoint === resolved.endpoint)) return
    list.push({ ...extra, ...resolved })
  }

  async function resolveEndpoint(endpoint) {
    if (!endpoint) return null
    let target
    try {
      target = new URL(endpoint)
    } catch {
      return null
    }
    const resolved = await resolve(target.hostname)
    if (!resolved.ok) return null
    return { endpoint: target.href, addresses: resolved.addresses }
  }

  async function mcpFromUcp(poppy) {
    const profileUrl = poppyEndpoint(poppy, ['ucp'])
    if (!profileUrl) return ''
    return ucpMcpEndpoint(await getJson(profileUrl))
  }

  async function prepareMcp(candidate) {
    if (candidate.tool) return candidate
    let listed = await postJson(candidate, mcpListBody())
    let tools = listed.rpc?.result?.tools
    if (!Array.isArray(tools)) {
      const init = await postJson(candidate, mcpInitBody())
      const sessionId = headerOf(init.headers, 'mcp-session-id')
      if (sessionId) candidate.sessionId = sessionId
      await postJson(candidate, { jsonrpc: '2.0', method: 'notifications/initialized' })
      listed = await postJson(candidate, mcpListBody())
      tools = listed.rpc?.result?.tools
    }
    candidate.tool = pickTool(tools)
    return candidate.tool ? candidate : null
  }

  async function getPage(input) {
    return fetchUrl(input, { sameSiteOnly: true })
  }

  async function getJson(input) {
    const page = await fetchUrl(input, { sameSiteOnly: false })
    if (page.error || page.status !== 200) return null
    try {
      return JSON.parse(page.raw || '')
    } catch {
      return null
    }
  }

  async function fetchUrl(input, { sameSiteOnly = true } = {}) {
    let url
    try {
      url = new URL(input)
    } catch {
      return { error: 'Bad URL.' }
    }
    const key = siteKey(domain)
    for (let hop = 0; hop < 4; hop++) {
      if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
        return { error: 'Only https pages are fetched.' }
      }
      if (sameSiteOnly && !sameSite(url.hostname, key) && !sameSite(url.hostname, domain)) {
        return { error: 'That URL is off site.' }
      }
      const resolved = await resolve(url.hostname)
      if (!resolved.ok) return { error: resolved.detail }
      const res = await request({
        url: url.href,
        method: 'GET',
        addresses: resolved.addresses,
        timeoutMs: 12_000,
        maxBytes: 250_000,
        truncate: true,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json,text/plain' },
      })
      if (!res?.ok) return { error: res.detail || 'The page did not load.' }
      if (res.status >= 300 && res.status < 400) {
        const location = headerOf(res.headers, 'location')
        if (!location) return { error: 'The page redirected without a location.' }
        try {
          url = new URL(location, url)
        } catch {
          return { error: 'The redirect is not a URL.' }
        }
        url.hash = ''
        continue
      }
      const rawBody = String(res.body || '')
      const page = {
        url: url.href,
        status: res.status,
        text: htmlToText(rawBody),
        raw: rawBody.slice(0, FETCH_MAX_CHARS),
      }
      pages.push(page)
      return page
    }
    return { error: 'The page redirected too many times.' }
  }

  async function postJson(found, body, url = found.endpoint) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'user-agent': USER_AGENT,
    }
    if (found.sessionId) headers['mcp-session-id'] = found.sessionId
    const res = await request({
      url,
      method: 'POST',
      addresses: found.addresses,
      timeoutMs: 45_000,
      maxBytes: 80_000,
      truncate: true,
      headers,
      body: JSON.stringify(body),
    })
    if (!res?.ok) return { error: res?.detail || 'The endpoint did not answer.', status: 0, rpc: null, headers: {} }
    return {
      status: res.status,
      headers: res.headers || {},
      rpc: readRpc(res.body, headerOf(res.headers, 'content-type')),
      error: res.status >= 400 ? `HTTP ${res.status}` : '',
    }
  }

  async function callA2a(found, spec) {
    if (spec.method === 'GET') {
      const res = await request({
        url: spec.url,
        method: 'GET',
        addresses: found.addresses,
        timeoutMs: 45_000,
        maxBytes: 80_000,
        truncate: true,
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      })
      if (!res?.ok) return { error: res?.detail || 'The endpoint did not answer.', rpc: null }
      return { status: res.status, rpc: readRpc(res.body, headerOf(res.headers, 'content-type')), error: res.status >= 400 ? `HTTP ${res.status}` : '' }
    }
    return postJson(found, spec.body, spec.url)
  }

  async function ask(message) {
    const found = await discover()
    if (found.error) return { error: found.error, protocol: null }
    const started = Date.now()
    let last = { error: NO_DOOR, wallMs: 0 }
    for (const candidate of found.candidates) {
      const key = `${candidate.protocol} ${candidate.endpoint}`
      if (dead.has(key)) continue
      if (candidate.protocol === 'mcp' && !(await prepareMcp(candidate))) {
        dead.add(key)
        last = { error: 'The MCP server has no tool that answers a question.', protocol: null, wallMs: Date.now() - started }
        continue
      }
      const asked = candidate.protocol === 'cap'
        ? await askCap(candidate, message, started)
        : candidate.protocol === 'a2a'
          ? await askA2a(candidate, message, started)
          : await askMcp(candidate, message, started)
      if (asked.reply) return { ...asked, protocol: candidate.protocol }
      last = { ...asked, protocol: candidate.protocol }
      if (isHardMiss(asked)) dead.add(key)
    }
    return { ...last, wallMs: last.wallMs || Date.now() - started }
  }

  async function askCap(found, message, started) {
    const url = new URL('messages', found.endpoint.endsWith('/') ? found.endpoint : `${found.endpoint}/`)
    const sent = await request({
      url: url.href,
      method: 'POST',
      addresses: found.addresses,
      timeoutMs: 45_000,
      maxBytes: 80_000,
      truncate: true,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'cap-version': '1.0',
        'cap-from': FROM,
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({ message }),
    })
    if (!sent?.ok) return { error: sent?.detail || 'The door did not answer.', wallMs: Date.now() - started, status: 0 }
    let messageBody = parse(sent)
    const deadline = Date.now() + 25_000
    let polls = 0
    while (messageBody?.status === 'working' && messageBody.id && polls < 8 && Date.now() < deadline) {
      polls += 1
      if (pauseMs) await sleep(pauseMs)
      const next = await request({
        url: new URL(`messages/${encodeURIComponent(messageBody.id)}`, url).href,
        method: 'GET',
        addresses: found.addresses,
        timeoutMs: 8_000,
        maxBytes: 80_000,
        headers: {
          accept: 'application/json',
          'cap-version': '1.0',
          'cap-from': FROM,
          'user-agent': USER_AGENT,
        },
      })
      if (!next?.ok) break
      messageBody = parse(next)
    }
    const reply = typeof messageBody?.reply === 'string' ? messageBody.reply.trim() : ''
    if (!reply) {
      const why = messageBody?.error?.message || messageBody?.status || 'no reply'
      return { error: `The door did not finish: ${why}.`, wallMs: Date.now() - started, id: messageBody?.id || null, status: sent.status }
    }
    pages.push({ url: url.href, status: sent.status, text: reply })
    return { reply, id: messageBody.id || null, wallMs: Date.now() - started }
  }

  async function askA2a(found, message, started) {
    const target = { url: found.endpoint, binding: found.binding || 'jsonrpc' }
    const sent = await callA2a(found, a2aSendRequest(target, message))
    let parsed = readA2a(sent.rpc)
    const deadline = Date.now() + 25_000
    let polls = 0
    while (parsed.working && parsed.id && polls < 8 && Date.now() < deadline) {
      polls += 1
      if (pauseMs) await sleep(pauseMs)
      const next = await callA2a(found, a2aGetRequest(target, parsed.id))
      if (next.error && !next.rpc) break
      parsed = readA2a(next.rpc)
    }
    const reply = parsed.text?.trim() || ''
    if (parsed.working || !reply) {
      return {
        error: parsed.working ? 'The A2A task did not finish.' : (parsed.error || sent.error || 'The A2A endpoint returned no text.'),
        wallMs: Date.now() - started,
        id: parsed.id || null,
      }
    }
    pages.push({ url: found.endpoint, status: sent.status, text: reply })
    return { reply, id: parsed.id || null, wallMs: Date.now() - started }
  }

  async function askMcp(found, message, started) {
    const args = toolArguments(found.tool, message)
    if (!args) return { error: `The MCP tool ${found.tool?.name || ''} has no text argument.`, wallMs: Date.now() - started }
    const sent = await postJson(found, mcpCallBody(found.tool.name, args))
    const read = mcpText(sent.rpc?.result)
    if (read.error || !read.text) {
      return { error: read.error || sent.rpc?.error?.message || sent.error || 'The MCP tool returned no text.', wallMs: Date.now() - started, id: found.tool.name }
    }
    pages.push({ url: found.endpoint, status: sent.status, text: read.text })
    return { reply: read.text, id: found.tool.name, wallMs: Date.now() - started }
  }

  return { pages, getPage, ask, discover }
}

function parse(res) {
  try {
    return JSON.parse(res.body || '')
  } catch {
    return null
  }
}

function headerOf(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()]
  if (Array.isArray(value)) return value.join(', ')
  return value || ''
}

function isHardMiss(asked) {
  return [404, 405, 410, 501].includes(asked?.status)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
