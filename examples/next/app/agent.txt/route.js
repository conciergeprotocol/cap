import { door } from '../door.js'

export function GET(request) {
  return door.handle(request)
}

export function OPTIONS(request) {
  return door.handle(request)
}
