export function readinessPageBody() {
  return `<h1>Agent readiness</h1>
<p>Score how ready any website is for AI agents: a <a href="/spec#front-door">CAP door</a>, <code>llms.txt</code>, crawler access, a machine-readable index, structured data, and the key pages an agent needs. Every site is scored out of 100. Results are cached for 24 hours.</p>
<form class="check-form" id="readiness-form">
<label for="domain">Domain</label>
<input id="domain" name="domain" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="example.com" required>
<button type="submit">Score</button>
</form>
<p class="check-status" id="readiness-status" role="status"></p>
<div class="check-bar" id="readiness-bar" hidden><span></span></div>
<div id="readiness-out" data-readiness="check"></div>
<section class="readiness-next">
<h2>Next steps</h2>
<p>To add a door, follow <a href="/publish">Publish a door</a>, then run the <a href="/check">door check</a>. A site that passes is listed in the <a href="/directory">directory</a>.</p>
</section>
<section>
<h2>Methodology</h2>
<p>Methodology v2, November 2026. Every site is scored on the same six checks out of 100. Three of them ask for what fits the site: a store is asked for its catalog, product schema, and return and shipping pages; a rental for listings, listing schema, a cancellation policy, and house rules; any other site for a sitemap and feed, home page schema, a contact page, and a privacy policy or terms.</p>
<table>
<thead><tr><th>Check</th><th>Points</th></tr></thead>
<tbody>
<tr><td>CAP door: a valid <code>agent.txt</code> (15), and the endpoint answers a public question (20)</td><td>35</td></tr>
<tr><td><code>llms.txt</code> is present (6). A page written for this site earns the other 4. The stock Agent Instructions template stays at 6.</td><td>10</td></tr>
<tr><td>Catalog or index. A store: <code>products.json</code> with price and availability earns 20, price without availability 14, and a sitemap of product URLs 8. Any other site: a sitemap of its pages (12) and one source an agent can read in a single request (8): an RSS, Atom, or JSON feed, an OpenAPI spec, or <code>llms-full.txt</code>.</td><td>20</td></tr>
<tr><td>robots.txt allows GPTBot (4), ClaudeBot (4), PerplexityBot (4), and Google-Extended (3). If robots.txt allows them but a firewall blocks this checker, the check fails.</td><td>15</td></tr>
<tr><td>Structured data. A store: Product JSON-LD on a product page (4), a price (3), and availability (3); a rental can use VacationRental, Accommodation, or LodgingBusiness. Any other site: home page JSON-LD that says who runs the site, such as Organization (5), and what it offers, such as SoftwareApplication, Service, Course, Event, or Article (5).</td><td>10</td></tr>
<tr><td>Key pages that resolve and contain real text, 5 each. A store: return and shipping policies. A rental: cancellation policy and house rules. Any other site: a contact page and a privacy policy or terms. Links are read from the home page and <code>llms.txt</code>, then from a linked help center.</td><td>10</td></tr>
</tbody>
</table>
<p>A domain that redirects to another domain, such as a brand domain that forwards to its store, is scored on the domain it lands on. <code>www.example.com</code> and <code>example.com</code> share one result.</p>
<p>The checker identifies itself as <code>CAP-Readiness/1.0 (+https://conciergeprotocol.org/readiness)</code> and sends about one request a second. The door question uses the same identity as the <a href="/check">door check</a>.</p>
<p>A response of 401, 403, or 429, a challenge page, or a home page that never answers marks a check blocked. Blocked points are left out of the score, so the result reads, for example, 40 of 55 checked.</p>
<h3>API</h3>
<p><code>POST /api/readiness</code> with <code>{"domain": "example.com"}</code> returns the result as JSON. <code>GET /api/readiness?domains=a.com,b.com</code> returns stored results with one entry per month. Both allow cross-origin requests.</p>
</section>
<script src="/readiness.js" defer></script>`
}

export function readinessMarkdown() {
  return `# Agent readiness

Score any domain at https://conciergeprotocol.org/readiness. Every site is scored out of 100 on the same six checks. A result is cached for 24 hours.

Methodology v2 weights: CAP door 35, llms.txt 10, catalog or index 20, AI crawlers 15, structured data 10, key pages 10. A store is asked for products.json, Product schema, and return and shipping policies. A rental is asked for listings, listing schema, a cancellation policy, and house rules. Any other site is asked for a sitemap plus a feed, OpenAPI spec, or llms-full.txt, home page Organization and offering schema, a contact page, and a privacy policy or terms. A blocked check, including a home page that never answers, is left out of the score. A domain that redirects to another domain is scored on the one it lands on, and www shares the bare domain's result.

API: POST https://conciergeprotocol.org/api/readiness with {"domain": "example.com"}. GET https://conciergeprotocol.org/api/readiness?domains=a.com,b.com returns stored results with monthly history.

To add a door, see https://conciergeprotocol.org/publish.
`
}

export function readinessShare({ domain, result, shell = '' }) {
  const score = result?.score
  const title = result
    ? `${result.blocked ? 'Blocked' : score} agent readiness for ${domain}`
    : `Agent readiness for ${domain}`
  const description = result
    ? `${domain} scored ${score} of ${result.blocked ? result.checkedMax : result.applicableMax} on the CAP agent readiness check.`
    : `How ready ${domain} is for AI agents.`
  const url = `https://conciergeprotocol.org/readiness/${encodeURIComponent(domain)}`
  const image = `https://conciergeprotocol.org/readiness/og/${encodeURIComponent(domain)}`
  const data = result ? JSON.stringify({ ...result, cached: true }).replace(/</g, '\\u003c') : ''
  const pageTitle = `${title} · Concierge Agent Protocol`
  if (shell.includes('id="readiness-form"')) return patchShell(shell, { pageTitle, description, url, image, data })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(pageTitle)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${image}">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="topbar">
<a class="brand" href="/">CAP</a>
<div class="topbar-end">
<a class="top-link" href="/readiness">Check a domain</a>
<a class="top-link" href="/publish">Publish a door</a>
</div>
</header>
<main id="content" class="readiness-share">
${readinessPageBody()}
</main>
${data ? `<script type="application/json" id="readiness-result">${data}</script>` : ''}
</body>
</html>`
}

// A refreshed /readiness/:domain URL is the same document as /readiness. Only the share title and the cached score change.
function patchShell(shell, { pageTitle, description, url, image, data }) {
  let html = shell
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(pageTitle)}</title>`)
  html = replaceMeta(html, 'name', 'description', description)
  html = replaceMeta(html, 'property', 'og:title', pageTitle)
  html = replaceMeta(html, 'property', 'og:description', description)
  html = replaceMeta(html, 'property', 'og:url', url)
  html = replaceMeta(html, 'property', 'og:image', image)
  html = replaceMeta(html, 'property', 'og:image:width', '1200')
  html = replaceMeta(html, 'property', 'og:image:height', '630')
  html = replaceMeta(html, 'property', 'og:image:alt', pageTitle)
  html = replaceMeta(html, 'name', 'twitter:title', pageTitle)
  html = replaceMeta(html, 'name', 'twitter:description', description)
  html = replaceMeta(html, 'name', 'twitter:image', image)
  if (!data) return html
  const script = `<script type="application/json" id="readiness-result">${data}</script>`
  return html.includes('</body>') ? html.replace('</body>', `${script}</body>`) : `${html}${script}`
}

function replaceMeta(html, attr, key, value) {
  const pattern = new RegExp(`<meta ${attr}="${key}" content="[^"]*">`)
  const tag = `<meta ${attr}="${key}" content="${escapeHtml(value)}">`
  return pattern.test(html) ? html.replace(pattern, tag) : html
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
