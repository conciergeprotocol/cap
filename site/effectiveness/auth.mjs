import { createFetcher } from './fetch.mjs'
import { siteKey } from '../readiness-store.mjs'

const IDS = [
  'auth_discovery',
  'account_access',
  'account_actions',
  'permission_enforcement',
  'user_confirmation',
  'revocation',
]

export async function probeAuth(domain) {
  const fetcher = createFetcher(domain)
  const agent = await fetcher.getPage(`https://${domain}/agent.txt`)
  const wellKnown = await fetcher.getPage(`https://${domain}/.well-known/oauth-authorization-server`)
  const text = `${agent.text || ''}\n${wellKnown.text || ''}`.toLowerCase()
  const discovered = /oauth|authorization|login|cap-from/.test(text) && !agent.error
  const protocols = []
  if (/oauth/.test(text)) protocols.push('OAuth')
  if (/protocol:\s*cap/.test(text) || /cap:/.test(agent.text || '')) protocols.push('CAP')

  const capabilities = IDS.map((id) => {
    if (id === 'auth_discovery') {
      return {
        id,
        status: discovered ? 'detected' : 'not_tested',
        protocol: protocols[0],
        detail: discovered
          ? 'Public files advertise a way to start authorization. This check did not sign in.'
          : 'No public OAuth or CAP login advertisement was confirmed.',
        evidence: [agent.url, wellKnown.url].filter(Boolean),
      }
    }
    return {
      id,
      status: 'not_tested',
      detail: 'Verified account access needs an authorized sandbox. This public run does not sign in.',
    }
  })

  return {
    capabilities,
    tasks: [],
    protocols,
    sandbox: false,
    domain: siteKey(domain),
  }
}
