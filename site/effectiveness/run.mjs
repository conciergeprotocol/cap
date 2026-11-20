import { createDoor } from './door.mjs'
import { loadTasks, linksIn } from './pages.mjs'
import { probeAuth } from './auth.mjs'
import { gradeReply } from './grade.mjs'
import { aggregate, scoreReply } from './score.mjs'
import {
  EFFECTIVENESS_VERSION,
  JUDGE_MODEL,
  RUBRIC_VERSION,
  SCHEMA_VERSION,
  TASKSET_VERSION,
  allowed,
} from './constants.mjs'
import { siteKey } from '../readiness-store.mjs'
import { sameSite } from '../check.mjs'

export async function runEffectiveness(domain, { apiKey, onTask } = {}) {
  const key = siteKey(domain)
  if (!allowed(key)) {
    const error = new Error('Live effectiveness scoring is limited to a small beta list.')
    error.code = 'not_enabled'
    throw error
  }
  const taskSet = loadTasks(key)
  if (!taskSet) {
    const error = new Error('No task set is published for this domain yet.')
    error.code = 'not_enabled'
    throw error
  }

  const door = createDoor(domain)
  const found = await door.discover()
  const tasks = []
  let evalCost = 0
  const started = Date.now()

  for (const task of taskSet.tasks) {
    onTask?.({ id: task.id, state: 'running' })
    if (found.error) {
      tasks.push(emptyTask(task, found.error))
      onTask?.({ id: task.id, state: 'judged', outcome: 'error', score: 0 })
      continue
    }
    const asked = await door.ask(task.prompt)
    const urls = linksIn(asked.reply || '')
    const links = []
    for (const url of urls.slice(0, 3)) {
      let host = ''
      try {
        host = new URL(url).hostname
      } catch {
        continue
      }
      if (!sameSite(host, key)) {
        links.push({ url, status: 0, onSite: false })
        continue
      }
      const page = await door.getPage(url)
      links.push(page.error
        ? { url, status: 0, onSite: true }
        : { url: page.url, status: page.status, onSite: true })
    }
    const grade = await gradeReply({ apiKey, prompt: task.prompt, reply: asked.reply })
    if (grade?.costUsd) evalCost += grade.costUsd
    const judged = scoreReply({
      reply: asked.reply,
      error: asked.error,
      links,
      wallMs: asked.wallMs,
      grade,
    })
    const next = links.find((link) => link.onSite && link.status >= 200 && link.status < 400)
    tasks.push({
      id: task.id,
      archetype: task.archetype,
      prompt: task.prompt,
      condition: asked.protocol || 'none',
      outcome: judged.outcome,
      score: judged.score,
      dims: judged.dims,
      answer: String(asked.reply || asked.error || '').slice(0, 2000),
      claims: judged.claims,
      nextStep: next ? { url: next.url, status: next.status, onSite: true, relevant: true } : undefined,
      penalties: judged.penalties,
      wallMs: asked.wallMs || 0,
      agentCostUsd: 0,
    })
    onTask?.({ id: task.id, state: 'judged', outcome: judged.outcome, score: judged.score })
  }

  const summary = aggregate(tasks)
  const auth = await probeAuth(domain)
  const used = [...new Set(tasks.map((task) => task.condition).filter((item) => item && item !== 'none'))]
  return {
    ok: true,
    schemaVersion: SCHEMA_VERSION,
    version: EFFECTIVENESS_VERSION,
    rubricVersion: RUBRIC_VERSION,
    taskSetVersion: taskSet.taskSetVersion || TASKSET_VERSION,
    domain,
    checkedAt: new Date().toISOString(),
    status: summary.status,
    score: summary.score,
    scores: summary.scores,
    confidence: apiKey ? summary.confidence : 'low',
    dims: summary.dims,
    tasks,
    auth,
    protocol: used.length === 1 ? used[0] : null,
    models: { visitor: used.length === 1 ? used[0] : 'door', judge: apiKey ? JUDGE_MODEL : 'none' },
    totals: {
      wallMs: Date.now() - started,
      agentCostUsd: 0,
      evalCostUsd: Number(evalCost.toFixed(4)),
    },
    recommendations: tasks
      .filter((task) => task.outcome !== 'answered')
      .slice(0, 3)
      .map((task) => ({
        id: task.id.toLowerCase(),
        title: `Improve ${task.id}`,
        detail: task.penalties[0] || `${task.prompt} was ${task.outcome}.`,
        taskIds: [task.id],
      })),
  }
}

function emptyTask(task, error) {
  return {
    id: task.id,
    archetype: task.archetype,
    prompt: task.prompt,
    condition: 'none',
    outcome: 'error',
    score: 0,
    dims: { accuracy: 0, completeness: 0, completion: 0, actionability: 0, efficiency: 0 },
    answer: error,
    claims: [],
    penalties: [error],
    wallMs: 0,
    agentCostUsd: 0,
  }
}
