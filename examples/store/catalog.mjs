// Stands in for the store's own search. A real owner might use semantic search over its CMS.
// The visiting agent never sees this list, only the reply.
export const PRODUCTS = [
  { slug: 'stride-runner', name: 'Stride Runner', type: 'shoes', colors: ['black'], sizes: ['9', '10', '11', '12', '13'], price: 120, tags: ['minimal', 'road'] },
  { slug: 'cloud-trainer', name: 'Cloud Trainer', type: 'shoes', colors: ['white', 'blue'], sizes: ['8', '9', '10', '11', '12'], price: 135, tags: ['bold', 'road'] },
  { slug: 'ridge-trail', name: 'Ridge Trail', type: 'shoes', colors: ['black', 'orange'], sizes: ['9', '10', '11'], price: 140, tags: ['trail'] },
  { slug: 'tempo-runner', name: 'Tempo Runner', type: 'shoes', colors: ['black'], sizes: ['10', '11', '12', '13'], price: 95, tags: ['minimal', 'road'] },
  { slug: 'fleece-jogger', name: 'Everyday Fleece Jogger', type: 'pants', colors: ['black', 'gray'], sizes: ['S', 'M', 'L', 'XL'], price: 65, tags: ['minimal'] },
  { slug: 'logo-sweatpant', name: 'Logo Sweatpant', type: 'pants', colors: ['black'], sizes: ['S', 'M'], price: 55, tags: ['logo'] },
  { slug: 'heavyweight-hoodie', name: 'Heavyweight Hoodie', type: 'hoodie', colors: ['black', 'gray'], sizes: ['M', 'L', 'XL', 'XXL'], price: 85, tags: ['minimal'] },
  { slug: 'graphic-hoodie', name: 'Graphic Hoodie', type: 'hoodie', colors: ['black'], sizes: ['S', 'M', 'L'], price: 75, tags: ['graphic', 'logo'] },
  { slug: 'zip-hoodie', name: 'Zip Hoodie', type: 'hoodie', colors: ['gray', 'blue'], sizes: ['S', 'M', 'L', 'XL'], price: 80, tags: ['minimal'] },
  { slug: 'everyday-hoodie', name: 'Everyday Hoodie', type: 'hoodie', colors: ['black'], sizes: ['M', 'L', 'XL'], price: 60, tags: ['minimal'] },
]

const ORIGIN = 'https://harborgoods.example'
const TYPES = [
  { type: 'shoes', label: 'Running shoes', size: 'shoes', words: /\b(running shoes?|shoes?|sneakers?|runners?)\b/i },
  { type: 'pants', label: 'Sweatpants', size: 'bottoms', words: /\b(sweatpants?|joggers?|sweats)\b/i },
  { type: 'hoodie', label: 'Hoodie', size: 'tops', words: /\b(hoodies?|sweatshirts?)\b/i },
]
const COLORS = ['black', 'white', 'gray', 'blue', 'orange']

function fitsStyle(product, style) {
  const plain = /minimal|plain|no logo/i.test(style)
  return !(plain && product.tags.some((tag) => tag === 'logo' || tag === 'graphic'))
}

function best(products, color, style) {
  const score = (product) =>
    (color && product.colors.includes(color) ? 3 : 0)
    + product.tags.filter((tag) => style.toLowerCase().includes(tag)).length
    - (fitsStyle(product, style) ? 0 : 5)
  return [...products].sort((a, b) => score(b) - score(a))[0]
}

function cheapest(products, style) {
  return products.filter((p) => fitsStyle(p, style)).sort((a, b) => a.price - b.price)[0]
}

export function isProductRequest(message) {
  return TYPES.some((kind) => kind.words.test(message))
}

/** `cheaper: true` swaps each pick for the lowest price that still fits the brief. */
export function search(message, context = {}, { cheaper = false } = {}) {
  const clauses = message.split(/,|\band\b/i)
  const style = String(context.style || '')
  const sizes = context.sizes && typeof context.sizes === 'object' ? context.sizes : {}
  const lines = []
  for (const kind of TYPES) {
    const clause = clauses.find((part) => kind.words.test(part))
    if (!clause) continue
    const color = COLORS.find((name) => clause.toLowerCase().includes(name)) || COLORS.find((name) => style.toLowerCase().includes(name))
    const size = String(clause.match(/\bsize\s+([0-9]{1,2}|[smlx]{1,3})\b/i)?.[1] || sizes[kind.size] || '').toUpperCase()
    const fits = PRODUCTS.filter((p) => p.type === kind.type && (!size || p.sizes.includes(size)) && (!color || p.colors.includes(color)))
    const first = best(fits, color, style)
    if (!first) {
      lines.push(`- ${kind.label}: nothing${color ? ` in ${color}` : ''}${size ? ` in size ${size}` : ''} right now.`)
      continue
    }
    const pick = cheaper ? cheapest(fits, style) || first : first
    if (cheaper && pick === first) {
      lines.push(`- ${kind.label}: ${first.name} at $${first.price} is already the lowest price${size ? ` in size ${size}` : ''}.`)
      continue
    }
    const shade = color || pick.colors[0]
    lines.push(`- ${kind.label}: ${pick.name}, ${shade}${size ? `, size ${size} in stock` : ''}, $${pick.price}. ${ORIGIN}/p/${pick.slug}`)
  }
  if (!lines.length) return 'I can help with running shoes, sweatpants, and hoodies. What are you looking for?'
  return `${cheaper ? 'Cheaper options that still fit:' : 'Here is what fits:'}\n${lines.join('\n')}\nCheckout is on our site.`
}
