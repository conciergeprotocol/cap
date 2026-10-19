import { answer } from '../answer.mjs'
import { createDoor } from '../door.mjs'

export const door = createDoor({
  name: 'Example',
  chat: 'https://example.com/chat',
  answer,
})
