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
  { src: 'owners.md', route: '/owners', file: 'owners.html', nav: 'Add login' },
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

const icon = (paths) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

const themeOptions = [
  { value: 'system', label: 'System', icon: icon('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>') },
  { value: 'light', label: 'Light', icon: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>') },
  { value: 'dark', label: 'Dark', icon: icon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>') }
]

const themeControl = `<div class="theme" role="radiogroup" aria-label="Theme">${themeOptions
  .map((option) => `<button type="button" role="radio" aria-checked="false" aria-label="${option.label}" title="${option.label}" data-theme="${option.value}">${option.icon}</button>`)
  .join('')}</div>`

// Runs before paint, so a saved theme never flashes the other one.
const themeBoot = `(function(){try{var t=localStorage.getItem('cap_theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`

const pageScript = `(function(){
var root=document.documentElement,media=matchMedia('(prefers-color-scheme: dark)');
function saved(){try{return localStorage.getItem('cap_theme')||'system'}catch(e){return 'system'}}
function apply(t){root.classList.toggle('dark',t==='dark'||(t!=='light'&&media.matches));document.querySelectorAll('.theme button').forEach(function(b){b.setAttribute('aria-checked',String(b.dataset.theme===t))})}
document.querySelectorAll('.theme button').forEach(function(b){b.addEventListener('click',function(){try{localStorage.setItem('cap_theme',b.dataset.theme)}catch(e){}apply(b.dataset.theme)})});
media.addEventListener('change',function(){if(saved()==='system')apply('system')});
apply(saved());
document.querySelectorAll('[data-copy]').forEach(function(button){button.addEventListener('click',function(){
var pre=document.getElementById(button.dataset.copy),text=pre.textContent,label=button.querySelector('span'),idle=label.textContent;
function legacy(){var area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}area.remove();return ok}
function done(ok){if(!ok){pre.closest('details').open=true;getSelection().selectAllChildren(pre)}label.textContent=ok?'Copied. Paste it into your AI assistant':'Copy the selected prompt below';setTimeout(function(){label.textContent=idle},2500)}
if(navigator.clipboard){navigator.clipboard.writeText(text).then(function(){done(true)},function(){done(legacy())})}else{done(legacy())}
})})
})()`

const implementPrompt = readFileSync(join(root, 'site', 'public', 'implement.txt'), 'utf8').trim()

const promptBlock = `<section class="prompt">
<button type="button" class="copy" data-copy="implement-prompt">${icon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')}<span>Tell my AI assistant to implement CAP</span></button>
<p>Copies a short prompt with links to the spec and the reference server. Paste it into Claude, ChatGPT, Cursor, or any coding assistant open in your project. The same prompt is at <a href="/implement.txt">/implement.txt</a>.</p>
<details><summary>Show the prompt</summary><pre id="implement-prompt">${escape(implementPrompt)}</pre></details>
</section>
`

// On the home page the prompt follows the introduction. On the owner guide it opens the first section.
const promptAnchor = { '/': '<ul', '/owners': '<h2' }
const withPrompt = (body, route) => {
  if (!promptAnchor[route]) return body
  const at = body.indexOf(promptAnchor[route])
  return at === -1 ? body + promptBlock : body.slice(0, at) + promptBlock + body.slice(at)
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
<script>${themeBoot}</script>
</head>
<body>
<header>
<a class="brand" href="/">🧢 CAP <span class="badge">1.0 Draft</span></a>
<div class="header-end">
<nav>${nav}<a href="${repo}">GitHub</a></nav>
${themeControl}
</div>
</header>
<main>
${withPrompt(body, route)}
</main>
<footer>
<p>Concierge Agent Protocol 1.0 Draft. Spec text under <a href="${repo}/blob/main/LICENSE-SPEC">CC BY 4.0</a>, code under <a href="${repo}/blob/main/LICENSE">Apache 2.0</a>.</p>
<p><a href="/governance">Governance</a> · <a href="/security">Security</a> · <a href="/changelog">Changelog</a> · <a href="/cap.txt">cap.txt</a> · <a href="/implement.txt">implement.txt</a></p>
</footer>
<script>${pageScript}</script>
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
