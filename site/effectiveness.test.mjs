import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregate, quoteFound, scoreReply, scoreTask } from './effectiveness/score.mjs'
import { allowed } from './effectiveness/constants.mjs'
import { createDoor } from './effectiveness/door.mjs'
import { pickTool, readA2a, toolArguments } from './effectiveness/protocols.mjs'

test('a quote scores only when the page contains it', () => {
  const pages = [{ url: 'https://example.com', text: 'Plans start at forty dollars a month.' }]
  assert.equal(quoteFound('Plans start at forty dollars', pages), true)
  assert.equal(quoteFound('nine hundred euros', pages), false)
  assert.equal(quoteFound('short', pages), false)
})

test('unsupported claims score below an honest miss', () => {
  const wrong = scoreTask({
    status: 'found',
    claims: [{ text: 'It is free forever', quote: 'free forever unlimited', sourceUrl: 'https://example.com' }],
    pages: [{ text: 'Paid plans only.' }],
  })
  const absent = scoreTask({ status: 'not_available', claims: [], pages: [] })
  assert.equal(wrong.outcome, 'incorrect')
  assert.equal(wrong.score, 10)
  assert.equal(absent.outcome, 'absent')
  assert.equal(absent.score, 30)
  assert.ok(absent.score > wrong.score)
})

test('five scored tasks become an overall public score', () => {
  const tasks = [80, 70, 90, 60, 75].map((score) => ({ score, dims: { accuracy: 1, completeness: 1, completion: 1, actionability: 1, efficiency: 1 } }))
  const summary = aggregate(tasks)
  assert.equal(summary.score, 75)
  assert.equal(summary.scores.authenticated, null)
  assert.equal(summary.scores.overall, 75)
  assert.equal(summary.status, 'scored')
})

test('a door reply scores without a model', () => {
  const plain = scoreReply({
    reply: 'Cosmic lists Free and Pro plans. Sign up at https://www.cosmicjs.com/signup for a free project with API access on the pricing page.',
    links: [{ url: 'https://www.cosmicjs.com/signup', status: 200, onSite: true }],
    wallMs: 4000,
  })
  assert.equal(plain.outcome, 'answered')
  assert.ok(plain.score >= 70)
  assert.equal(plain.claims.length, 0)
})

test('an honest refusal scores above a missing reply', () => {
  const refused = scoreReply({ reply: 'That information is not available on this site.', wallMs: 2000 })
  const missing = scoreReply({ error: 'No CAP line in agent.txt.' })
  assert.equal(refused.outcome, 'absent')
  assert.equal(refused.score, 30)
  assert.equal(missing.score, 0)
})

test('the beta allowlist is cosmic and marlow', () => {
  assert.equal(allowed('www.cosmicjs.com'), true)
  assert.equal(allowed('marlow.cosmic.site'), true)
  assert.equal(allowed('example.com'), false)
})

test('an A2A task reply is the artifact text', () => {
  const working = readA2a({ result: { id: 't1', kind: 'task', status: { state: 'working' } } })
  assert.equal(working.working, true)
  assert.equal(working.id, 't1')
  const done = readA2a({
    result: {
      id: 't1',
      status: { state: 'completed' },
      artifacts: [{ parts: [{ kind: 'text', text: 'Hats from 12 dollars.' }] }],
    },
  })
  assert.equal(done.text, 'Hats from 12 dollars.')
})

test('mcp skips tools that change state and prefers a question tool', () => {
  const catalog = {
    name: 'search_catalog',
    inputSchema: { properties: { query: { type: 'string' } }, required: ['query'] },
  }
  const skipped = pickTool([
    { name: 'create_checkout', inputSchema: { properties: { query: { type: 'string' } } } },
    { name: 'get_cart' },
    catalog,
  ])
  assert.equal(skipped.name, 'search_catalog')
  assert.deepEqual(toolArguments(skipped, 'wool hats'), { query: 'wool hats' })
  const ask = pickTool([
    catalog,
    { name: 'ask_business', inputSchema: { properties: { question: { type: 'string' } } } },
  ])
  assert.equal(ask.name, 'ask_business')
  assert.deepEqual(toolArguments(ask, 'hi'), { question: 'hi' })
})

function scripted(files) {
  const calls = []
  const request = async (options) => {
    calls.push(options)
    const url = new URL(options.url)
    const key = `${options.method} ${url.host}${url.pathname}`
    const posted = files[key]
    if (options.method === 'POST' && posted) {
      const body = typeof posted === 'function' ? posted(options) : posted
      if (body.ok === false) return { ok: false, detail: body.detail || 'The host did not respond in time.' }
      return { ok: true, status: body.status || 200, headers: body.headers || { 'content-type': 'application/json' }, body: body.body }
    }
    if (options.method === 'POST') return { ok: false, detail: 'no endpoint' }
    const file = files[url.host + url.pathname] ?? (url.host === 'example.com' ? files[url.pathname] : undefined)
    if (!file) return { ok: true, status: 404, headers: { 'content-type': 'text/plain' }, body: '' }
    return { ok: true, status: file.status || 200, headers: file.headers || { 'content-type': 'text/plain' }, body: file.body }
  }
  return {
    calls,
    door: createDoor('example.com', {
      request,
      resolve: async () => ({ ok: true, addresses: ['8.8.8.8'] }),
      pauseMs: 0,
    }),
  }
}

const json = { 'content-type': 'application/json' }

test('a www redirect still finds the CAP door', async () => {
  const { door } = scripted({
    '/agent.txt': { status: 308, headers: { location: 'https://www.example.com/agent.txt' }, body: '' },
    'www.example.com/agent.txt': { body: 'Protocol: CAP/1.0\nCAP: https://www.example.com/cap/v1\n' },
    'POST www.example.com/cap/v1/messages': { body: JSON.stringify({ id: 'msg_abc12345', status: 'done', reply: 'We sell wool hats.' }) },
  })
  const asked = await door.ask('What do you sell?')
  assert.equal(asked.protocol, 'cap')
  assert.equal(asked.reply, 'We sell wool hats.')
})

test('a CAP door is used when it answers', async () => {
  const { door, calls } = scripted({
    '/agent.txt': { body: 'Protocol: CAP/1.0\nCAP: https://example.com/cap/v1\n' },
    '/.well-known/agent-card.json': { body: JSON.stringify({ name: 'Example', url: 'https://example.com/a2a' }), headers: json },
    'POST example.com/cap/v1/messages': { body: JSON.stringify({ id: 'msg_abc12345', status: 'done', reply: 'We sell wool hats.' }) },
  })
  const asked = await door.ask('What do you sell?')
  assert.equal(asked.protocol, 'cap')
  assert.equal(asked.reply, 'We sell wool hats.')
  assert.equal(calls.some((call) => call.url.includes('/a2a')), false)
})

test('one slow CAP reply does not retire the door', async () => {
  let posts = 0
  const { door } = scripted({
    '/agent.txt': { body: 'Protocol: CAP/1.0\nCAP: https://example.com/cap/v1\n' },
    'POST example.com/cap/v1/messages': () => {
      posts += 1
      if (posts === 1) return { ok: false, detail: 'The host did not respond in time.' }
      return { body: JSON.stringify({ id: 'msg_abc12345', status: 'done', reply: 'Create an account at https://example.com/signup.' }) }
    },
  })
  const first = await door.ask('What is the next step?')
  assert.equal(first.protocol, 'cap')
  assert.match(first.error, /did not respond/)
  const second = await door.ask('What is the next step?')
  assert.equal(second.protocol, 'cap')
  assert.match(second.reply, /signup/)
})

test('a silent CAP door falls through to A2A', async () => {
  const { door, calls } = scripted({
    '/agent.txt': { body: 'Protocol: CAP/1.0\nCAP: https://example.com/cap/v1\n' },
    '/.well-known/agent-card.json': { body: JSON.stringify({ name: 'Example', url: 'https://example.com/a2a' }), headers: json },
    'POST example.com/a2a': (options) => {
      const body = JSON.parse(options.body)
      if (body.method === 'message/send') {
        return { body: JSON.stringify({ jsonrpc: '2.0', id: 1, result: { id: 't1', kind: 'task', status: { state: 'working' } } }) }
      }
      assert.equal(body.method, 'tasks/get')
      assert.equal(body.params.id, 't1')
      return {
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          result: { id: 't1', status: { state: 'completed' }, artifacts: [{ parts: [{ kind: 'text', text: 'Wool hats, in stock.' }] }] },
        }),
      }
    },
  })
  const asked = await door.ask('What do you sell?')
  assert.equal(asked.protocol, 'a2a')
  assert.equal(asked.reply, 'Wool hats, in stock.')
  assert.equal(calls.filter((call) => call.method === 'POST' && call.url.includes('/a2a')).length, 2)
})

test('mcp is asked through a read tool when CAP and A2A are absent', async () => {
  const { door, calls } = scripted({
    '/.well-known/poppy.json': {
      body: JSON.stringify({ protocol_version: '0.4', agent: { protocols: [{ type: 'ucp', endpoint: 'https://example.com/.well-known/ucp' }] } }),
      headers: json,
    },
    '/.well-known/ucp': {
      body: JSON.stringify({ ucp: { services: { shop: [{ transport: 'mcp', endpoint: 'https://shop.example.net/mcp' }] } } }),
      headers: json,
    },
    'POST shop.example.net/mcp': (options) => {
      const body = JSON.parse(options.body)
      if (body.method === 'tools/list') {
        return {
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: {
              tools: [
                { name: 'create_checkout', inputSchema: { properties: { query: { type: 'string' } } } },
                { name: 'search_catalog', inputSchema: { properties: { query: { type: 'string' } }, required: ['query'] } },
              ],
            },
          }),
        }
      }
      assert.equal(body.method, 'tools/call')
      assert.equal(body.params.name, 'search_catalog')
      assert.deepEqual(body.params.arguments, { query: 'wool hats' })
      return { body: JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'Wool hats are 20 dollars.' }] } }) }
    },
  })
  const asked = await door.ask('wool hats')
  assert.equal(asked.protocol, 'mcp')
  assert.equal(asked.reply, 'Wool hats are 20 dollars.')
  assert.equal(calls.some((call) => String(call.body || '').includes('create_checkout') && String(call.body).includes('tools/call')), false)
})

test('a write-only MCP server is not a door', async () => {
  const { door } = scripted({
    '/agent.txt': { body: 'MCP: https://example.com/mcp\n' },
    'POST example.com/mcp': {
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [{ name: 'create_checkout', inputSchema: { properties: { query: { type: 'string' } } } }] },
      }),
    },
  })
  const asked = await door.ask('wool hats')
  assert.equal(asked.protocol, null)
  assert.match(asked.error, /no tool/i)
})
