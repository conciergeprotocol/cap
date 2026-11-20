import { JUDGE_MODEL } from './constants.mjs'

const API = 'https://api.anthropic.com/v1/messages'

export async function gradeReply({ apiKey, prompt, reply, model = JUDGE_MODEL }) {
  if (!apiKey || !reply) return null
  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      system:
        'Grade one agent reply. Return JSON only: {"accuracy":0-100,"completeness":0-100,"note":"one sentence"}. Accuracy is whether the reply is on topic and not evasive. Completeness is whether it answers the question. Do not browse.',
      messages: [{ role: 'user', content: `Question: ${prompt}\n\nReply: ${reply.slice(0, 4000)}` }],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) return null
  const body = await res.json()
  const text = (body.content || []).map((block) => block.text || '').join('')
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return {
      accuracy: clamp(parsed.accuracy),
      completeness: clamp(parsed.completeness),
      note: String(parsed.note || '').slice(0, 240),
      costUsd: dollars(body.usage, model),
    }
  } catch {
    return null
  }
}

function clamp(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(100, Math.round(number)))
}

function dollars(usage = {}, model) {
  const input = (usage.input_tokens || 0) / 1_000_000
  const output = (usage.output_tokens || 0) / 1_000_000
  const rates = String(model).includes('opus') ? [15, 75] : [3, 15]
  return Number((input * rates[0] + output * rates[1]).toFixed(4))
}
