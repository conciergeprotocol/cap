import { door } from '../../../door.js'

export function POST(request) {
  return door.handle(request)
}

export function OPTIONS(request) {
  return door.handle(request)
}
