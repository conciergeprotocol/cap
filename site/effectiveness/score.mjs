const WEIGHTS = {
  accuracy: 30,
  completeness: 25,
  completion: 20,
  actionability: 15,
  efficiency: 10,
}

export function quoteFound(quote, pages) {
  const needle = normalize(quote)
  if (needle.length < 8) return false
  return pages.some((page) => normalize(page.text).includes(needle))
}

export function scoreTask({ status, claims, pages, nextStep, stopped }) {
  if (stopped === 'timeout' || stopped === 'budget' || stopped === 'error') {
    return { outcome: 'error', score: null, dims: zero(), penalties: [stopped || 'error'] }
  }
  const checked = (claims || []).map((claim) => ({
    ...claim,
    quoteFound: quoteFound(claim.quote, pages),
    verdict: quoteFound(claim.quote, pages) ? 'supported' : 'unsupported',
  }))
  const supported = checked.filter((claim) => claim.quoteFound).length
  if (status === 'not_available') {
    return { outcome: 'absent', score: 30, dims: dimsFrom(30), claims: checked, penalties: [] }
  }
  if (status !== 'found') {
    return { outcome: 'error', score: null, dims: zero(), claims: checked, penalties: ['no answer'] }
  }
  if (!supported) {
    return {
      outcome: 'incorrect',
      score: 10,
      dims: dimsFrom(10),
      claims: checked,
      penalties: ['no supported quote'],
    }
  }
  const ratio = supported / checked.length
  let score = Math.round(55 + ratio * 35)
  if (nextStep?.onSite && nextStep.status >= 200 && nextStep.status < 400) score = Math.min(100, score + 5)
  return { outcome: ratio === 1 ? 'answered' : 'partial', score, dims: dimsFrom(score), claims: checked, penalties: [] }
}

export function scoreReply({ reply, error, links = [], wallMs = 0, grade = null }) {
  if (!reply) {
    return {
      outcome: 'error',
      score: 0,
      dims: dimsFrom(0),
      claims: [],
      penalties: [error || 'no reply'],
    }
  }
  const refused = /\b(cannot|can't|can not|unable|not available|don't know|do not know|not published|login required)\b/i.test(reply)
  if (refused && reply.length < 400) {
    return { outcome: 'absent', score: 30, dims: dimsFrom(30), claims: [], penalties: [] }
  }
  const resolved = links.filter((link) => link.onSite && link.status >= 200 && link.status < 400)
  let score = reply.length > 80 ? 60 : 45
  if (resolved.length) score += 20
  if (wallMs > 0 && wallMs < 15_000) score += 10
  if (wallMs > 40_000) score -= 10
  if (grade) score = Math.round(score * 0.6 + ((grade.accuracy + grade.completeness) / 2) * 0.4)
  score = Math.max(0, Math.min(100, score))
  const claims = grade?.note
    ? [{ text: grade.note, quote: '', quoteFound: false, verdict: 'unverifiable', judgeNote: 'Optional model grade.' }]
    : []
  return {
    outcome: score >= 70 ? 'answered' : 'partial',
    score,
    dims: dimsFrom(score),
    claims,
    penalties: resolved.length ? [] : ['no working on-site link in the reply'],
  }
}

export function aggregate(tasks) {
  const scored = tasks.filter((task) => typeof task.score === 'number')
  const publicScore = scored.length
    ? Math.round(scored.reduce((sum, task) => sum + task.score, 0) / scored.length)
    : null
  const status = scored.length >= 4 ? 'scored' : scored.length ? 'incomplete' : 'blocked'
  const confidence = scored.length === 5 ? 'medium' : 'low'
  return {
    status: publicScore == null ? 'incomplete' : status,
    score: publicScore,
    scores: { public: publicScore, authenticated: null, overall: publicScore },
    confidence,
    dims: meanDims(scored),
  }
}

function dimsFrom(score) {
  const scale = score / 100
  return {
    accuracy: Math.round(WEIGHTS.accuracy * scale),
    completeness: Math.round(WEIGHTS.completeness * scale),
    completion: Math.round(WEIGHTS.completion * scale),
    actionability: Math.round(WEIGHTS.actionability * scale),
    efficiency: Math.round(WEIGHTS.efficiency * scale),
  }
}

function zero() {
  return { accuracy: 0, completeness: 0, completion: 0, actionability: 0, efficiency: 0 }
}

function meanDims(tasks) {
  if (!tasks.length) return zero()
  const keys = Object.keys(WEIGHTS)
  const out = {}
  for (const key of keys) {
    out[key] = Math.round(tasks.reduce((sum, task) => sum + (task.dims?.[key] || 0), 0) / tasks.length)
  }
  return out
}

function normalize(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}
