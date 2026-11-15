export function readinessPageBody() {
  return `<h1>Agent readiness</h1>
<p>Score how ready a store is for an AI shopping agent. The check looks for a <a href="/spec#front-door">CAP door</a>, <code>llms.txt</code>, a catalog with price and stock, crawler access, product schema, and return and shipping pages. Results are cached for 24 hours.</p>
<form class="check-form" id="readiness-form">
<label for="domain">Domain</label>
<input id="domain" name="domain" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="allbirds.com" required>
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
<p>Methodology v1, November 2026.</p>
<table>
<thead><tr><th>Check</th><th>Points</th></tr></thead>
<tbody>
<tr><td>CAP door: a valid <code>agent.txt</code> (15), and the endpoint answers a public question (20)</td><td>35</td></tr>
<tr><td><code>llms.txt</code> is present (6). A page written for this site earns the other 4. The stock Agent Instructions template stays at 6.</td><td>10</td></tr>
<tr><td>Structured catalog. <code>products.json</code> with price and availability earns 20. Price without availability earns 14. A sitemap of product URLs, with no price or stock, earns 8.</td><td>20</td></tr>
<tr><td>robots.txt allows GPTBot (4), ClaudeBot (4), PerplexityBot (4), and Google-Extended (3). If robots.txt allows them but a firewall blocks this checker, the check fails.</td><td>15</td></tr>
<tr><td>Product JSON-LD: a Product (4), a price (3), and availability (3)</td><td>10</td></tr>
<tr><td>A return policy page (5) and a shipping policy page (5) that resolve and contain real text</td><td>10</td></tr>
</tbody>
</table>
<p>The checker identifies itself as <code>CAP-Readiness/1.0 (+https://conciergeprotocol.org/readiness)</code> and sends about one request a second. The door question uses the same identity as the <a href="/check">door check</a>.</p>
<p>A response of 401, 403, or 429, or a challenge page, marks a check blocked. Blocked points are left out of the score, so the result reads, for example, 40 of 55 checked. A site that does not sell products skips the catalog, schema, and policy checks.</p>
<h3>API</h3>
<p><code>POST /api/readiness</code> with <code>{"domain": "example.com"}</code> returns the result as JSON. <code>GET /api/readiness?domains=a.com,b.com</code> returns stored results with one entry per month. Both allow cross-origin requests.</p>
</section>
<script src="/readiness.js" defer></script>`
}

export function readinessMarkdown() {
  return `# Agent readiness

Score a domain at https://conciergeprotocol.org/readiness. The checker looks for a CAP door, llms.txt, a catalog with price and stock, crawler access, product schema, and return and shipping pages. A result is cached for 24 hours.

Methodology v1 weights: CAP door 35, llms.txt 10, structured catalog 20, AI crawlers 15, product schema 10, return and shipping policies 10. A blocked check is left out of the score. Sites that do not sell products skip the catalog, schema, and policy checks.

API: POST https://conciergeprotocol.org/api/readiness with {"domain": "example.com"}. GET https://conciergeprotocol.org/api/readiness?domains=a.com,b.com returns stored results with monthly history.

To add a door, see https://conciergeprotocol.org/publish.
`
}

export function readinessShare({ domain, result }) {
  const score = result?.score
  const title = result
    ? `${result.blocked ? 'Blocked' : score} agent readiness for ${domain}`
    : `Agent readiness for ${domain}`
  const description = result
    ? `${domain} scored ${score} of ${result.blocked ? result.checkedMax : result.applicableMax} on the CAP agent readiness check.`
    : `How ready ${domain} is for an AI shopping agent.`
  const image = `https://conciergeprotocol.org/readiness/og/${encodeURIComponent(domain)}`
  const data = result ? JSON.stringify(result).replace(/</g, '\\u003c') : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Concierge Agent Protocol</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="https://conciergeprotocol.org/readiness/${encodeURIComponent(domain)}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
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

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
