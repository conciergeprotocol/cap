import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDoor, isPublicAddress, parseHost, sameSite } from './check.mjs'
import { checkPageBody } from './check-page.mjs'

test('parseHost accepts a domain and rejects everything else', () => {
  assert.equal(parseHost('CosmicJS.com').hostname, 'cosmicjs.com')
  assert.equal(parseHost('https://www.cosmicjs.com/agent.txt').hostname, 'www.cosmicjs.com')
  assert.equal(parseHost('http://cosmicjs.com').ok, false)
  assert.equal(parseHost('127.0.0.1').ok, false)
  assert.equal(parseHost('localhost').ok, false)
  assert.equal(parseHost('https://cosmicjs.com:8443').ok, false)
  assert.equal(parseHost('https://user:pass@cosmicjs.com').ok, false)
  assert.equal(parseHost('https://cosmicjs.com/pricing').ok, false)
  assert.equal(sameSite('www.cosmicjs.com', 'cosmicjs.com'), true)
  assert.equal(sameSite('cap.cosmicjs.com', 'cosmicjs.com'), false)
})

test('private and documentation addresses are rejected', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPublicAddress(ip), false, ip)
  }
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('2001:4860:4860::8888'), true)
})

test('a door that answers and hides the message passes', async () => {
  const seen = []
  const result = await checkDoor('example.com', {
    resolve: async () => ({ ok: true, addresses: ['8.8.8.8'] }),
    request: async (options) => {
      seen.push(`${options.method} ${options.url} ${options.headers?.['cap-from'] || ''}`)
      if (options.url.endsWith('/agent.txt')) {
        return { ok: true, status: 200, headers: { 'content-type': 'text/plain' }, body: 'Protocol: CAP/1.0\nName: Example\nCAP: https://example.com/cap/v1\n' }
      }
      if (options.method === 'POST') {
        return { ok: true, status: 202, headers: { 'retry-after': '0' }, body: JSON.stringify({ id: 'msg_abc12345', status: 'working' }) }
      }
      if (options.headers['cap-from'] === 'agent:cap-check-other') return { ok: true, status: 404, headers: {}, body: '' }
      return { ok: true, status: 200, headers: {}, body: JSON.stringify({ id: 'msg_abc12345', status: 'done', reply: 'We can help with orders.' }) }
    },
  })
  assert.equal(result.passed, true)
  assert.equal(result.domain, 'example.com')
  assert.deepEqual(result.checks.map((check) => check.id), ['host', 'card', 'reply', 'private'])
  assert.ok(seen.some((line) => line.includes('agent:cap-check-other')))
})

test('the CAP line has to stay on the same site', async () => {
  const result = await checkDoor('example.com', {
    resolve: async () => ({ ok: true, addresses: ['8.8.8.8'] }),
    request: async () => ({ ok: true, status: 200, headers: {}, body: 'Protocol: CAP/1.0\nCAP: https://other.example/cap/v1\n' }),
  })
  assert.equal(result.passed, false)
  assert.equal(result.domain, 'example.com')
  assert.equal(result.checks.at(-1).id, 'card')
})

test('a redirect onto another host stops the check', async () => {
  const result = await checkDoor('example.com', {
    resolve: async () => ({ ok: true, addresses: ['8.8.8.8'] }),
    request: async () => ({ ok: true, status: 301, headers: { location: 'https://elsewhere.test/agent.txt' }, body: '' }),
  })
  assert.match(result.checks.at(-1).detail, /another host/)
})

test('www is the same site as the bare domain', async () => {
  const result = await checkDoor('example.com', {
    resolve: async (hostname) => ({ ok: true, addresses: hostname.startsWith('www') ? ['1.1.1.1'] : ['8.8.8.8'] }),
    request: async (options) => {
      if (options.url === 'https://example.com/agent.txt') {
        return { ok: true, status: 301, headers: { location: 'https://www.example.com/agent.txt' }, body: '' }
      }
      if (options.url.endsWith('/agent.txt')) {
        return { ok: true, status: 200, headers: {}, body: 'Protocol: CAP/1.0\nCAP: https://www.example.com/cap/v1\n' }
      }
      if (options.method === 'POST') {
        assert.equal(options.url, 'https://www.example.com/cap/v1/messages')
        assert.deepEqual(options.addresses, ['1.1.1.1'])
        return { ok: true, status: 200, headers: {}, body: JSON.stringify({ id: 'msg_abc12345', status: 'done', reply: 'Hello.' }) }
      }
      return { ok: true, status: 404, headers: {}, body: '' }
    },
  })
  assert.equal(result.passed, true)
})

test('a message another caller can read fails', async () => {
  const result = await checkDoor('example.com', {
    resolve: async () => ({ ok: true, addresses: ['8.8.8.8'] }),
    request: async (options) => {
      if (options.url.endsWith('/agent.txt')) {
        return { ok: true, status: 200, headers: {}, body: 'Protocol: CAP/1.0\nCAP: https://example.com/cap/v1\n' }
      }
      if (options.method === 'POST') {
        return { ok: true, status: 200, headers: {}, body: JSON.stringify({ id: 'msg_abc12345', status: 'done', reply: 'Hello.' }) }
      }
      return { ok: true, status: 200, headers: {}, body: JSON.stringify({ id: 'msg_abc12345', status: 'done', reply: 'Hello.' }) }
    },
  })
  assert.equal(result.passed, false)
  assert.equal(result.checks.at(-1).id, 'private')
})

test('a host the check rejects has no address to share', async () => {
  const result = await checkDoor('localhost')
  assert.equal(result.passed, false)
  assert.equal(result.domain, undefined)
})

test('the check page keeps the domain in the address and offers a share after the result', () => {
  const html = checkPageBody()
  assert.match(html, /Nothing is stored/)
  assert.match(html, /history\.replaceState/)
  assert.match(html, /Copy link/)
  assert.match(html, /has a CAP front door/)
  assert.match(html, /implement\.txt/)
  assert.match(html, /navigator\.share/)
  assert.match(html, /x\.com\/intent\/post/)
  assert.match(html, /linkedin\.com\/sharing\/share-offsite/)
  assert.match(html, /if \(preset\) run\(\)/)
})

test('a private address is not fetched', async () => {
  let called = false
  const result = await checkDoor('example.com', {
    resolve: async () => ({ ok: false, detail: 'That host resolves to a private address.' }),
    request: async () => { called = true },
  })
  assert.equal(called, false)
  assert.match(result.checks[0].detail, /private address/)
})
