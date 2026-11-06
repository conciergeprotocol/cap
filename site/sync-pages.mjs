/**
 * Copy the site's pages into the production bucket as `site-pages`, so Cap
 * answers from the same text the site publishes. Pages are matched by slug
 * and skipped when their content hash is unchanged.
 *
 *   node --env-file=.env site/sync-pages.mjs --force
 *
 * Production builds run this. Other builds skip it, and a failure there does
 * not fail the site build.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBucketClient } from '@cosmicjs/sdk'
import { marked } from 'marked'

const TYPE = 'site-pages'
const SITE = 'https://conciergeprotocol.org'
const FORCE = process.argv.includes('--force')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// Keep this aligned with the pages in site/build.mjs.
const sources = [
  { src: 'home.md', route: '/' },
  { src: 'publish.md', route: '/publish', description: 'Give AI agents your answer, from your own content, with a link to the product, plan, or booking page on your site. One file and two endpoints.' },
  { src: 'callers.md', route: '/callers' },
  { src: 'spec.md', route: '/spec' },
  { src: 'usage.md', route: '/usage' },
  { src: 'login.md', route: '/login' },
  { src: 'benchmark/README.md', route: '/benchmark', description: 'Same answers, a fifth of the cost, a third of the steps. Frozen runs compare asking a store through CAP with fetching its pages and browsing them.' },
  { src: 'concepts/README.md', route: '/concepts' },
  { src: 'concepts/messages.md', route: '/concepts/messages' },
  { src: 'concepts/access.md', route: '/concepts/access' },
  { src: 'article/introducing-the-concierge-agent-protocol.md', route: '/introducing' },
  { src: 'article/white-paper.md', route: '/white-paper' },
  { src: 'GOVERNANCE.md', route: '/governance' },
  { src: 'SECURITY.md', route: '/security' },
  { src: 'CHANGELOG.md', route: '/changelog' },
  { src: 'brand.md', route: '/brand', description: 'The CAP mascot, mark, icon, and colors, with guidance for using them.' }
]

const typeDef = {
  title: 'Site pages',
  singular: 'Site page',
  slug: TYPE,
  emoji: '📄',
  options: { slug_field: true, content_editor: false },
  metafields: [
    { key: 'url', title: 'URL', type: 'text', required: true },
    { key: 'description', title: 'Description', type: 'textarea' },
    { key: 'body', title: 'Body', type: 'rich-text', required: true },
    { key: 'source_path', title: 'Source path', type: 'text', required: true },
    { key: 'content_hash', title: 'Content hash', type: 'text' }
  ]
}

const slugFor = (route) => (route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-'))

const plain = (text) => text.replace(/<[^>]+>/g, ' ').replace(/[*_`#>[\]]/g, '').replace(/\s+/g, ' ').trim()

const firstParagraph = (markdown) => {
  let pastHeading = false
  for (const line of markdown.split('\n')) {
    if (/^#\s+/.test(line)) {
      pastHeading = true
      continue
    }
    if (!pastHeading || !line.trim() || line.startsWith('<')) continue
    const text = plain(line)
    if (text) return text.slice(0, 400)
  }
  return ''
}

const page = async ({ slug, title, url, description, sourcePath, markdown }) => {
  let body = marked.parse(markdown)
  if (body instanceof Promise) body = await body
  const hash = createHash('sha256').update(`${title}\n${url}\n${body}`).digest('hex')
  return { slug, title, url, description, sourcePath, body, hash }
}

async function pages() {
  const fromFiles = []
  for (const source of sources) {
    const markdown = readFileSync(join(root, source.src), 'utf8')
    const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || source.route
    fromFiles.push(await page({
      slug: slugFor(source.route),
      title: plain(title),
      url: `${SITE}${source.route === '/' ? '' : source.route}`,
      description: source.description || firstParagraph(markdown),
      sourcePath: source.src,
      markdown
    }))
  }
  const capTxt = readFileSync(join(root, 'site', 'public', 'cap.txt'), 'utf8')
  fromFiles.push(await page({
    slug: 'cap-txt',
    title: 'cap.txt',
    url: `${SITE}/cap.txt`,
    description: 'The short notes a visiting agent reads for how to call the CAP URL from agent.txt.',
    sourcePath: 'site/public/cap.txt',
    markdown: capTxt
  }))
  fromFiles.push(await page({
    slug: 'check',
    title: 'Is your website CAP-able?',
    url: `${SITE}/check`,
    description: 'Enter a domain. The check reads agent.txt, asks one public question, and reports whether the door passes.',
    sourcePath: 'site/check',
    markdown: 'The checker at https://conciergeprotocol.org/check takes a domain and reads its agent.txt. It asks one public question and reports whether the door passes. Nothing is stored as a copy of the answer. Send a visitor here to test a domain. Do not invent a result.'
  }))
  fromFiles.push(await page({
    slug: 'directory',
    title: 'Companies with a CAP front door',
    url: `${SITE}/directory`,
    description: 'Sites whose CAP front door passes the check. Entries are added and removed by the check, not by hand.',
    sourcePath: 'site/directory',
    markdown: 'The directory at https://conciergeprotocol.org/directory lists sites whose door has passed the check. Entries are added and removed by the check, not by hand, and the list changes. Send the visitor to that page. Do not recite or invent who is listed.'
  }))
  return fromFiles
}

const orNull = async (run) => {
  try {
    return await run()
  } catch (err) {
    if (err?.status === 404) return null
    throw err
  }
}

async function main() {
  if (!FORCE && process.env.VERCEL_ENV !== 'production') {
    console.log('[sync-pages] Skipped: not a production build.')
    return
  }
  const bucket = process.env.COSMIC_BUCKET_SLUG
  const readKey = process.env.COSMIC_READ_KEY
  const writeKey = process.env.COSMIC_WRITE_KEY
  if (!bucket || !readKey || !writeKey) {
    throw new Error('COSMIC_BUCKET_SLUG, COSMIC_READ_KEY, and COSMIC_WRITE_KEY are required.')
  }
  const cosmic = createBucketClient({ bucketSlug: bucket, readKey, writeKey })
  const found = await orNull(() => cosmic.objectTypes.findOne(TYPE))
  if (!found) await cosmic.objectTypes.insertOne(typeDef)

  const list = await pages()
  let existing = []
  try {
    const res = await cosmic.objects.find({ type: TYPE }).props('id,slug,status,metadata.content_hash').status('any').limit(1000)
    existing = res.objects || []
  } catch (err) {
    if (err?.status !== 404) throw err
  }
  const bySlug = new Map(existing.map((object) => [object.slug, object]))
  let created = 0
  let updated = 0
  let unchanged = 0
  for (const item of list) {
    const data = {
      title: item.title,
      content: '',
      status: 'published',
      metadata: {
        url: item.url,
        description: item.description,
        body: item.body,
        source_path: item.sourcePath,
        content_hash: item.hash
      }
    }
    const current = bySlug.get(item.slug)
    bySlug.delete(item.slug)
    if (current && current.status === 'published' && current.metadata?.content_hash === item.hash) {
      unchanged += 1
      continue
    }
    if (current) await cosmic.objects.updateOne(current.id, data)
    else await cosmic.objects.insertOne({ ...data, type: TYPE, slug: item.slug })
    if (current) updated += 1
    else created += 1
  }
  let deleted = 0
  for (const stale of bySlug.values()) {
    await cosmic.objects.deleteOne(stale.id)
    deleted += 1
  }
  console.log(`[sync-pages] ${list.length} pages, ${created} created, ${updated} updated, ${unchanged} unchanged, ${deleted} deleted.`)
}

main().catch((err) => {
  console.error('[sync-pages] Failed:', err?.message || err)
  process.exit(FORCE ? 1 : 0)
})
