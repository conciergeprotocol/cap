import { deflateSync } from 'node:zlib'

const WIDTH = 1200
const HEIGHT = 630

// 5x7 glyphs, one 5-bit row per entry. Missing characters are skipped.
const FONT = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '.': [0, 0, 0, 0, 0, 0b01100, 0b01100],
  '-': [0, 0, 0, 0b11111, 0, 0, 0],
  '/': [0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0, 0],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b10000, 0b11110, 0b00001, 0b00001, 0b11110],
  '6': [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
}

const BG = [17, 17, 17]
const FG = [255, 255, 255]
const MUTED = [154, 161, 171]
const ACCENT = [110, 168, 254]

export function renderScoreCard({ domain, score, checkedMax, blocked, pending }) {
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3, 0)
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = BG[0]
    pixels[i + 1] = BG[1]
    pixels[i + 2] = BG[2]
  }
  const set = (x, y, color) => {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return
    const at = (y * WIDTH + x) * 3
    pixels[at] = color[0]
    pixels[at + 1] = color[1]
    pixels[at + 2] = color[2]
  }
  const max = checkedMax || 100
  const fraction = pending || (blocked && !max) ? 0 : Math.max(0, Math.min(1, (score || 0) / (max || 100)))
  ring(set, 250, 315, 150, 14, fraction, blocked || pending ? MUTED : ACCENT)
  const number = pending ? '--' : blocked && !checkedMax ? '--' : String(score ?? 0)
  const numberWidth = measure(number, 16)
  blit(set, number, 250 - numberWidth / 2, 315 - 56, 16, FG)
  blit(set, 'AGENT READINESS', 520, 180, 5, MUTED)
  blit(set, clip(String(domain || '').toUpperCase(), 22), 520, 250, 6, FG)
  const line = pending ? 'NOT SCORED YET' : blocked ? `BLOCKED  ${score || 0} OF ${checkedMax || 0} CHECKED` : `${score || 0} OF ${max}`
  blit(set, line, 520, 360, 4, ACCENT)
  return encodePng(pixels, WIDTH, HEIGHT)
}

function clip(text, max) {
  const clean = text.replace(/[^A-Z0-9.-]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean
}

function measure(text, scale) {
  return [...text].filter((ch) => FONT[ch]).length * 6 * scale
}

function blit(set, text, x, y, scale, color) {
  let cursor = x
  for (const ch of text) {
    const rows = FONT[ch]
    if (!rows) continue
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if ((rows[row] >> (4 - col)) & 1) {
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) set(cursor + col * scale + sx, y + row * scale + sy, color)
          }
        }
      }
    }
    cursor += 6 * scale
  }
}

function ring(set, cx, cy, radius, thickness, fraction, color) {
  const track = [42, 42, 42]
  for (let y = cy - radius - thickness; y <= cy + radius + thickness; y++) {
    for (let x = cx - radius - thickness; x <= cx + radius + thickness; x++) {
      const dx = x - cx
      const dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (Math.abs(dist - radius) > thickness / 2) continue
      let angle = Math.atan2(dy, dx) + Math.PI / 2
      if (angle < 0) angle += Math.PI * 2
      set(x, y, angle / (Math.PI * 2) <= fraction ? color : track)
    }
  }
}

function encodePng(pixels, width, height) {
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    raw[row] = 0
    pixels.copy(raw, row + 1, y * width * 3, (y + 1) * width * 3)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
