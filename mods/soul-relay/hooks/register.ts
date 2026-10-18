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
// Deliveries arrive wrapped in a <cross-session-message from="..."> envelope, so match per line.
const TASK_RE = /^\[soul-relay task ([\w-]+) from (.+?) session=(\S+)\]/m
const FROM_RE = /<cross-session-message from="([^"]+)"/
const RESULT_RE = /^\[soul-relay result ([\w-]+) from (.+?) model=(\S+) in=(\d+) out=(\d+) cr=(\d+) cw=(\d+)\]/m

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
  // Tasks this worker received that its next finished turn answers; several chats may send at once.
  tasks: [] as { id: string; replyTo: string; replyAddress: string | null; from: string }[],
  pending: new Map<string, Pending>(),
  // The soul: which project this chat belongs to, and the routes for its latest plan.
  project: null as { name: string; repos: string[] } | null,
  plan: { steps: [] as string[], at: 0, routes: [] as Route[], text: '', dirty: false },
}

interface Route {
  step: string
  model: 'opus' | 'sonnet' | 'haiku'
  where: string
  why: string
  instruction: string | null
}

const ledgerKey = () => `ledger:${S.sessionId}`

function showStatus($: Engine) {
  const parts: string[] = []
  if (S.workerName) parts.push(`⇄ worker ${S.workerName}${S.tasks.length ? ' · busy' : ''}`)
  if (S.ledger.count) parts.push(`⇄ ${S.ledger.count} delegated · saved ≈ ${fmtUsd(S.ledger.saved)}`)
  if (S.pending.size) parts.push(`${S.pending.size} out`)
  if (S.plan.routes.length) {
    const cheap = S.plan.routes.filter(r => r.model !== 'opus').length
    if (cheap) parts.push(`◉ plan: ${cheap}/${S.plan.routes.length} steps fit cheaper models · /soul-routes`)
  }
  $.ui.status(parts.length ? parts.join(' · ') : undefined)
}

// ---- The soul: read-only answers from the Soul Engine hub, on this session's own model ----
// Everything the hub returns is computed on this machine from transcripts and repos (no API calls),
// so asking the soul inside Claude Code runs on your Claude subscription.

const HUB_DOWN = 'The Soul Engine hub is not running. Start it with `npm run dev` (or `npx tsx server/index.ts`) in soul-engine/.'

async function hub<T>($: Engine, path: string, body?: unknown): Promise<T | null> {
  if (!S.hubUrl) return null
  try {
    const r = await $.http.fetch(`${S.hubUrl}${path}`, body === undefined ? undefined : {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    // Errors come back as { error } and are shown as they are.
    return JSON.parse(r.text) as T
  } catch {
    return null
  }
}

const q = (params: Record<string, string | number | null | undefined>) =>
  Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')

/** A project soul answers for its own project unless another one is named. */
const projectFor = (asked: unknown) => (typeof asked === 'string' && asked.trim() ? asked.trim() : S.project?.name ?? null)

async function soulText($: Engine, path: string): Promise<string> {
  const r = await hub<{ text?: string; markdown?: string; error?: string }>($, path)
  return r ? r.text ?? r.markdown ?? r.error ?? '(empty)' : HUB_DOWN
}

/** Steps of a plan the chat just wrote: plan mode, a to-do list, or tasks it created. */
function planSteps(tool: string, input: Record<string, unknown>): string[] | null {
  if (tool === 'ExitPlanMode' && typeof input.plan === 'string') {
    const steps = input.plan.split('\n').map(l => /^\s*(?:\d+[.)]|[-*])\s+(.+)/.exec(l)?.[1]).filter((x): x is string => !!x)
    return steps.length ? steps.map(s => clip(s.replace(/\*\*/g, ''), 140)) : null
  }
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    return input.todos.map(t => clip(String((t as { content?: unknown }).content ?? ''), 140)).filter(Boolean)
  }
  return null
}

async function refreshRoutes($: Engine) {
  if (!S.plan.dirty || !S.plan.steps.length) return
  S.plan.dirty = false
  const r = await hub<{ routes: Route[]; text: string }>($, '/api/soul/routes', { steps: S.plan.steps, cwd: await $.session.cwd() })
  if (!r) return
  S.plan.routes = r.routes
  S.plan.text = r.text
  const n = (m: string) => r.routes.filter(x => x.model === m).length
  if (n('haiku') + n('sonnet')) $.ui.toast(`Soul: ${r.routes.length}-step plan · ${n('haiku')} fit Haiku · ${n('sonnet')} fit Sonnet · /soul-routes`)
  showStatus($)
}

const SOUL_TOOLS: { name: string; description: string; properties: Record<string, unknown>; required?: string[] }[] = [
  {
    name: 'soul_inventory',
    description: 'REKA Soul Engine inventory of a project: tools and services, API keys by name and the API each calls (never secret values), outside APIs, hosting, domains, e-mail addresses, sign-in, jobs and defaults, with file:line evidence. Defaults to this chat\'s project. Pass `query` to search instead of listing.',
    properties: { query: { type: 'string', description: 'Words to search for, e.g. "resend", "noreply", "SERVICE_ROLE"' }, project: { type: 'string', description: 'Another project name; omit for this chat\'s project, or "all" for every project' } },
  },
  {
    name: 'soul_plan_routes',
    description: 'Suggested model and chat for each step of this chat\'s latest plan (Opus keeps judgment, Sonnet for builds and tests, Haiku for searching and writing), with a ready instruction per step. Suggestions only.',
    properties: {},
  },
  {
    name: 'soul_status',
    description: 'Where each project is in the REKA Build Flow (steps 01 to 09, estimated from its repos unless set), tasks and phases left, whether its addresses are live, the latest release tag, and the next step. Defaults to every project; pass `project` for one, or "this" for this chat\'s project.',
    properties: { project: { type: 'string', description: 'A project name, or "this"; omit for every project' } },
  },
  {
    name: 'soul_roadmap',
    description: 'A project\'s roadmap as its repo keeps it (docs/ROADMAP.md): horizons (Now, Next, Later), items with their status, owner and date, and the recent commits that changed it. Pass `days` to get what changed instead: items added, removed, finished, moved between horizons, or re-dated. Defaults to this chat\'s project.',
    properties: { project: { type: 'string', description: 'Omit for this chat\'s project, or "all"' }, days: { type: 'integer', description: 'Show changes over the last N days instead of the roadmap' } },
  },
  {
    name: 'soul_overview',
    description: 'What every live Claude Code chat on this machine is doing right now, which hand-offs are running, and routing suggestions (cheaper models, fresh chats, chats clashing in one folder).',
    properties: {},
  },
  {
    name: 'soul_changes',
    description: 'What changed in a project\'s keys, APIs, services, hosting, domains, addresses, sign-in and jobs over the last N days.',
    properties: { days: { type: 'integer', description: 'Days to look back (default 7)' }, project: { type: 'string', description: 'Omit for this chat\'s project, or "all"' } },
  },
  {
    name: 'soul_access_register',
    description: 'Draft an Access and Account Register for a project from its inventory.',
    properties: { project: { type: 'string', description: 'Omit for this chat\'s project' } },
  },
  {
    name: 'soul_rotation_checklist',
    description: 'Every repo, CI secret, host and file to update when one API key is rotated.',
    properties: { key: { type: 'string', description: 'Variable name, e.g. RESEND_API_KEY' } },
    required: ['key'],
  },
]

async function runSoulTool($: Engine, name: string, input: Record<string, unknown>): Promise<string> {
  const asked = input.project === 'all' ? null : projectFor(input.project)
  switch (name) {
    case 'soul_inventory':
      return soulText($, `/api/soul/inventory?${q({ project: asked, q: typeof input.query === 'string' ? input.query : null })}`)
    case 'soul_plan_routes': {
      await refreshRoutes($)
      if (S.plan.text) return S.plan.text
      return soulText($, `/api/soul/plan?${q({ session: S.sessionId })}`)
    }
    case 'soul_overview':
      return soulText($, '/api/soul/overview')
    case 'soul_roadmap': {
      const days = Number(input.days) || 0
      if (!days) return soulText($, `/api/soul/roadmap?${q({ project: asked })}`)
      const r = await hub<{ firstRun?: boolean; projects?: { project: string; file: string; commits: { ts: number; subject: string }[]; added: { title: string; section: string }[]; removed: { title: string; section: string }[]; changed: { title: string; what: string; from: string; to: string }[] }[]; error?: string }>($, `/api/roadmap/changes?${q({ days, project: asked })}`)
      if (!r) return HUB_DOWN
      if (r.error) return r.error
      const lines: string[] = [`Roadmap changes over the last ${days} days${asked ? ` in ${asked}` : ''}:`]
      if (r.firstRun) lines.push('(No earlier snapshot yet: only commits to the roadmap files are listed. Snapshots are saved daily while the hub runs.)')
      for (const p of r.projects ?? []) {
        lines.push('', `${p.project} (${p.file})`)
        for (const c of p.commits) lines.push(`- commit ${new Date(c.ts).toISOString().slice(0, 10)}: ${c.subject}`)
        for (const a of p.added) lines.push(`- added: ${a.title} (${a.section})`)
        for (const a of p.removed) lines.push(`- removed: ${a.title} (was in ${a.section})`)
        for (const c of p.changed) lines.push(`- ${c.what}: ${c.title}: ${c.from} → ${c.to}`)
      }
      if (!(r.projects ?? []).length) lines.push('No changes.')
      return lines.join('\n')
    }
    case 'soul_status':
      return soulText($, `/api/soul/status?${q({ project: input.project === 'this' ? S.project?.name ?? null : typeof input.project === 'string' && input.project !== 'all' ? input.project : null })}`)
    case 'soul_changes':
      return soulText($, `/api/inventory/changes?${q({ days: Number(input.days) || 7, project: asked })}`)
    case 'soul_access_register':
      return asked ? soulText($, `/api/docs/access-register?${q({ project: asked })}`) : 'Name a project: this chat is not inside one from projects.local.json.'
    case 'soul_rotation_checklist':
      return typeof input.key === 'string' && input.key ? soulText($, `/api/docs/rotation?${q({ key: input.key })}`) : 'Pass the key name.'
    default:
      return `Unknown soul tool ${name}.`
  }
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
    saveWorker($, { lastSeen: Date.now(), busy: S.tasks.length > 0 }).catch(() => {})
  })
  showStatus($)
  return name
}

// ---- Messages you sent from the Soul Engine dashboard into this chat (after confirming there) ----
const OUTBOX_MS = 5_000
let outboxTimer: Timer | null = null
let outboxBusy = false

async function collectOutbox($: Engine) {
  if (outboxBusy || !S.hubUrl || !S.sessionId) return
  outboxBusy = true
  try {
    const items = await hub<{ id: string; text: string }[]>($, `/api/outbox?${q({ session: S.sessionId })}`)
    for (const m of Array.isArray(items) ? items : []) {
      // Submitted as a prompt of its own, so it starts a turn here once the chat is free, on this chat's model.
      // The transcript names soul-relay as the sender; the dashboard shows whether it started.
      try {
        await $.prompt.submit({ text: `[Soul Engine dashboard] ${m.text}` })
        $.ui.toast('Soul Engine: a message from the dashboard started here')
        await hub($, '/api/outbox/ack', { id: m.id, ok: true })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        $.ui.toast(`Soul Engine: could not start a dashboard message (${reason})`)
        await hub($, '/api/outbox/ack', { id: m.id, ok: false, reason })
      }
    }
  } catch {
    // The hub is optional; try again on the next tick.
  } finally {
    outboxBusy = false
  }
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
    outboxTimer?.cancel()
    outboxTimer = $.clock.every(OUTBOX_MS, () => { void collectOutbox($) })
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

    // The soul of this chat's project, answering on this session's own model.
    S.project = (await hub<{ project: { name: string; repos: string[] } | null }>($, `/api/soul/scope?${q({ cwd: await $.session.cwd() })}`))?.project ?? null
    for (const t of SOUL_TOOLS) {
      await $.tool.register({
        name: t.name,
        description: t.description + (S.project ? ` This chat is in project ${S.project.name} (${S.project.repos.join(', ')}).` : ''),
        inputSchema: { type: 'object', properties: t.properties, required: t.required ?? [], additionalProperties: false },
        isDeferred: true,
      })
    }
    await $.command.register({ name: 'soul', description: "The soul of this chat's project: what it knows, and what to ask", argumentHint: '[question]' })
    await $.command.register({ name: 'soul-routes', description: "Suggested model and chat for each step of this chat's plan" })
    await $.command.register({ name: 'soul-roadmap', description: "Draft or update this project's roadmap (docs/ROADMAP.md) in the REKA format, from its plans" })

    showStatus($)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    outboxTimer?.cancel()
    outboxTimer = null
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

  // ---- The soul ----

  for (const t of SOUL_TOOLS) {
    on('tool.call', { tool: `mcp__soul-relay__${t.name}` }, async ($, e) => ({
      result: await runSoulTool($, t.name, e as unknown as Record<string, unknown>),
    })).catch(() => ({ deny: 'soul-relay: the Soul Engine hub did not answer.' }))
  }

  // Plans: when the chat writes one, suggest where each step could run. Nothing is sent.
  for (const tool of ['ExitPlanMode', 'TodoWrite']) {
    on('tool.call', { tool }, async ($, e, next) => {
      const steps = planSteps(tool, e as unknown as Record<string, unknown>)
      if (steps?.length && steps.join('\n') !== S.plan.steps.join('\n')) {
        S.plan = { ...S.plan, steps, at: await $.clock.now(), dirty: true }
      }
      return next(e)
    }).catch(($, e, next) => next(e))
  }

  on('command.run', { command: 'soul-routes' }, async $ => {
    await refreshRoutes($)
    const text = S.plan.text || (await soulText($, `/api/soul/plan?${q({ session: S.sessionId })}`))
    return { text, context: S.plan.routes.length ? [`The user looked at the soul's suggested routes for the plan:\n${text}\nThey are suggestions; only act on them if the user asks.`] : undefined }
  })

  // Each project writes its own roadmap; the soul hands this chat the format and what it has now.
  on('command.run', { command: 'soul-roadmap' }, async $ => {
    const name = S.project?.name ?? null
    const [template, current] = await Promise.all([
      soulText($, '/api/soul/roadmap-template'),
      name ? soulText($, `/api/soul/roadmap?${q({ project: name })}`) : Promise.resolve('This folder is not in a project in projects.local.json.'),
    ])
    if (template === HUB_DOWN) return { text: HUB_DOWN }
    return {
      text: `◉ Roadmap for ${name ?? 'this repo'}: the format and what the soul sees now are in this chat. Ask Claude to draft or update docs/ROADMAP.md.`,
      context: [
        `The user wants ${name ? `the ${name}` : 'this'} project's roadmap written or updated as docs/ROADMAP.md in the repo, in the REKA roadmap format below. ` +
          'Build it from the project\'s own plans, build plans, PROGRESS.md, readiness verdicts and open issues (read them), not from memory. ' +
          'Keep existing item IDs; never reuse an ID. Put each item under Now, Next or Later with a status (Planned, In progress, Blocked or Needs decision, Done with the date). ' +
          'Show the draft and ask before writing the file; then commit it with a message that says what changed and why.\n\n' +
          `REKA roadmap format:\n${template}\n\nWhat the Soul Engine reads for this project now:\n${current}`,
      ],
    }
  })

  on('command.run', { command: 'soul' }, async ($, e) => {
    const question = e.args.trim()
    const who = S.project ? `the soul of ${S.project.name} (${S.project.repos.join(', ')})` : 'the main REKA soul (this folder is not in a project)'
    if (!question) {
      const overview = await soulText($, '/api/soul/overview')
      return {
        text: [
          `◉ This chat talks to ${who}.`,
          'Ask in plain words, for example: "which API keys does this project use?", "where is it hosted?", "what changed this week?", "split my plan across models".',
          "Claude answers with the soul_* tools, on this chat's own model, so it uses your subscription and no API credits.",
          '',
          overview,
        ].join('\n'),
      }
    }
    // A question: hand the project's inventory to this chat so it answers here.
    const inv = await soulText($, `/api/soul/inventory?${q({ project: S.project?.name ?? null })}`)
    return {
      text: `◉ Asking ${who}…`,
      context: [`The user asked ${who}: "${question}". Answer from this inventory, and use the soul_* tools if you need more. Never print secret values.\n\n${inv.slice(0, 30_000)}`],
    }
  })

  on('command.run', { command: 'soul-relay' }, async $ => {
    const lines = [
      `Delegated this session: ${S.ledger.count}`,
      `Spent on cheaper models: ${fmtUsd(S.ledger.cheapCost)}`,
      `Saved vs ${await $.session.model()}: ≈ ${fmtUsd(S.ledger.saved)}`,
    ]
    for (const [id, p] of S.pending) lines.push(`Waiting on ${p.worker} (task ${id}): ${clip(p.task, 80)}`)
    if (S.workerName) lines.push(`This session is worker "${S.workerName}"${S.tasks.length ? `, working on ${S.tasks.map(t => t.id).join(', ')}` : ''}.`)
    return { text: lines.join('\n') }
  })

  // Deliveries: a task arriving at a worker, or a result arriving back.
  on('session.receive', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const task = TASK_RE.exec(e.text)
    if (task && S.workerName) {
      S.tasks.push({ id: task[1]!, from: task[2]!, replyTo: task[3]!, replyAddress: FROM_RE.exec(e.text)?.[1] ?? null })
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
    if (e.agentId === undefined && S.plan.dirty) await refreshRoutes($).catch(() => {})
    if (e.agentId === undefined && S.tasks.length && S.workerName && !e.isAborted) {
      // Every task that arrived before this turn ended was handled in it (deliveries fold into a running turn).
      const answered = S.tasks.splice(0)
      const model = e.usage?.model ?? (await $.session.model())
      for (const [i, t] of answered.entries()) {
        // The turn's usage is reported once, so savings aren't counted twice.
        const u = i === 0 ? e.usage : undefined
        const header = `[soul-relay result ${t.id} from ${S.workerName} model=${model} in=${u?.input_tokens ?? 0} out=${u?.output_tokens ?? 0} cr=${u?.cache_read_input_tokens ?? 0} cw=${u?.cache_creation_input_tokens ?? 0}]`
        const text = `${header}\n${e.answer || '(the worker finished without a text reply)'}`
        // Reply to the address the task came from (the sender's own inbox); fall back to its session id.
        let sent = t.replyAddress ? await $.session.send({ to: t.replyAddress, text }) : null
        if (!sent?.isDelivered) sent = await $.session.send({ to: { sessionId: t.replyTo }, text })
        if (!sent.isDelivered) $.ui.toast(`Could not return task ${t.id} to ${t.from}: ${sent.reason}`)
      }
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
