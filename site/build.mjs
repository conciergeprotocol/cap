import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked } from 'marked'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'site', 'dist')
const repo = 'https://github.com/conciergeprotocol/cap'

const pages = [
  { src: 'README.md', route: '/', file: 'index.html', nav: 'Overview' },
  { src: 'spec.md', route: '/spec', file: 'spec.html', nav: 'Spec' },
  { src: 'usage.md', route: '/usage', file: 'usage.html', nav: 'Usage' },
  { src: 'concepts/README.md', route: '/concepts', file: 'concepts.html', nav: 'Concepts' },
  { src: 'concepts/messages.md', route: '/concepts/messages', file: 'concepts/messages.html' },
  { src: 'concepts/access.md', route: '/concepts/access', file: 'concepts/access.html' },
  { src: 'article/introducing-the-concierge-agent-protocol.md', route: '/introducing', file: 'introducing.html', nav: 'Introducing CAP' },
  { src: 'article/white-paper.md', route: '/white-paper', file: 'white-paper.html', nav: 'White paper' },
  { src: 'GOVERNANCE.md', route: '/governance', file: 'governance.html' },
  { src: 'SECURITY.md', route: '/security', file: 'security.html' },
  { src: 'CHANGELOG.md', route: '/changelog', file: 'changelog.html' }
]

const routes = new Map(pages.map((page) => [page.src, page.route]))

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')

const escape = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const resolveLink = (href, src) => {
  if (/^([a-z]+:|#|\/)/i.test(href)) return href
  const [path, hash] = href.split('#')
  const target = posix.normalize(posix.join(posix.dirname(src), path))
  const anchor = hash ? `#${hash}` : ''
  if (routes.has(target)) return routes.get(target) + anchor
  if (routes.has(posix.join(target, 'README.md'))) return routes.get(posix.join(target, 'README.md')) + anchor
  const isDir = existsSync(join(root, target)) && statSync(join(root, target)).isDirectory()
  return `${repo}/${isDir ? 'tree' : 'blob'}/main/${target}${anchor}`
}

const render = (page) => {
  const marked = new Marked({
    gfm: true,
    walkTokens: (token) => {
      if (token.type === 'link') token.href = resolveLink(token.href, page.src)
    },
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        return `<h${depth} id="${slug(html)}">${html}</h${depth}>\n`
      }
    }
  })
  const markdown = readFileSync(join(root, page.src), 'utf8')
  const title = (markdown.match(/^#\s+(.+)$/m)?.[1] ?? 'Concierge Agent Protocol').replace(/[^\p{L}\p{N}\s().,:-]/gu, '').trim()
  return { title, body: marked.parse(markdown) }
}

const layout = ({ title, body, route }) => {
  const nav = pages
    .filter((page) => page.nav)
    .map((page) => `<a href="${page.route}"${page.route === route ? ' aria-current="page"' : ''}>${page.nav}</a>`)
    .join('')
  const pageTitle = route === '/' ? 'Concierge Agent Protocol (CAP)' : `${escape(title)} · Concierge Agent Protocol`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="The front door to your website, for every AI agent. Share results, not credentials.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icon.png" type="image/png">
<link rel="apple-touch-icon" href="/icon.png">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
<a class="brand" href="/">🧢 CAP <span class="badge">1.0 Draft</span></a>
<nav>${nav}<a href="${repo}">GitHub</a></nav>
</header>
<main>
${body}
</main>
<footer>
<p>Concierge Agent Protocol 1.0 Draft. Spec text under <a href="${repo}/blob/main/LICENSE-SPEC">CC BY 4.0</a>, code under <a href="${repo}/blob/main/LICENSE">Apache 2.0</a>.</p>
<p><a href="/governance">Governance</a> · <a href="/security">Security</a> · <a href="/changelog">Changelog</a> · <a href="/cap.txt">cap.txt</a></p>
</footer>
</body>
</html>
`
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(root, 'site', 'public'), out, { recursive: true })

for (const page of pages) {
  const { title, body } = render(page)
  const file = join(out, page.file)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, layout({ title, body, route: page.route }))
}

console.log(`Built ${pages.length} pages into site/dist`)
