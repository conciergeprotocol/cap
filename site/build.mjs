import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked } from 'marked'
import { checkPageBody } from './check-page.mjs'
import { createCssVariablesTheme, createHighlighter } from 'shiki'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'site', 'dist')
const repo = 'https://github.com/conciergeprotocol/cap'

const pages = [
  { src: 'README.md', route: '/', file: 'index.html', nav: 'Overview' },
  { src: 'spec.md', route: '/spec', file: 'spec.html', nav: 'Spec' },
  { src: 'usage.md', route: '/usage', file: 'usage.html', nav: 'Usage' },
  { src: 'callers.md', route: '/callers', file: 'callers.html', nav: 'Call a door' },
  { src: 'login.md', route: '/login', file: 'login.html', nav: 'Add login' },
  { src: 'concepts/README.md', route: '/concepts', file: 'concepts.html' },
  { src: 'concepts/messages.md', route: '/concepts/messages', file: 'concepts/messages.html' },
  { src: 'concepts/access.md', route: '/concepts/access', file: 'concepts/access.html' },
  { src: 'article/introducing-the-concierge-agent-protocol.md', route: '/introducing', file: 'introducing.html' },
  { src: 'article/white-paper.md', route: '/white-paper', file: 'white-paper.html' },
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

const shikiLang = {
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  json: 'json',
  sh: 'bash',
  bash: 'bash',
  shell: 'bash',
  html: 'html'
}

let highlighter

const highlight = (text, lang) => {
  const name = shikiLang[lang]
  if (!highlighter || !name) return escape(text)
  const html = highlighter.codeToHtml(text.replace(/\n$/, ''), { lang: name, theme: 'css-variables' })
  return html.replace(/^<pre[^>]*><code>/, '').replace(/<\/code><\/pre>$/, '')
}

const languages = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  json: 'JSON',
  sh: 'Shell',
  bash: 'Shell',
  shell: 'Shell',
  html: 'HTML',
  text: 'Text',
  mermaid: 'Mermaid'
}

const render = (page) => {
  let codeId = 0
  const marked = new Marked({
    gfm: true,
    walkTokens: (token) => {
      if (token.type === 'link') token.href = resolveLink(token.href, page.src)
    },
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        return `<h${depth} id="${slug(html)}">${html}</h${depth}>\n`
      },
      code({ text, lang }) {
        const id = `code-${++codeId}`
        const label = languages[lang] || ''
        const bar = label ? `<div class="codeblock-bar">${escape(label)}</div>` : ''
        return `<div class="codeblock">${bar}<div class="codeblock-body"><pre id="${id}"><code>${highlight(text, lang)}</code></pre><button type="button" class="code-copy" data-codecopy="${id}" aria-label="Copy">${icon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')}<span class="code-copy-idle">Copy</span><span class="code-copy-done" hidden>Copied!</span></button></div></div>\n`
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
var menu=document.querySelector('.menu'),header=document.querySelector('header');
function setMenu(open){header.classList.toggle('open',open);menu.setAttribute('aria-expanded',String(open))}
menu.addEventListener('click',function(){setMenu(!header.classList.contains('open'))});
document.querySelectorAll('#site-menu a').forEach(function(a){a.addEventListener('click',function(){setMenu(false)})});
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&header.classList.contains('open')){setMenu(false);menu.focus()}});
document.querySelectorAll('[data-codecopy]').forEach(function(button){button.addEventListener('click',function(){
var pre=document.getElementById(button.getAttribute('data-codecopy')),text=pre.textContent,idle=button.querySelector('.code-copy-idle'),doneLabel=button.querySelector('.code-copy-done');
function show(){button.classList.add('is-copied');idle.hidden=true;doneLabel.hidden=false;setTimeout(function(){button.classList.remove('is-copied');idle.hidden=false;doneLabel.hidden=true},1000)}
function legacy(){var area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}area.remove();return ok}
if(navigator.clipboard){navigator.clipboard.writeText(text).then(show,function(){if(legacy())show()})}else if(legacy())show()
})});
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
const promptAnchor = { '/': '<ul', '/login': '<h2' }
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
<button type="button" class="menu" aria-expanded="false" aria-controls="site-menu" aria-label="Menu">${icon('<path d="M4 6h16M4 12h16M4 18h16"/>')}${icon('<path d="M6 6l12 12M18 6L6 18"/>')}</button>
<div class="header-end" id="site-menu">
<nav>${nav}</nav>
<a class="github" href="${repo}" aria-label="GitHub"><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.56 9.56 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg></a>
</div>
</header>
<main>
${withPrompt(body, route)}
</main>
<footer>
<p>Concierge Agent Protocol 1.0 Draft. Spec text under <a href="${repo}/blob/main/LICENSE-SPEC">CC BY 4.0</a>, code under <a href="${repo}/blob/main/LICENSE">Apache 2.0</a>.</p>
<div class="footer-end">
<p><a href="/governance">Governance</a> · <a href="/security">Security</a> · <a href="/changelog">Changelog</a> · <a href="/cap.txt">cap.txt</a> · <a href="/implement.txt">implement.txt</a></p>
${themeControl}
</div>
</footer>
<script>${pageScript}</script>
</body>
</html>
`
}

highlighter = await createHighlighter({
  themes: [createCssVariablesTheme()],
  langs: ['javascript', 'typescript', 'json', 'bash', 'html']
})

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(root, 'site', 'public'), out, { recursive: true })

for (const page of pages) {
  const { title, body } = render(page)
  const file = join(out, page.file)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, layout({ title, body, route: page.route }))
}

const checkFile = join(out, 'check.html')
writeFileSync(checkFile, layout({ title: 'Check a door', body: checkPageBody(), route: '/check' }))

console.log(`Built ${pages.length + 1} pages into site/dist`)
