import { startStore } from './store.mjs'

const store = await startStore()
console.log(`Harbor Goods on ${store.base}`)
