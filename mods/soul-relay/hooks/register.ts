// soul-relay: hand work from an expensive session to cheaper models and get it back.
//
// Three routes, cheapest first:
//   1. In-session, text only: the `delegate` tool and /delegate run one completion
//      on Haiku or Sonnet through the session's own client.
//   2. In-session, with tools: subagent types soul-relay:haiku-worker and
//      soul-relay:sonnet-worker for the Agent tool.
//   3. Cross-session: sessions started on a cheaper model run /soul-worker; tasks
//      reach them as peer messages and their final reply is sent back automatically.
import type { EngineInterface, Register, Timer } from 'claude-code'

type Engine = EngineInterface

interface Usage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

interface Worker {
  name: string
  sessionId: string
  model: string
  cwd: string
  lastSeen: number
  busy: boolean
}

interface Ledger {
  count: number
  cheapCost: number
  saved: number
}

interface Pending {
  worker: string
  task: string
  startedAt: number
}

// USD per million tokens (input, output, cache read). Cache writes cost 1.25x input.
const PRICES: Record<string, [number, number, number]> = {
  'claude-fable-5-1': [10, 50, 0.25],
  'claude-opus-5-5': [4, 20, 0.2],
  'claude-opus-5': [5, 25, 0.5],
  'claude-opus-4-8': [5, 25, 0.5],
  'claude-opus-4-7': [5, 25, 0.5],
  'claude-opus-4-6': [5, 25, 0.5],
  'claude-sonnet-5-5': [2, 10, 0.2],
  'claude-sonnet-5': [2, 10, 0.2],
  'claude-sonnet-4-6': [3, 15, 0.3],
  'claude-haiku-5-5': [0.1, 0.5, 0.01],
  'claude-haiku-4-5': [1, 5, 0.1],
}
const ALIASES: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
}

const HEARTBEAT_MS = 20_000
const STALE_MS = 90_000
const TASK_RE = /^\[soul-relay task ([\w-]+) from (.+?) session=(\S+)\]/
const RESULT_RE = /^\[soul-relay result ([\w-]+) from (.+?) model=(\S+) in=(\d+) out=(\d+) cr=(\d+) cw=(\d+)\]/

const CHEAP_SYSTEM = `You are a focused assistant doing one delegated sub-task for another AI agent. You have no tools and no other context than what you are given. Do exactly the task, completely, and reply with the result only: no preamble, no questions back. If something essential is missing, do your best and state the assumption in one line at the end.`

const WORKER_AGENT_PROMPT = `You are a cost-efficient worker agent. You receive one well-specified task from a more capable agent. Do it directly with the fewest tool calls that get it right. Do not expand the scope. Finish with a concise report: what you did, what you found, files you changed, and anything the caller must check.`

function resolveModel(name: string | undefined): string {
  const key = (name ?? 'haiku').toLowerCase()
  return ALIASES[key] ?? key
}

function priceFor(model: string): [number, number, number] | undefined {
  const id = ALIASES[model] ?? model
  if (PRICES[id]) return PRICES[id]
  const key = Object.keys(PRICES)
    .sort((a, b) => b.length - a.length)
    .find(k => id.startsWith(k))
  return key ? PRICES[key] : undefined
}

function costOf(model: string, u: Usage): number | null {
  const p = priceFor(model)
  if (!p) return null
  const [inp, out, read] = p
  return (
    (u.input_tokens * inp +
      u.output_tokens * out +
      u.cache_read_input_tokens * read +
      u.cache_creation_input_tokens * inp * 1.25) /
    1e6
  )
}

function shortModel(model: string): string {
  const m = /claude-([a-z]+)-/.exec(model)
  return m?.[1] ?? model
}

function fmtUsd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`
}

function clip(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

// Module state starts over on every reload; the ledger is kept in the store.
const S = {
  hubUrl: '',
  effort: 'low' as 'low' | 'medium' | 'high',
  sessionId: '',
  ledger: { count: 0, cheapCost: 0, saved: 0 } as Ledger,
  workerName: null as string | null,
  heartbeat: null as Timer | null,
  currentTask: null as { id: string; replyTo: string; from: string } | null,
  pending: new Map<string, Pending>(),
}

const ledgerKey = () => `ledger:${S.sessionId}`

function showStatus($: Engine) {
  const parts: string[] = []
  if (S.workerName) parts.push(`⇄ worker ${S.workerName}${S.currentTask ? ' · busy' : ''}`)
  if (S.ledger.count) parts.push(`⇄ ${S.ledger.count} delegated · saved ≈ ${fmtUsd(S.ledger.saved)}`)
  if (S.pending.size) parts.push(`${S.pending.size} out`)
  $.ui.status(parts.length ? parts.join(' · ') : undefined)
}

async function record(
  $: Engine,
  entry: { route: 'model' | 'subagent' | 'worker'; model: string; usage: Usage; task: string; target: string },
) {
  const main = await $.session.model()
  const cheap = costOf(entry.model, entry.usage) ?? 0
  const onMain = costOf(main, entry.usage)
  const saved = onMain == null ? 0 : Math.max(0, onMain - cheap)
  S.ledger = { count: S.ledger.count + 1, cheapCost: S.ledger.cheapCost + cheap, saved: S.ledger.saved + saved }
  await $.store.set(ledgerKey(), S.ledger)
  showStatus($)
  if (!S.hubUrl) return
  try {
    await $.http.fetch(`${S.hubUrl}/api/delegations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        at: await $.clock.now(),
        sessionId: S.sessionId,
        cwd: await $.session.cwd(),
        mainModel: main,
        route: entry.route,
        target: entry.target,
        model: entry.model,
        task: clip(entry.task, 200),
        tokens: entry.usage.input_tokens + entry.usage.output_tokens + entry.usage.cache_read_input_tokens + entry.usage.cache_creation_input_tokens,
        cost: cheap,
        saved,
      }),
    })
  } catch {
    // The hub is optional; the dashboard simply won't list this one.
  }
}

// ---- Route 1: one completion on a cheaper model ----

async function complete($: Engine, model: string, task: string, context: string | undefined, signal?: AbortSignal) {
  const prompt = context ? `${task}\n\n<context>\n${context}\n</context>` : task
  const r = await $.model.complete(
    { model, system: CHEAP_SYSTEM, prompt, maxTokens: 8000, effort: S.effort, timeoutMs: 180_000 },
    signal ? { signal } : undefined,
  )
  if (!r.isAnswered) {
    const why = r.reason === 'api-error' ? `API error ${r.status ?? ''}` : r.reason
    return { ok: false as const, text: `${shortModel(model)} gave no answer (${why}).` }
  }
  await record($, { route: 'model', model, usage: r.usage, task, target: shortModel(model) })
  return { ok: true as const, text: r.text, usage: r.usage }
}

// ---- Route 3: worker sessions ----

async function liveWorkers($: Engine): Promise<Worker[]> {
  const now = await $.clock.now()
  const all = ((await $.store.get('workers')) as Worker[] | undefined) ?? []
  const live = all.filter(w => now - w.lastSeen < STALE_MS)
  if (live.length !== all.length) await $.store.set('workers', live)
  return live
}

async function saveWorker($: Engine, patch: Partial<Worker> | null) {
  const all = ((await $.store.get('workers')) as Worker[] | undefined) ?? []
  const others = all.filter(w => w.sessionId !== S.sessionId)
  if (!patch) return $.store.set('workers', others)
  const mine = all.find(w => w.sessionId === S.sessionId)
  const next: Worker = {
    name: S.workerName ?? 'worker',
    sessionId: S.sessionId,
    model: await $.session.model(),
    cwd: await $.session.cwd(),
    lastSeen: await $.clock.now(),
    busy: false,
    ...mine,
    ...patch,
  }
  await $.store.set('workers', [...others, next])
}

async function sendToWorker($: Engine, wanted: string | undefined, task: string, context?: string) {
  const workers = (await liveWorkers($)).filter(w => w.sessionId !== S.sessionId)
  if (!workers.length) {
    return 'No worker sessions are running. Start one with `claude --model haiku`, then type /soul-worker in it.'
  }
  const name = wanted?.replace(/^@/, '').toLowerCase()
  const worker = name
    ? workers.find(w => w.name.toLowerCase() === name)
    : (workers.find(w => !w.busy) ?? workers[0])
  if (!worker) return `No worker named "${wanted}". Running: ${workers.map(w => w.name).join(', ')}.`

  const id = crypto.randomUUID().slice(0, 8)
  const from = basename(await $.session.cwd())
  const body = [
    `[soul-relay task ${id} from ${from} session=${S.sessionId}]`,
    task,
    context ? `\n<context>\n${context}\n</context>` : '',
    '\nDo this task in your working directory. Your final reply is sent back to the requesting session automatically, so end with a self-contained report: what you did, what you found, files changed.',
  ].join('\n')
  const sent = await $.session.send({ to: { sessionId: worker.sessionId }, text: body })
  if (!sent.isDelivered) return `Could not reach ${worker.name}: ${sent.reason}`
  S.pending.set(id, { worker: worker.name, task, startedAt: await $.clock.now() })
  showStatus($)
  return `Sent to ${worker.name} (${shortModel(worker.model)}, task ${id}). Its report will arrive here as a message when it finishes; carry on with other work meanwhile.`
}

async function becomeWorker($: Engine, wanted: string) {
  const model = await $.session.model()
  const taken = new Set((await liveWorkers($)).filter(w => w.sessionId !== S.sessionId).map(w => w.name))
  let name = wanted
  if (!name) {
    let n = 1
    while (taken.has(`${shortModel(model)}-${n}`)) n += 1
    name = `${shortModel(model)}-${n}`
  }
  S.workerName = name
  await saveWorker($, { name, busy: false })
  S.heartbeat?.cancel()
  S.heartbeat = $.clock.every(HEARTBEAT_MS, () => {
    saveWorker($, { lastSeen: Date.now(), busy: S.currentTask != null }).catch(() => {})
  })
  showStatus($)
  return name
}

async function stopWorker($: Engine) {
  S.heartbeat?.cancel()
  S.heartbeat = null
  S.workerName = null
  await saveWorker($, null)
  showStatus($)
}

export const register: Register = (on, options) => {
  // Unset means the default hub; an empty string turns reporting off.
  S.hubUrl = (options.hubUrl === undefined ? 'http://127.0.0.1:7777' : String(options.hubUrl)).replace(/\/+$/, '')
  S.effort = (['low', 'medium', 'high'].includes(String(options.effort)) ? options.effort : 'low') as typeof S.effort

  // ---- Wiring ----

  on('session.start', async ($, e, next) => {
    S.sessionId = await $.session.id()
    S.ledger = ((await $.store.get(ledgerKey())) as Ledger | undefined) ?? S.ledger

    await $.tool.register({
      name: 'delegate',
      description:
        'Hand a self-contained sub-task to a cheaper model (Haiku by default, or Sonnet) and get its answer back, to save cost. ' +
        'Use it for work that does not need your full reasoning: summarizing, drafting commit messages, changelogs, docs or emails, rewriting, extracting or classifying, ' +
        'boilerplate, and simple transformations of text or code you pass in `context`. The cheaper model has no tools and no conversation history, ' +
        'so put everything it needs in `task` and `context`. For work that must read or edit files, use the Agent tool with subagent_type ' +
        '"soul-relay:haiku-worker" or "soul-relay:sonnet-worker", or set `worker` to hand it to a running worker session (its report arrives later as a message). ' +
        'Check the answer before relying on it.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Complete instructions for the sub-task, including the expected output format.' },
          context: { type: 'string', description: 'Text, code or data the task works on.' },
          model: { type: 'string', enum: ['haiku', 'sonnet'], description: 'Which cheaper model. Default haiku; sonnet for tasks needing more judgment.' },
          worker: { type: 'string', description: 'Name of a worker session (see /soul-workers), or "any", to run the task there with tools instead.' },
        },
        required: ['task'],
        additionalProperties: false,
      },
      isDeferred: false,
    })

    await $.agent.register({
      name: 'haiku-worker',
      description:
        'Cheap, fast Claude Haiku worker for well-specified tasks: searching and reading code, mechanical edits, running commands or tests and summarizing output. Give it a complete task description.',
      prompt: WORKER_AGENT_PROMPT,
      model: 'haiku',
    })
    await $.agent.register({
      name: 'sonnet-worker',
      description:
        'Mid-cost Claude Sonnet worker for tasks needing some judgment: focused refactors, writing tests, debugging a contained issue. Cheaper than doing it on Opus. Give it a complete task description.',
      prompt: WORKER_AGENT_PROMPT,
      model: 'sonnet',
    })

    await $.command.register({
      name: 'delegate',
      description: 'Run a task on a cheaper model and hand the answer to this chat: /delegate [haiku|sonnet|@worker] <task>',
      argumentHint: '[haiku|sonnet|@worker] <task>',
    })
    await $.command.register({ name: 'soul-worker', description: 'Make this session a worker other sessions can delegate to: /soul-worker [name|off]', argumentHint: '[name|off]' })
    await $.command.register({ name: 'soul-workers', description: 'List running worker sessions' })
    await $.command.register({ name: 'soul-relay', description: 'Show what this session has delegated and saved' })

    showStatus($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (S.workerName) await stopWorker($)
    return next(e)
  })

  on('tool.call', { tool: 'mcp__soul-relay__delegate' }, async ($, e) => {
    const input = e as unknown as { task?: unknown; context?: unknown; model?: unknown; worker?: unknown }
    const task = typeof input.task === 'string' ? input.task : ''
    if (!task.trim()) return { deny: 'delegate needs a non-empty `task`.' }
    const context = typeof input.context === 'string' && input.context ? input.context : undefined
    if (typeof input.worker === 'string' && input.worker) {
      const wanted = input.worker === 'any' ? undefined : input.worker
      return { result: await sendToWorker($, wanted, task, context) }
    }
    const model = resolveModel(typeof input.model === 'string' ? input.model : 'haiku')
    const r = await complete($, model, task, context)
    return { result: r.ok ? `[answer from ${shortModel(model)}]\n${r.text}` : r.text }
  }).catch(() => ({ deny: 'soul-relay: the delegation failed; do the task yourself.' }))

  on('command.run', { command: 'delegate' }, async ($, e) => {
    const m = /^\s*(haiku|sonnet|@\S+)?\s*([\s\S]*)$/i.exec(e.args)
    const target = m?.[1]
    const task = (m?.[2] ?? '').trim()
    if (!task) return { text: 'Usage: /delegate [haiku|sonnet|@worker] <task>' }

    if (target?.startsWith('@')) {
      const said = await sendToWorker($, target === '@any' ? undefined : target, task)
      return { text: said }
    }

    // Give the cheaper model the gist of the recent conversation.
    const recent = (await $.session.messages())
      .slice(-6)
      .map(msg => `${msg.role.toUpperCase()}: ${clip(msg.text ?? '', 1500)}`)
      .filter(line => line.length > 6)
      .join('\n\n')
    const model = resolveModel(target ?? 'haiku')
    $.ui.toast(`Delegating to ${shortModel(model)}…`)
    const r = await complete($, model, task, recent ? `Recent conversation, for reference:\n${recent}` : undefined)
    if (!r.ok) return { text: r.text }
    return {
      text: `⇄ ${shortModel(model)} answered:\n\n${r.text}`,
      context: [`The user ran /delegate and ${model} produced this result for "${clip(task, 200)}":\n\n${r.text}`],
    }
  })

  on('command.run', { command: 'soul-worker' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off') {
      const was = S.workerName
      await stopWorker($)
      return { text: was ? `${was} is no longer taking tasks.` : 'This session was not a worker.' }
    }
    const name = await becomeWorker($, arg)
    const model = await $.session.model()
    const note = /opus|fable/.test(model) ? ' (tip: workers save most when started on a cheaper model: `claude --model haiku`)' : ''
    return { text: `This session is now worker "${name}" on ${model}. Other sessions can send it work with /delegate @${name} <task>.${note}` }
  })

  on('command.run', { command: 'soul-workers' }, async $ => {
    const workers = await liveWorkers($)
    if (!workers.length) return { text: 'No worker sessions running. Start one: `claude --model haiku`, then /soul-worker.' }
    const lines = workers.map(
      w => `- ${w.name}: ${w.model}, ${w.busy ? 'busy' : 'idle'}, in ${w.cwd}${w.sessionId === S.sessionId ? ' (this session)' : ''}`,
    )
    return { text: `Worker sessions:\n${lines.join('\n')}` }
  })

  on('command.run', { command: 'soul-relay' }, async $ => {
    const lines = [
      `Delegated this session: ${S.ledger.count}`,
      `Spent on cheaper models: ${fmtUsd(S.ledger.cheapCost)}`,
      `Saved vs ${await $.session.model()}: ≈ ${fmtUsd(S.ledger.saved)}`,
    ]
    for (const [id, p] of S.pending) lines.push(`Waiting on ${p.worker} (task ${id}): ${clip(p.task, 80)}`)
    if (S.workerName) lines.push(`This session is worker "${S.workerName}"${S.currentTask ? `, working on task ${S.currentTask.id}` : ''}.`)
    return { text: lines.join('\n') }
  })

  // Deliveries: a task arriving at a worker, or a result arriving back.
  on('session.receive', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const task = TASK_RE.exec(e.text)
    if (task && S.workerName) {
      S.currentTask = { id: task[1]!, from: task[2]!, replyTo: task[3]! }
      void saveWorker($, { busy: true })
      $.ui.toast(`Task ${task[1]} from ${task[2]}`)
      showStatus($)
      return next(e)
    }
    const result = RESULT_RE.exec(e.text)
    if (result) {
      const [, id, worker, model, inp, out, cr, cw] = result
      const p = S.pending.get(id!)
      S.pending.delete(id!)
      $.ui.toast(`${worker} returned task ${id}`)
      await record($, {
        route: 'worker',
        model: model!,
        target: worker!,
        task: p?.task ?? `task ${id}`,
        usage: {
          input_tokens: Number(inp),
          output_tokens: Number(out),
          cache_read_input_tokens: Number(cr),
          cache_creation_input_tokens: Number(cw),
        },
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Turn ends: a worker sends its report back; cheaper subagents count toward savings.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && S.currentTask && S.workerName && !e.isAborted) {
      const t = S.currentTask
      S.currentTask = null
      const u = e.usage
      const header = `[soul-relay result ${t.id} from ${S.workerName} model=${u?.model ?? (await $.session.model())} in=${u?.input_tokens ?? 0} out=${u?.output_tokens ?? 0} cr=${u?.cache_read_input_tokens ?? 0} cw=${u?.cache_creation_input_tokens ?? 0}]`
      const sent = await $.session.send({ to: { sessionId: t.replyTo }, text: `${header}\n${e.answer || '(the worker finished without a text reply)'}` })
      if (!sent.isDelivered) $.ui.toast(`Could not return task ${t.id} to ${t.from}: ${sent.reason}`)
      void saveWorker($, { busy: false })
      showStatus($)
    } else if (e.agentId !== undefined && e.usage && /haiku|sonnet/.test(e.usage.model)) {
      const main = await $.session.model()
      if (!/haiku/.test(main) && main !== e.usage.model) {
        await record($, { route: 'subagent', model: e.usage.model, usage: e.usage, task: clip(e.answer, 120), target: shortModel(e.usage.model) })
      }
    }
    return done
  })
}
