import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked } from 'marked'
import { CALLER, QUESTION } from './check.mjs'
import { checkPageBody } from './check-page.mjs'
import { directoryPageBody } from './directory-page.mjs'
import { ASK_EVERY_DAYS, DELIST_AFTER, RESULT_TTL_S } from './doors.mjs'
import { createCssVariablesTheme, createHighlighter } from 'shiki'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'site', 'dist')
const repo = 'https://github.com/conciergeprotocol/cap'

const pages = [
  { src: 'home.md', route: '/', file: 'index.html' },
  {
    src: 'publish.md',
    route: '/publish',
    file: 'publish.html',
    description: 'Give AI agents your answer, from your own content, with a link to the product, plan, or booking page on your site. One file and two endpoints.'
  },
  { src: 'callers.md', route: '/callers', file: 'callers.html' },
  {
    src: 'demos.md',
    route: '/demos',
    file: 'demos.html',
    description: 'Three live doors: Marlow for a stay, SWSH for a purchase, and Cosmic for a company site. The directory lists every site that passes.'
  },
  { src: 'spec.md', route: '/spec', file: 'spec.html' },
  { src: 'usage.md', route: '/usage', file: 'usage.html' },
  { src: 'login.md', route: '/login', file: 'login.html' },
  {
    src: 'benchmark/README.md',
    route: '/benchmark',
    file: 'benchmark.html',
    description: 'Same answers, a fifth of the cost, a third of the steps. 861 frozen runs compare asking a store through CAP with fetching its pages and browsing them.'
  },
  {
    src: 'efficiency.md',
    route: '/efficiency',
    file: 'efficiency.html',
    description: 'Counting both the visiting agent and the site, a CAP answer took about 19,000 tokens, against 48,000 to fetch a realistic site and 112,000 to browse it. Where it saves, where it does not, and what that does not show.'
  },
  { src: 'concepts/README.md', route: '/concepts', file: 'concepts.html' },
  { src: 'concepts/messages.md', route: '/concepts/messages', file: 'concepts/messages.html' },
  { src: 'concepts/access.md', route: '/concepts/access', file: 'concepts/access.html' },
  { src: 'article/introducing-the-concierge-agent-protocol.md', route: '/introducing', file: 'introducing.html' },
  { src: 'article/white-paper.md', route: '/white-paper', file: 'white-paper.html' },
  { src: 'GOVERNANCE.md', route: '/governance', file: 'governance.html' },
  { src: 'SECURITY.md', route: '/security', file: 'security.html' },
  { src: 'CHANGELOG.md', route: '/changelog', file: 'changelog.html' },
  {
    src: 'brand.md',
    route: '/brand',
    file: 'brand.html',
    description: 'The CAP mascot, mark, icon, and colors, with guidance for using them.'
  }
]

const routes = new Map(pages.map((page) => [page.src, page.route]))
routes.set('README.md', '/')

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

const origin = 'https://conciergeprotocol.org'

const markdownPathFor = (route) => (route === '/' ? '/index.md' : `${route}.md`)

// A copied page should point at the markdown for other pages, and at files on this site for images.
const absolutize = (href) => {
  if (!href.startsWith('/')) return href
  const hashAt = href.indexOf('#')
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : href.slice(hashAt)
  const queryAt = beforeHash.indexOf('?')
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt)
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt)
  if (query || !(path === '/' || pages.some((page) => page.route === path))) return origin + href
  return origin + markdownPathFor(path) + hash
}

const rewriteHref = (href, src) => {
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return href
  const hashAt = href.indexOf('#')
  const pathPart = hashAt === -1 ? href : href.slice(0, hashAt)
  const target = posix.normalize(posix.join(posix.dirname(src), pathPart || '.'))
  if (target.startsWith('site/public/')) {
    const hash = hashAt === -1 ? '' : href.slice(hashAt)
    return `${origin}/${target.slice('site/public/'.length)}${hash}`
  }
  return absolutize(resolveLink(href, src))
}

const rewriteMarkdown = (markdown, src) => {
  const blocks = []
  const stash = (match) => {
    blocks.push(match)
    return `\u0000${blocks.length - 1}\u0000`
  }
  let text = markdown.replace(/```[\s\S]*?```/g, stash).replace(/`[^`\n]+`/g, stash)
  text = text.replace(/(!?)\[([^\]]*)\]\(\s*([^)\s]+)((?:\s+"[^"]*")?)\s*\)/g, (match, bang, label, href, title) => {
    const next = rewriteHref(href, src)
    return next === href ? match : `${bang}[${label}](${next}${title})`
  })
  text = text.replace(/\b(href|src)="([^"]+)"/g, (match, attr, href) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return match
    return `${attr}="${rewriteHref(href, src)}"`
  })
  text = text.replace(/\]\((\/[^)\s]+)((?:\s+"[^"]*")?)\)/g, (match, href, title) => `](${absolutize(href)}${title})`)
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => blocks[Number(index)])
}

const blurbOf = (markdown, description) => {
  if (description) return description.replace(/\s+/g, ' ').trim()
  const body = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  if (/^\*\*[^*]+\*\*$/.test(body[0] || '')) return body[0].slice(2, -2)
  for (const line of body) {
    if (/^(<|!|\||-|```|>)/.test(line) || /^\*\*Status[:*]/.test(line)) continue
    return line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '')
  }
  return ''
}

const docBanner = (route) => `> ## Documentation Index
>
> Fetch the complete documentation index at: ${origin}/llms.txt
> Use this file to discover all available pages before exploring further.
>
> Full text of every page: ${origin}/llms-full.txt
> This page: ${origin}${markdownPathFor(route)}

`

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
  const headings = []
  const marked = new Marked({
    gfm: true,
    walkTokens: (token) => {
      if (token.type === 'link') token.href = resolveLink(token.href, page.src)
    },
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        const id = slug(html)
        if (depth === 2 || depth === 3) headings.push({ depth, id, text: html.replace(/<[^>]+>/g, '') })
        return `<h${depth} id="${id}">${html}</h${depth}>\n`
      },
      code({ text, lang }) {
        const id = `code-${++codeId}`
        const label = languages[lang] || ''
        const bar = label ? `<div class="codeblock-bar">${escape(label)}</div>` : ''
        return `<div class="codeblock">${bar}<div class="codeblock-body"><pre id="${id}"><code>${highlight(text, lang)}</code></pre><button type="button" class="code-copy" data-codecopy="${id}" aria-label="Copy"><span class="code-copy-icon">${icon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')}</span><span class="code-copy-check">${icon('<path d="M20 6 9 17l-5-5"/>')}</span><span class="code-copy-idle">Copy</span><span class="code-copy-done" hidden>Copied!</span></button></div></div>\n`
      }
    }
  })
  const markdown = readFileSync(join(root, page.src), 'utf8')
  const title = (markdown.match(/^#\s+(.+)$/m)?.[1] ?? 'Concierge Agent Protocol').replace(/[^\p{L}\p{N}\s().,:-]/gu, '').trim()
  return { title, body: marked.parse(markdown), headings, markdown }
}

const pageToc = (headings) => {
  if (headings.filter((heading) => heading.depth === 2).length < 2) return ''
  const links = headings
    .map((heading) => `<a href="#${heading.id}"${heading.depth === 3 ? ' class="toc-sub"' : ''}>${heading.text}</a>`)
    .join('')
  const up = icon('<path d="M12 19V5M5 12l7-7 7 7"/>')
  return `<nav class="toc" aria-label="On this page"><p>On this page</p><div class="toc-links">${links}</div><a class="toc-top" href="#top">${up}Back to top</a></nav>`
}

const icon = (paths, size = 16) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

const themeOptions = [
  { value: 'system', label: 'System', icon: icon('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>') },
  { value: 'light', label: 'Light', icon: icon('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>') },
  { value: 'dark', label: 'Dark', icon: icon('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>') }
]

const themeControl = `<div class="theme" role="radiogroup" aria-label="Theme">${themeOptions
  .map((option) => `<button type="button" role="radio" aria-checked="false" aria-label="${option.label}" title="${option.label}" data-theme="${option.value}">${option.icon}</button>`)
  .join('')}</div>`

// Runs before paint, so a saved theme never flashes the other one.
const themeBoot = `(function(){try{var t=localStorage.getItem('cap_theme');var d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);var root=document.documentElement;root.classList.toggle('dark',d);root.classList.toggle('light',!d)}catch(e){}})()`

const pageScript = `(function(){
var root=document.documentElement,media=matchMedia('(prefers-color-scheme: dark)');
function saved(){try{return localStorage.getItem('cap_theme')||'system'}catch(e){return 'system'}}
function apply(t){var d=t==='dark'||(t!=='light'&&media.matches);root.classList.toggle('dark',d);root.classList.toggle('light',!d);document.querySelectorAll('.theme button').forEach(function(b){b.setAttribute('aria-checked',String(b.dataset.theme===t))})}
document.querySelectorAll('.theme button').forEach(function(b){b.addEventListener('click',function(){try{localStorage.setItem('cap_theme',b.dataset.theme)}catch(e){}apply(b.dataset.theme)})});
media.addEventListener('change',function(){if(saved()==='system')apply('system')});
apply(saved());
var menu=document.querySelector('.menu');
var backdrop=document.querySelector('.nav-backdrop');
function setMenu(open){document.body.classList.toggle('nav-open',open);if(menu){menu.setAttribute('aria-expanded',String(open));menu.setAttribute('aria-label',open?'Close menu':'Menu')}if(open)closeSearch()}
if(menu)menu.addEventListener('click',function(){setMenu(!document.body.classList.contains('nav-open'))});
if(backdrop)backdrop.addEventListener('click',function(){setMenu(false)});
document.querySelectorAll('#site-menu a').forEach(function(a){a.addEventListener('click',function(){setMenu(false);try{sessionStorage.setItem('cap_nav_scroll',String(document.querySelector('.sidebar').scrollTop))}catch(err){}})});
var searchRoot=document.querySelector('.search');
var searchOpenBtn=document.querySelector('.search-open');
var searchInput=searchRoot?searchRoot.querySelector('input'):null;
var searchList=searchRoot?searchRoot.querySelector('.search-list'):null;
var searchClear=searchRoot?searchRoot.querySelector('.search-clear'):null;
var searchClose=searchRoot?searchRoot.querySelector('.search-close'):null;
var docIndex=[];
try{docIndex=JSON.parse(document.getElementById('doc-index').textContent)}catch(err){}
var active=0;
function escAttr(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function searchWords(){return (searchInput.value||'').trim().toLowerCase().split(/\s+/).filter(Boolean)}
function searchHay(item){return ((item.label||'')+' '+(item.group||'')+' '+(item.hint||'')+' '+(item.text||'')).toLowerCase()}
function searchScore(item, words){var label=(item.label||'').toLowerCase(),hint=((item.group||'')+' '+(item.hint||'')).toLowerCase(),score=0;words.forEach(function(word){if(label.indexOf(word)!==-1)score+=5;else if(hint.indexOf(word)!==-1)score+=2;else score+=1});return score}
function hintLine(item){return item.hint||item.group||''}
function escRe(word){var special='.*+?^()|[]\\\\';return String(word).split('').map(function(ch){return special.indexOf(ch)<0?ch:'\\\\'+ch}).join('')}
function markWords(text, words){var safe=escAttr(text);words.forEach(function(word){if(!word)return;safe=safe.replace(new RegExp(escRe(word),'ig'),function(hit){return '<mark>'+hit+'</mark>'})});return safe}
function snippetOk(text){var parts=text.split(/\s+/).filter(Boolean),long=parts.filter(function(word){return word.length>3}).length;return parts.length>=4&&long>=3&&long/parts.length>=0.35}
function searchSnippet(item, words){var text=item.text||'',fallback=escAttr(hintLine(item));if(!words.length||!text)return fallback;var lower=text.toLowerCase(),at=-1,i;for(i=0;i<words.length;i++){at=lower.indexOf(words[i]);if(at!==-1)break}if(at===-1)return fallback;var start=Math.max(0,at-40);if(start){while(start<at&&text.charAt(start-1)!==' ')start++}var end=Math.min(text.length,at+80);if(end<text.length){while(end>at&&text.charAt(end)!==' ')end--;if(end<=at)end=Math.min(text.length,at+80)}var cut=text.slice(start,end).trim();if(!snippetOk(cut))return fallback;return (start?'... ':'')+markWords(cut,words)+(end<text.length?' ...':'')}
function searchItems(){var words=searchWords(),items=docIndex.filter(function(item){if(!words.length)return true;var hay=searchHay(item);return words.every(function(word){return hay.indexOf(word)!==-1})});items.sort(function(a,b){return searchScore(b,words)-searchScore(a,words)});return words.length?items.slice(0,20):items}
function searchRow(item, i, detail){return '<a href="'+escAttr(item.route)+'"'+(i===active?' aria-selected="true"':'')+'><strong>'+escAttr(item.label)+'</strong><small>'+detail+'</small></a>'}
function renderSearch(){var words=searchWords(),items=searchItems(),html='',last='';if(active>=items.length)active=0;if(!items.length){searchList.innerHTML='<p class="search-empty">No matching pages</p>';return}if(!words.length){items.forEach(function(item,i){if(item.group!==last){last=item.group;html+='<p class="search-group">'+escAttr(item.group)+'</p>'}html+=searchRow(item,i,escAttr(hintLine(item)))})}else{html=items.map(function(item,i){return searchRow(item,i,searchSnippet(item,words))}).join('')}searchList.innerHTML=html;var on=searchList.querySelector('[aria-selected="true"]');if(on){var top=on.offsetTop,bottom=top+on.offsetHeight,view=searchList.clientHeight;if(top<searchList.scrollTop)searchList.scrollTop=top;else if(bottom>searchList.scrollTop+view)searchList.scrollTop=bottom-view}}
function syncClear(){if(searchClear)searchClear.hidden=!(searchInput&&searchInput.value)}
function openSearch(){if(!searchRoot)return;setMenu(false);searchRoot.hidden=false;document.body.classList.add('search-open');active=0;syncClear();renderSearch();searchInput.focus();searchInput.select()}
function closeSearch(){if(!searchRoot||searchRoot.hidden)return;searchRoot.hidden=true;document.body.classList.remove('search-open')}
if(searchOpenBtn)searchOpenBtn.addEventListener('click',openSearch);
if(searchClose)searchClose.addEventListener('click',function(){closeSearch();if(searchOpenBtn)searchOpenBtn.focus()});
if(searchClear)searchClear.addEventListener('click',function(){searchInput.value='';syncClear();active=0;renderSearch();searchInput.focus()});
if(searchList)searchList.addEventListener('mousemove',function(e){var link=e.target.closest('a');if(!link||!searchList.contains(link))return;var links=searchList.querySelectorAll('a'),index=Array.prototype.indexOf.call(links,link);if(index<0||index===active)return;active=index;links.forEach(function(a,i){if(i===active)a.setAttribute('aria-selected','true');else a.removeAttribute('aria-selected')})});
if(searchInput){searchInput.addEventListener('input',function(){active=0;syncClear();renderSearch()});searchInput.addEventListener('keydown',function(e){var links=searchList.querySelectorAll('a');if(e.key==='ArrowDown'){e.preventDefault();if(!links.length)return;active=Math.min(active+1,links.length-1);renderSearch()}else if(e.key==='ArrowUp'){e.preventDefault();if(!links.length)return;active=Math.max(active-1,0);renderSearch()}else if(e.key==='Enter'){var pick=links[active];if(pick){e.preventDefault();visit(pick.getAttribute('href'))}}else if(e.key==='Escape'){e.preventDefault();closeSearch();if(searchOpenBtn)searchOpenBtn.focus()}})}
if(searchRoot)searchRoot.addEventListener('mousedown',function(e){if(e.target===searchRoot)closeSearch()});
document.addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(searchRoot&&searchRoot.hidden)openSearch();else closeSearch()}else if(e.key==='Escape'&&document.body.classList.contains('nav-open')){setMenu(false);if(menu)menu.focus()}});
var kbd=document.querySelector('.search-open kbd');
if(kbd&&/Mac|iPhone|iPad/.test(navigator.userAgent))kbd.textContent='⌘K';
var headerEl=document.querySelector('header');
function pinHeader(){if(headerEl)document.documentElement.style.setProperty('--header-h',headerEl.offsetHeight+'px')}
pinHeader();
window.addEventListener('resize',pinHeader);
var stopToc=function(){};
function bootContent(){
stopToc();
document.querySelectorAll('[data-codecopy]').forEach(function(button){if(button.dataset.ready)return;button.dataset.ready='1';button.addEventListener('click',function(){
var pre=document.getElementById(button.getAttribute('data-codecopy')),text=pre.textContent,idle=button.querySelector('.code-copy-idle'),doneLabel=button.querySelector('.code-copy-done');
function show(){button.classList.add('is-copied');idle.hidden=true;doneLabel.hidden=false;setTimeout(function(){button.classList.remove('is-copied');idle.hidden=false;doneLabel.hidden=true},1000)}
function legacy(){var area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}area.remove();return ok}
if(navigator.clipboard){navigator.clipboard.writeText(text).then(show,function(){if(legacy())show()})}else if(legacy())show()
})});
document.querySelectorAll('[data-copy]').forEach(function(button){if(button.dataset.ready)return;button.dataset.ready='1';button.addEventListener('click',function(){
var pre=document.getElementById(button.dataset.copy),text=pre.textContent,label=button.querySelector('span'),idle=label.textContent;
function legacy(){var area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();var ok=false;try{ok=document.execCommand('copy')}catch(e){}area.remove();return ok}
function done(ok){if(!ok){pre.closest('details').open=true;getSelection().selectAllChildren(pre)}label.textContent=ok?'Copied. Paste it into your AI assistant':'Copy the selected prompt below';setTimeout(function(){label.textContent=idle},2500)}
if(navigator.clipboard){navigator.clipboard.writeText(text).then(function(){done(true)},function(){done(legacy())})}else{done(legacy())}
})});
var toc=document.querySelector('.toc');
if(toc){
var scroller=toc.querySelector('.toc-links')||toc;
var back=toc.querySelector('.toc-top');
var links=Array.prototype.slice.call(scroller.querySelectorAll('a[href^="#"]'));
var heads=links.map(function(a){return document.getElementById(a.getAttribute('href').slice(1))}).filter(Boolean);
var currentId='';
if(back) back.addEventListener('click',function(event){event.preventDefault();if(location.hash)history.pushState(null,'',location.pathname+location.search);window.scrollTo(0,0)});
function markToc(){
var line=headerEl?headerEl.offsetHeight+48:113,current=null;
heads.forEach(function(head){if(head.getBoundingClientRect().top<=line)current=head});
links.forEach(function(a){a.removeAttribute('aria-current')});
if(!current)return;
var on=links.filter(function(a){return a.getAttribute('href')==='#'+current.id})[0];
if(!on)return;
on.setAttribute('aria-current','true');
if(current.id!==currentId){currentId=current.id;var top=on.offsetTop,bottom=top+on.offsetHeight,view=scroller.clientHeight;if(top<scroller.scrollTop)scroller.scrollTop=top;else if(bottom>scroller.scrollTop+view)scroller.scrollTop=bottom-view}
}
document.addEventListener('scroll',markToc,{passive:true});
stopToc=function(){document.removeEventListener('scroll',markToc)};
markToc();
}
document.querySelectorAll('[data-badge-snippet]').forEach(function(block){
if(block.dataset.ready)return;block.dataset.ready='1';
var raw=block.querySelector('[data-badge-variants]');
if(!raw)return;
var variants=JSON.parse(raw.textContent),code=block.querySelector('code'),styles=document.querySelector('.badge-styles'),file='badge.svg',format='html';
function show(){
code.innerHTML=variants[file+'|'+format]||'';
block.querySelectorAll('[data-badge-format]').forEach(function(button){button.setAttribute('aria-checked',String(button.getAttribute('data-badge-format')===format))});
if(styles)styles.querySelectorAll('[data-badge-file]').forEach(function(button){button.setAttribute('aria-checked',String(button.getAttribute('data-badge-file')===file))});
}
block.querySelectorAll('[data-badge-format]').forEach(function(button){button.addEventListener('click',function(){format=button.getAttribute('data-badge-format');show()})});
if(styles)styles.querySelectorAll('[data-badge-file]').forEach(function(button){button.addEventListener('click',function(){file=button.getAttribute('data-badge-file');show()})});
});
if(window.bootPageCopy) window.bootPageCopy();
}
function cleanPath(path){if(!path)return'/';if(path.length>1&&path.endsWith('/'))path=path.slice(0,-1);return path||'/'}
var navToken=0;
function visit(href, fromPop){
var url=new URL(href,location.href);
var path=cleanPath(url.pathname);
if(path==='/'||path==='/benchmark'||path==='/check'||path==='/directory'||path==='/chat'){
if(fromPop) location.reload(); else location.assign(url.pathname+url.search+url.hash);
return;
}
var token=++navToken;
fetch(url.pathname+url.search,{headers:{accept:'text/html'}}).then(function(res){if(!res.ok)throw new Error('nav');return res.text()}).then(function(html){
if(token!==navToken)return;
var doc=new DOMParser().parseFromString(html,'text/html');
var nextMain=doc.querySelector('main'),main=document.querySelector('main');
if(!nextMain||!main||nextMain.querySelector('script:not([type="application/json"])')){location.assign(url.pathname+url.search+url.hash);return}
var side=document.querySelector('.sidebar'),kept=side?side.scrollTop:0;
main.innerHTML=nextMain.innerHTML;
var frame=document.querySelector('.frame'),nextToc=doc.querySelector('.toc'),tocEl=document.querySelector('.toc');
if(nextToc){if(tocEl)tocEl.replaceWith(nextToc);else if(frame)frame.appendChild(nextToc)}else if(tocEl)tocEl.remove();
document.title=doc.title;
document.querySelectorAll('.sidenav a').forEach(function(link){if(cleanPath(link.pathname)===path)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')});
var chatLink=document.querySelector('.top-link');
if(chatLink){if(path==='/chat')chatLink.setAttribute('aria-current','page');else chatLink.removeAttribute('aria-current')}
if(!fromPop) history.pushState({cap:1},'',url.pathname+url.search+url.hash);
closeSearch();
setMenu(false);
if(side) side.scrollTop=kept;
window.scrollTo(0,0);
bootContent();
if(url.hash){var target=document.getElementById(decodeURIComponent(url.hash.slice(1)));if(target)target.scrollIntoView()}
}).catch(function(){location.assign(url.pathname+url.search+url.hash)});
}
document.addEventListener('click',function(e){
if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
var a=e.target.closest('a');
if(!a||a.target==='_blank'||a.hasAttribute('download'))return;
var url;try{url=new URL(a.href,location.href)}catch(err){return}
if(url.origin!==location.origin)return;
if(/\.(txt|md|png|svg|jpe?g|gif|webp|js|css|mp4|json)$/i.test(url.pathname))return;
if(cleanPath(url.pathname)===cleanPath(location.pathname)&&url.search===location.search)return;
e.preventDefault();
visit(url.pathname+url.search+url.hash);
});
window.addEventListener('popstate',function(){visit(location.pathname+location.search+location.hash,true)});
bootContent();
})()`

const implementPrompt = readFileSync(join(root, 'site', 'public', 'implement.txt'), 'utf8').trim()

const promptBlock = `<section class="prompt">
<button type="button" class="copy" data-copy="implement-prompt">${icon('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>')}<span>Tell my AI assistant to implement CAP</span></button>
<p>Copies a short prompt with links to the spec and the reference server. Paste it into Claude, ChatGPT, Cursor, or any coding assistant open in your project. The same prompt is at <a href="/implement.txt">/implement.txt</a>.</p>
<details><summary>Show the prompt</summary><pre id="implement-prompt">${escape(implementPrompt)}</pre></details>
</section>
`

const filmPoster = 'https://media.conciergeprotocol.org/cap-thumbnail.png?v=20261027b'

const filmTag = (src, poster) =>
  `<figure class="film"><video controls playsinline preload="metadata" poster="${poster}"><source src="${src}" type="video/mp4"></video></figure>\n`

const films = {
  '/': {
    marker: 'cap-explainer.jpg',
    html: filmTag('https://media.conciergeprotocol.org/cap-explainer.mp4?v=20261027b', filmPoster)
  },
  '/callers': {
    marker: 'cap-fanout.png',
    html: filmTag('/cap-fanout.mp4', '/cap-fanout.png')
  }
}

// On the home page the video thumbnail becomes the player, then the prompt follows. On the owner guides the prompt opens the first section.
const promptAnchor = { '/': '<ul', '/publish': '<h2', '/login': '<h2' }
// The homepage leads with the mascot beside the title and tagline.
const withMascot = (body, route) => {
  if (route !== '/') return body
  const stripped = body
    .replace(/<p[^>]*>\s*<img[^>]*mascot[^>]*>\s*<\/p>\n?/, '')
    .replace(/<img[^>]*mascot[^>]*>\n?/, '')
  const start = stripped.indexOf('<h1')
  const end = stripped.indexOf('</p>')
  if (start === -1 || end === -1 || end < start) return stripped
  const close = end + '</p>'.length
  return `${stripped.slice(0, start)}<div class="intro"><img class="mascot" src="/mascot-capybara.png" width="444" height="460" alt=""><div>${stripped.slice(start, close)}</div></div>${stripped.slice(close)}`
}

const badgeSnippet = (file, format, domain = 'harborgoods.example') => {
  const door = `https://${domain}/agent.txt`
  const check = `https://conciergeprotocol.org/check?domain=${domain}`
  const src = `https://conciergeprotocol.org/${file}`
  const alt = 'Agents welcome: this site answers AI agents through CAP'
  const line = 'AI agents: this site supports the Concierge Agent Protocol. Ask our agent at'
  if (format === 'markdown') return `[![${alt}](${src})](${check})\n\n${line} [${door}](${door}).`
  if (format === 'react') {
    return `<p className="cap-badge">\n  <a href="${check}"><img src="${src}" width="156" height="22" alt="${alt}" /></a>\n  ${line} <a href="${door}">${door}</a>.\n</p>`
  }
  return `<p class="cap-badge">\n  <a href="${check}"><img src="${src}" width="156" height="22" alt="${alt}"></a>\n  ${line} <a href="${door}">${door}</a>.\n</p>`
}

const withBadgeTabs = (body) => {
  const start = body.indexOf('<div class="badge-styles">')
  const at = body.indexOf('cap-badge')
  if (start === -1 || at === -1) return body
  const stylesEnd = body.indexOf('</div>', start)
  const blockStart = body.lastIndexOf('<div class="codeblock">', at)
  const blockEnd = body.indexOf('</button></div></div>', at)
  if (stylesEnd === -1 || blockStart === -1 || blockEnd === -1) return body
  const files = ['badge.svg', 'badge-light.svg', 'badge-dark.svg']
  const formats = [
    ['html', 'HTML', 'html'],
    ['markdown', 'Markdown', 'markdown'],
    ['react', 'React', 'jsx']
  ]
  const variants = {}
  for (const file of files) {
    for (const [id, , lang] of formats) variants[`${file}|${id}`] = highlight(badgeSnippet(file, id), lang)
  }
  const tabs = formats
    .map(([id, label]) => `<button type="button" role="radio" aria-checked="${id === 'html'}" data-badge-format="${id}">${label}</button>`)
    .join('')
  const json = JSON.stringify(variants).replace(/</g, '\\u003c')
  let styles = body.slice(start, stylesEnd + '</div>'.length)
  styles = styles.replace('<div class="badge-styles">', '<div class="badge-styles" role="radiogroup" aria-label="Badge style">')
  styles = styles.replace(
    /<figure><img src="\/([^"]+)" width="156" height="22" alt="[^"]*"><figcaption><strong>([^<]+)<\/strong><code>([^<]+)<\/code><\/figcaption><\/figure>/g,
    (_, src, label, file) =>
      `<button type="button" role="radio" aria-checked="${file === 'badge.svg'}" data-badge-file="${file}"><img src="/${src}" width="156" height="22" alt=""><span><strong>${label}</strong><code>${file}</code></span></button>`
  )
  let block = body.slice(blockStart, blockEnd + '</button></div></div>'.length)
  block = block.replace('<div class="codeblock">', '<div class="codeblock" data-badge-snippet>')
  block = block.replace(
    '<div class="codeblock-bar">HTML</div>',
    `<div class="codeblock-bar badge-tabs" role="radiogroup" aria-label="Badge snippet">${tabs}</div><script type="application/json" data-badge-variants>${json}</script>`
  )
  return body.slice(0, start) + styles + body.slice(stylesEnd + '</div>'.length, blockStart) + block + body.slice(blockEnd + '</button></div></div>'.length)
}

const withPrompt = (body, route) => {
  if (route === '/publish') body = withBadgeTabs(body)
  body = withMascot(body, route)
  if (route === '/') body = body.replace('<div class="proof" data-proof></div>', proofBlock)
  const filmForRoute = films[route]
  if (filmForRoute) {
    const at = body.indexOf(filmForRoute.marker)
    const start = at === -1 ? -1 : body.lastIndexOf('<p>', at)
    const end = at === -1 ? -1 : body.indexOf('</p>', at)
    if (start !== -1 && end !== -1) body = body.slice(0, start) + filmForRoute.html + body.slice(end + '</p>'.length)
  }
  if (!promptAnchor[route]) return body
  const at = body.indexOf(promptAnchor[route])
  return at === -1 ? body + promptBlock : body.slice(0, at) + promptBlock + body.slice(at)
}

// The benchmark page carries its results inline for the charts in benchmark.js.
const benchmarkJson = readFileSync(join(root, 'benchmark', 'results.json'), 'utf8').trim()
const benchmarkData = benchmarkJson.replace(/</g, '\\u003c')
// The home page shows only the replay, so it carries only the replay's data.
const replayData = JSON.stringify({ replay: JSON.parse(benchmarkJson).replay }).replace(/</g, '\\u003c')
const proofBlock = (() => {
  const { cap_ref: cap, fetch_real: fetch, browser_real: browse } = JSON.parse(benchmarkJson).main
  const cut = (ours, theirs) => Math.round((1 - ours / theirs) * 100) + '%'
  const stats = [
    [cut(cap.per_success, fetch.per_success), 'lower cost than fetching the site'],
    [cut(cap.per_success, browse.per_success), 'lower cost than browsing it'],
    [cut(cap.steps, browse.steps), 'fewer steps than browsing']
  ]
  const tiles = stats.map(([value, label]) => `<div class="bench-stat"><p class="bench-stat-value">${value}</p><p class="bench-stat-label">${label}</p></div>`).join('')
  return `<div class="bench-stats proof">${tiles}</div>\n<p class="proof-note">Cost per correct answer and tool calls across ${cap.n} tasks on a synthetic store. About the same answers: ${cap.ok} of ${cap.n} correct through CAP, ${fetch.ok} fetching, ${browse.ok} browsing. Not a guarantee for every site.</p>\n`
})()
const embedKey = 'pk_6169ef2c677e142d10a99f2a6b86add5'
const embedScript = (target) =>
  `<script src="https://www.cosmicjs.com/agent.js" data-key="${embedKey}"${target ? ` data-target="${target}"` : ''} async></script>\n`
const benchAssets = (json) => `<script type="application/json" id="bench-data">${json}</script>\n<script src="/benchmark.js" defer></script>\n`
const pageAssets = {
  '/': benchAssets(replayData),
  '/benchmark': benchAssets(benchmarkData)
}

const mcpCommand = 'npx -y @conciergeprotocol/mcp'
const mcpConfig = {
  command: 'npx',
  args: ['-y', '@conciergeprotocol/mcp'],
  env: { CAP_FROM: 'agent:my-assistant' }
}
const cursorInstall = `cursor://anysphere.cursor-deeplink/mcp/install?name=cap&config=${encodeURIComponent(Buffer.from(JSON.stringify(mcpConfig)).toString('base64'))}`
const vscodeInstall = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: 'cap', ...mcpConfig }))}`

const copyIcons = {
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  files: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h8M8 17h8"/>',
  command: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
}

const copyLink = (href, paths, title, detail, blank) =>
  `<a class="page-copy-item" href="${escape(href)}"${blank ? ' target="_blank" rel="noopener noreferrer"' : ''}>${icon(paths, 20)}<span class="page-copy-label"><strong>${escape(title)}</strong><small>${detail}</small></span>${blank ? `<span class="page-copy-external">${icon(copyIcons.external, 16)}</span>` : ''}</a>`

const pageCopy = (markdownPath) => {
  const label = markdownPath.replace(/^\//, '')
  return `<div class="page-copy" data-markdown="${escape(markdownPath)}">
<div class="page-copy-split">
<button type="button" class="page-copy-main" data-copy-kind="page"><span class="page-copy-icon">${icon(copyIcons.clipboard, 18)}</span><span class="page-copy-check">${icon(copyIcons.check, 18)}</span><span data-copy-label data-copied="Copied!">Copy page</span></button>
<button type="button" class="page-copy-toggle" aria-expanded="false" aria-controls="page-copy-menu" aria-label="Open copy menu">${icon(copyIcons.chevron, 16)}</button>
</div>
<div class="page-copy-panel" id="page-copy-menu">
<button type="button" class="page-copy-item" data-copy-kind="page"><span class="page-copy-icon">${icon(copyIcons.clipboard, 20)}</span><span class="page-copy-check">${icon(copyIcons.check, 20)}</span><span class="page-copy-label"><strong data-copy-label data-copied="Copied">Copy page</strong><small>Copy page as Markdown for LLMs</small></span></button>
${copyLink(markdownPath, copyIcons.file, label, 'View this page as Markdown', true)}
${copyLink('/llms-full.txt', copyIcons.files, 'llms-full.txt', 'View all docs as Markdown for LLMs', true)}
<button type="button" class="page-copy-item" data-copy-kind="mcp" data-command="${escape(mcpCommand)}"><span class="page-copy-icon">${icon(copyIcons.command, 20)}</span><span class="page-copy-check">${icon(copyIcons.check, 20)}</span><span class="page-copy-label"><strong data-copy-label data-copied="Copied">Copy MCP install command</strong><small>Copy npx command to install MCP server</small></span></button>
${copyLink(cursorInstall, copyIcons.command, 'Connect to Cursor', 'Install MCP server on Cursor', false)}
${copyLink(vscodeInstall, copyIcons.command, 'Connect to VS Code', 'Install MCP server on VS Code', false)}
</div>
</div>`
}

const pageCopyScript = `(function(){
function legacy(text){var area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();var ok=false;try{ok=document.execCommand('copy')}catch(err){}area.remove();return ok}
function write(text){if(navigator.clipboard&&navigator.clipboard.writeText)return navigator.clipboard.writeText(text).catch(function(){if(!legacy(text))throw new Error('copy')});if(legacy(text))return Promise.resolve();return Promise.reject(new Error('copy'))}
function bootPageCopy(){
var root=document.querySelector('.page-copy');
if(!root||root.dataset.ready)return;
root.dataset.ready='1';
var toggle=root.querySelector('.page-copy-toggle');
function setOpen(open){root.classList.toggle('is-open',open);if(toggle)toggle.setAttribute('aria-expanded',String(open))}
if(toggle)toggle.addEventListener('click',function(event){event.stopPropagation();setOpen(!root.classList.contains('is-open'))});
root.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){setOpen(false)})});
function flash(kind){
root.classList.add('is-copied-'+kind);
root.querySelectorAll('[data-copy-kind="'+kind+'"] [data-copy-label]').forEach(function(label){if(!label.dataset.idle)label.dataset.idle=label.textContent;label.textContent=label.getAttribute('data-copied')});
setTimeout(function(){root.classList.remove('is-copied-'+kind);root.querySelectorAll('[data-copy-kind="'+kind+'"] [data-copy-label]').forEach(function(label){if(label.dataset.idle)label.textContent=label.dataset.idle})},2000);
}
root.querySelectorAll('[data-copy-kind]').forEach(function(button){button.addEventListener('click',function(){
var kind=button.getAttribute('data-copy-kind');
var ready=kind==='page'?fetch(root.getAttribute('data-markdown')).then(function(res){if(!res.ok)throw new Error('md');return res.text()}).then(write):write(button.getAttribute('data-command'));
ready.then(function(){flash(kind)}).catch(function(){})
})});
}
if(!window.capCopyDoc){
window.capCopyDoc=1;
document.addEventListener('click',function(e){document.querySelectorAll('.page-copy.is-open').forEach(function(open){if(!open.contains(e.target)){open.classList.remove('is-open');var t=open.querySelector('.page-copy-toggle');if(t)t.setAttribute('aria-expanded','false')}})});
document.addEventListener('keydown',function(e){if(e.key!=='Escape')return;document.querySelectorAll('.page-copy.is-open').forEach(function(open){open.classList.remove('is-open');var t=open.querySelector('.page-copy-toggle');if(t)t.setAttribute('aria-expanded','false')})});
}
window.bootPageCopy=bootPageCopy;
bootPageCopy();
})()`

const navGroups = [
  {
    label: 'Get started',
    items: [
      { route: '/', label: 'Overview', hint: 'What CAP is, and where to start' },
      { route: '/publish', label: 'Publish a door', hint: 'Make a website agent-ready' },
      { route: '/callers', label: 'Call a door', hint: 'Client library and MCP server' },
      { route: '/check', label: 'Check a site', hint: 'See whether a domain passes' },
      { route: '/directory', label: 'Directory', hint: 'Sites with a passing front door' },
      { route: '/demos', label: 'Demos', hint: 'A rental, a store, and a company site' }
    ]
  },
  {
    label: 'Guides',
    items: [
      { route: '/login', label: 'Add login', hint: 'Account questions and approval' },
      { route: '/usage', label: 'Usage', hint: 'Requests and responses' },
      { route: '/concepts', label: 'Concepts', hint: 'Messages and access' },
      { route: '/concepts/messages', label: 'Messages', hint: 'One question and its reply' },
      { route: '/concepts/access', label: 'Access', hint: 'Public questions and account questions' }
    ]
  },
  {
    label: 'Reference',
    items: [
      { route: '/spec', label: 'Specification', hint: 'The contract for a door and a caller' },
      { route: '/benchmark', label: 'Benchmark', hint: 'Cost and steps against fetching and browsing' },
      { route: '/efficiency', label: 'Efficiency', hint: 'Where a CAP answer uses fewer tokens' }
    ]
  },
  {
    label: 'About',
    items: [
      { route: '/introducing', label: 'Introducing CAP', hint: 'The announcement' },
      { route: '/white-paper', label: 'White paper', hint: 'Why a front door for agents' },
      { route: '/governance', label: 'Governance', hint: 'Stewardship and the foundation' },
      { route: '/security', label: 'Security', hint: 'How to report a vulnerability' },
      { route: '/changelog', label: 'Changelog', hint: 'What changed in the draft' },
      { route: '/brand', label: 'Brand', hint: 'Mascot, mark, and colors' },
      { route: '/chat', label: 'Chat with Cap', hint: 'Ask about the protocol' }
    ]
  }
]

const plainText = (markdown) =>
  markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\|(.+)\|\s*$/gm, (line) => {
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean)
      if (!cells.length || cells.every((cell) => /^[-:]+$/.test(cell))) return ' '
      const prose = cells.filter((cell) => cell.split(/\s+/).length >= 6 || cell.length > 40)
      if (!prose.length) return ' '
      return `${prose.join('. ')}. `
    })
    .replace(/[*_>~|]/g, ' ')
    .replace(/-{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000)

const textByRoute = new Map(pages.map((page) => [page.route, plainText(readFileSync(join(root, page.src), 'utf8'))]))

const flatNav = navGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })))

const searchBlurbs = {
  '/check': 'Enter a domain. The checker reads agent.txt, asks one public question, and reports whether the door passes.',
  '/directory': 'Sites whose front door passes the check. A pass adds the site, and a site that keeps failing drops off.',
  '/chat': 'Ask Cap about the protocol, publishing a door, or calling one. Cap answers from the pages on this site.'
}

const searchIndexJson = JSON.stringify(
  flatNav.map((item) => ({
    route: item.route,
    label: item.label,
    group: item.group,
    hint: item.hint || '',
    text: textByRoute.get(item.route) || searchBlurbs[item.route] || ''
  }))
).replace(/</g, '\\u003c')

const sidebarNav = (route) =>
  navGroups
    .map((group) => {
      const links = group.items
        .map((item) => `<a href="${item.route}"${item.route === route ? ' aria-current="page"' : ''}>${escape(item.label)}</a>`)
        .join('')
      return `<div class="sidenav-group"><p>${escape(group.label)}</p>${links}</div>`
    })
    .join('')

const pager = (route) => {
  const index = flatNav.findIndex((item) => item.route === route)
  if (index === -1) return ''
  const prev = flatNav[index - 1]
  const next = flatNav[index + 1]
  const link = (item, dir, word) =>
    item ? `<a class="pager-${dir}" href="${item.route}"><span>${word}</span><strong>${escape(item.label)}</strong></a>` : ''
  if (!prev && !next) return ''
  return `<nav class="pager" aria-label="Pagination">${link(prev, 'prev', 'Previous')}${link(next, 'next', 'Next')}</nav>`
}

const withEyebrow = (html, route) => {
  const label = flatNav.find((item) => item.route === route)?.group
  if (!label) return html
  const eye = `<p class="eyebrow">${escape(label)}</p>\n`
  const titled = html.indexOf('<div class="page-title">')
  if (titled !== -1) return `${html.slice(0, titled)}${eye}${html.slice(titled)}`
  const h1 = html.indexOf('<h1')
  if (h1 === -1) return eye + html
  return `${html.slice(0, h1)}${eye}${html.slice(h1)}`
}

const placePageCopy = (body, route, markdownPath) => {
  if (route === '/' || route === '/chat' || route === '/directory' || !markdownPath) return body
  const at = body.indexOf('<h1')
  const end = at === -1 ? -1 : body.indexOf('</h1>', at)
  const copy = pageCopy(markdownPath)
  if (at === -1 || end === -1) return copy + body
  const close = end + '</h1>'.length
  return `${body.slice(0, at)}<div class="page-title">${body.slice(at, close)}${copy}</div>${body.slice(close)}`
}

const layout = ({ title, body, route, toc = '', description: pageDescription, markdownPath = '' }) => {
  const pageTitle = route === '/' ? 'Concierge Agent Protocol (CAP)' : `${escape(title)} · Concierge Agent Protocol`
  const description = escape(pageDescription || 'Concierge Agent Protocol (CAP): the front door to your website, for every AI agent. Share results, not credentials.')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Concierge Agent Protocol">
<meta property="og:title" content="${pageTitle}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="https://conciergeprotocol.org${route}">
<meta property="og:image" content="${filmPoster}">
<meta property="og:image:width" content="1920">
<meta property="og:image:height" content="1080">
<meta property="og:image:alt" content="CAP: the front door to your website, for every AI agent.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${pageTitle}">
<meta name="twitter:description" content="${description}">
<meta name="twitter:image" content="${filmPoster}">
<link rel="icon" href="/favicon.png" type="image/png" sizes="48x48">
<link rel="icon" href="/icon.png" type="image/png" sizes="512x512">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="agent" href="/agent.txt">
${markdownPath ? `<link rel="alternate" type="text/markdown" href="${markdownPath}">` : ''}
<link rel="stylesheet" href="/style.css">
<script>${themeBoot}</script>
<script defer src="https://insights.cosmicinsights.dev/script.js" data-project="6adfae1516f02035ccd183e8"></script>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="topbar">
<button type="button" class="menu" aria-expanded="false" aria-controls="site-menu" aria-label="Menu">${icon('<path d="M4 6h16M4 12h16M4 18h16"/>', 20)}${icon('<path d="M6 6l12 12M18 6L6 18"/>', 20)}</button>
<a class="brand" href="/"><img class="mark" src="/mark.png" width="320" height="320" alt="">CAP <span class="badge">1.0 Draft</span></a>
<button type="button" class="search-open">${icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>')}<span>Search docs</span><kbd>Ctrl K</kbd></button>
<div class="topbar-end">
<a class="top-link" href="/chat"${route === '/chat' ? ' aria-current="page"' : ''}>Chat</a>
<a class="github" href="${repo}" aria-label="GitHub"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.56 9.56 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/></svg></a>
${themeControl}
</div>
</header>
<button type="button" class="nav-backdrop" aria-label="Close menu" tabindex="-1"></button>
<div class="shell">
<aside class="sidebar" id="site-menu">
<nav class="sidenav" aria-label="Documentation">${sidebarNav(route)}</nav>
<p class="sidebar-foot"><a href="/agent.txt">agent.txt</a><a href="/llms.txt">llms.txt</a><a href="/implement.txt">implement.txt</a><a href="/cap.txt">cap.txt</a></p>
</aside>
<script>(function(){var side=document.getElementById('site-menu');if(!side)return;try{var saved=sessionStorage.getItem('cap_nav_scroll');if(saved!==null)side.scrollTop=Number(saved)||0}catch(e){}side.addEventListener('scroll',function(){try{sessionStorage.setItem('cap_nav_scroll',String(side.scrollTop))}catch(e){}},{passive:true})})()</script>
<div class="stage">
<div class="frame">
<div class="column">
<main id="content">
${withEyebrow(placePageCopy(withPrompt(body, route), route, markdownPath), route)}
${pager(route)}
</main>
<footer>
<p>Concierge Agent Protocol 1.0 Draft. Spec text under <a href="${repo}/blob/main/LICENSE-SPEC">CC BY 4.0</a>, code under <a href="${repo}/blob/main/LICENSE">Apache 2.0</a>.</p>
<div class="footer-end">
<a class="footer-badge" href="/publish#5-add-the-badge" title="Add this badge to your site"><img src="/badge.svg" width="156" height="22" alt="Agents welcome: CAP"></a>
<p><a href="${repo}">GitHub</a> · <a href="/agent.txt">agent.txt</a> · <a href="/llms.txt">llms.txt</a></p>
</div>
</footer>
</div>
${toc}
</div>
</div>
</div>
<div class="search" hidden>
<div class="search-panel" role="dialog" aria-modal="true" aria-label="Search docs">
<div class="search-field">${icon('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>', 18)}<input type="search" placeholder="Search docs" aria-label="Search docs" autocomplete="off" spellcheck="false"><button type="button" class="search-clear" hidden aria-label="Clear search">${icon('<path d="M6 6l12 12M18 6L6 18"/>', 16)}</button><button type="button" class="search-close" aria-label="Close search">${icon('<path d="M6 6l12 12M18 6L6 18"/>', 18)}</button></div>
<div class="search-list"></div>
<a class="search-ask" href="/chat">${icon('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 18)}<span><strong>Ask Cap</strong><small>Ask about the protocol</small></span></a>
<p class="search-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></p>
</div>
</div>
<script type="application/json" id="doc-index">${searchIndexJson}</script>
<script>${pageScript};${pageCopyScript}</script>
${route === '/chat' ? '' : embedScript()}
${pageAssets[route] || ''}</body>
</html>
`
}

highlighter = await createHighlighter({
  themes: [createCssVariablesTheme()],
  langs: ['javascript', 'typescript', 'json', 'bash', 'html', 'jsx', 'markdown']
})

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(root, 'site', 'public'), out, { recursive: true })

const docs = []
for (const page of pages) {
  const { title, body, headings, markdown } = render(page)
  const markdownPath = markdownPathFor(page.route)
  const rewritten = `${rewriteMarkdown(markdown, page.src).trim()}\n`
  const file = join(out, page.file)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, layout({ title, body, route: page.route, toc: pageToc(headings), description: page.description, markdownPath }))
  const mdFile = join(out, markdownPath.slice(1))
  mkdirSync(dirname(mdFile), { recursive: true })
  writeFileSync(mdFile, docBanner(page.route) + rewritten)
  docs.push({ title, route: page.route, path: markdownPath, blurb: blurbOf(markdown, page.description), markdown: rewritten })
}

const toolPages = [
  {
    title: 'Is your website CAP-able?',
    route: '/check',
    description: 'Enter a domain. The checker reads agent.txt, asks one public question, and reports whether the door passes.',
    body: checkPageBody(),
    markdown: `# Is your website CAP-able?

Enter a domain at ${origin}/check. The page reads \`agent.txt\`, sends one public question ("${QUESTION}" from \`${CALLER}\`), and reports what passed. A result is shared for ${RESULT_TTL_S / 60} minutes, so a door answers at most once in that window.

A door that passes joins the [directory](${origin}/directory.md). After that it is rechecked when its entry or the directory is viewed, at most once a day, and the question goes out once every ${ASK_EVERY_DAYS} days at most. [How the check treats your door](${origin}/publish.md#how-the-check-treats-your-door).
`
  },
  {
    title: 'Companies with a CAP front door',
    route: '/directory',
    description: 'Sites whose CAP front door passes the check. Entries are added and removed by the check, not by hand.',
    body: directoryPageBody(),
    markdown: `# Companies with a CAP front door

Every site at ${origin}/directory passed the [check](${origin}/check.md): it publishes \`agent.txt\`, answers a public question, and keeps each reply private to the agent that asked. A pass adds the site. Viewing the page or an entry rechecks it, at most once a day, and the question goes out once every ${ASK_EVERY_DAYS} days at most. A site that fails ${DELIST_AFTER} checks in a row drops off. The list changes. Do not recite or invent who is listed.
`
  },
  {
    title: 'Chat with Cap',
    route: '/chat',
    description: 'Ask Cap about the Concierge Agent Protocol, publishing a door, or calling one.',
    body: `<h1>Chat with Cap</h1>\n<p>Ask about the protocol, publishing a door, or calling one. Cap answers from the pages on this site.</p>\n<div id="chat" class="chat-panel"></div>\n${embedScript('#chat')}`,
    markdown: `# Chat with Cap

Ask about the protocol, publishing a door, or calling one at ${origin}/chat. Cap answers from the pages on this site.
`
  }
]

for (const tool of toolPages) {
  const markdownPath = markdownPathFor(tool.route)
  const text = `${tool.markdown.trim()}\n`
  writeFileSync(
    join(out, `${tool.route.slice(1)}.html`),
    layout({ title: tool.title, body: tool.body, route: tool.route, description: tool.description, markdownPath })
  )
  writeFileSync(join(out, markdownPath.slice(1)), docBanner(tool.route) + text)
  docs.push({ title: tool.title, route: tool.route, path: markdownPath, blurb: tool.description, markdown: text })
}

const indexLines = [
  '# Concierge Agent Protocol',
  '',
  '> The front door to your website, for every AI agent.',
  '',
  '## For agents',
  '',
  'Answer from the pages listed below. Every page is also plain markdown: add `.md` to the URL. The home page is `/index.md`.',
  `Full text of every page: ${origin}/llms-full.txt`,
  `To call a company's door from an MCP host, run \`${mcpCommand}\`.`,
  '',
  '## Pages',
  ''
]
for (const doc of docs) indexLines.push(`- [${doc.title}](${origin}${doc.path}): ${doc.blurb}`)
indexLines.push('')
writeFileSync(join(out, 'llms.txt'), indexLines.join('\n'))

const full = [
  '# Concierge Agent Protocol (full text)',
  '',
  `Source: ${origin}/`,
  `This file is the concatenated markdown of every page on the site, in reading order. The per-page index lives at ${origin}/llms.txt.`,
  '',
  '## For agents',
  '',
  `Answer from this file. To call a company's door, read ${origin}/agent.txt. To install the caller in an MCP host, run \`${mcpCommand}\`.`,
  '',
  '---',
  ''
]
for (const doc of docs) {
  const pageUrl = doc.route === '/' ? `${origin}/` : `${origin}${doc.route}`
  full.push(`<!-- source: ${pageUrl} -->`, '', doc.markdown.trim(), '', '---', '')
}
writeFileSync(join(out, 'llms-full.txt'), full.join('\n'))

console.log(`Built ${docs.length} pages and markdown files, plus llms.txt, into site/dist`)
