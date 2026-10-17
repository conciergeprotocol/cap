import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from '../../reference/start.mjs'
import { isProductRequest, search } from './catalog.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const page = fs.readFileSync(path.join(here, 'public', 'index.html'))

// Stays on this process. Never copied into a reply or agent.txt.
const ORDERS_KEY = process.env.ORDERS_KEY || 'orders_db_demo_7c1'

const ORDERS = {
  maya: { reply: 'Your Stride Runner shipped Tuesday and arrives Friday. Track it at https://carrier.example/track/hg_1042', delay: 0 },
  sam: { reply: 'Your Heavyweight Hoodie is packing. It has no tracking link yet.', delay: 2500 },
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function lookupOrder(account) {
  if (!ORDERS_KEY.startsWith('orders_')) throw new Error('orders database unavailable')
  const order = ORDERS[account]
  if (!order) return 'There is no order on this account.'
  await sleep(order.delay)
  return order.reply
}

async function answer({ message, context, history, account }) {
  if (/\b(order|package|shipped|shipping|tracking|delivery)\b/i.test(message)) {
    if (!account) return { error: { code: 'login_required', message: 'Log in to Harbor Goods to ask about your order.' } }
    return { reply: await lookupOrder(account) }
  }
  if (/\b(open|hours)\b/i.test(message)) return { reply: 'We are open Saturday 11am to 9pm.' }
  if (/\b(cheaper|less expensive|lower price)\b/i.test(message)) {
    // The earlier request comes from this store's own record of the thread.
    const asked = [...history].reverse().find((turn) => isProductRequest(turn.message))
    if (!asked) return { reply: 'Cheaper than what? Tell me what you are looking for.' }
    return { reply: search(asked.message, { ...asked.context, ...context }, { cheaper: true }) }
  }
  return { reply: search(message, context) }
}

// The demo page plays the visiting agent, so this process also hosts that
// agent's client document. A real visiting agent hosts its own.
function clientDocument(base) {
  return {
    client_id: `${base}/client.json`,
    client_name: 'Harbor Goods demo page',
    redirect_uris: [`${base}/`],
    cap_from: 'agent:shopper',
  }
}

export async function startStore(port = Number(process.env.STORE_PORT || 8810)) {
  let base = ''
  const app = await boot({
    config: {
      agent: { name: 'Harbor Goods', status: 'active', chat: '' },
      oauth: {
        accounts: [{ account: 'maya', password: 'maya' }, { account: 'sam', password: 'sam' }],
        allow_http_clients: true,
        hint: 'Demo accounts: maya / maya and sam / sam.',
      },
      retry_after: 1,
    },
    sqlitePath: ':memory:',
    databaseUrl: '',
    waitMs: 1000,
    answer,
    extraRoutes(req, res, url) {
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/chat')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(page)
        return true
      }
      if (req.method === 'GET' && url.pathname === '/client.json') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(clientDocument(base)))
        return true
      }
      return false
    },
  })
  await new Promise((resolve) => app.server.listen(port, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${app.server.address().port}`
  app.config.agent.chat = `${base}/chat`
  return { ...app, base, close: () => new Promise((resolve) => app.server.close(resolve)) }
}
