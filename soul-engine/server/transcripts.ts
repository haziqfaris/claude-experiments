// Reads Claude Code's own session transcripts (~/.claude/projects/**/*.jsonl)
// incrementally and turns them into per-project and per-session stats.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ActivityStatus,
  FlowAgent,
  FlowChat,
  ProjectSnapshot,
  SessionDetail,
  SessionSummary,
  Snapshot,
} from '../src/types';
import { contextWindow, estimateCost, type RawUsage } from './pricing';

const ACTIVE_MS = 90_000;
const RECENT_MS = 15 * 60_000;
const KEEP = 8;

interface Call {
  ts: number;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
}

/** What one transcript file contributed. A session can span several files (subagents). */
interface FileAcc {
  file: string;
  offset: number;
  remainder: string;
  sessionId: string | null;
  isSidechain: boolean;
  cwd: string | null;
  branch: string | null;
  entrypoint: string | null;
  firstTs: number;
  lastTs: number;
  calls: Map<string, Call>;
  prompts: { ts: number; text: string }[];
  replies: { ts: number; text: string }[];
  tools: Map<string, number>;
  files: Map<string, number>;
  reportedCost: number | null;
  lastPrompt: string | null;
  // Relay: what the chat is doing and the work it hands off.
  agentId: string | null;
  meta: { agentType?: string; description?: string; toolUseId?: string } | null;
  lastStop: string | null;
  doing: { tool: string; detail: string; ts: number } | null;
  todos: { content: string; status: string }[];
  recentTools: string[];
  launches: Map<string, Launch>;
  plan: { ts: number; steps: string[] } | null;
}

/** A hand-off seen in a chat: an Agent/Task call, a delegate() call or a workflow. */
interface Launch {
  id: string;
  kind: FlowAgent['kind'];
  label: string;
  agentType: string | null;
  model: string | null;
  task: string;
  ts: number;
  endedAt: number | null;
  isError: boolean;
  background: boolean;
  agentId: string | null;
}

interface SessionAgg {
  id: string;
  cwd: string;
  branch: string | null;
  entrypoint: string | null;
  firstTs: number;
  lastTs: number;
  calls: Call[];
  prompts: { ts: number; text: string }[];
  replies: { ts: number; text: string }[];
  tools: Map<string, number>;
  files: Map<string, number>;
  reportedCost: number | null;
  lastPrompt: string | null;
}

function newAcc(file: string): FileAcc {
  return {
    file,
    offset: 0,
    remainder: '',
    sessionId: null,
    isSidechain: false,
    cwd: null,
    branch: null,
    entrypoint: null,
    firstTs: Infinity,
    lastTs: 0,
    calls: new Map(),
    prompts: [],
    replies: [],
    tools: new Map(),
    files: new Map(),
    reportedCost: null,
    lastPrompt: null,
    agentId: null,
    meta: null,
    lastStop: null,
    doing: null,
    todos: [],
    recentTools: [],
    launches: new Map(),
    plan: null,
  };
}

function pushCapped<T>(list: T[], item: T, cap = KEEP) {
  list.push(item);
  if (list.length > cap) list.splice(0, list.length - cap);
}

function clip(text: string, n: number) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function textOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const b of content) {
    if (b && typeof b === 'object' && (b as { type?: string }).type === 'text') {
      parts.push(String((b as { text?: string }).text ?? ''));
    } else {
      return null; // tool results and other blocks are not prompts
    }
  }
  return parts.join('\n');
}

const SECRETISH = /(sk-[a-z0-9-]{8,}|ghp_[a-z0-9]{10,}|eyJ[a-z0-9_-]{10,}|(?:key|token|secret|password)\s*[=:]\s*\S+)/gi;

/** What a tool call is doing, in a few words. Bash shows its description, never a raw secret. */
function describeTool(name: string, input: Record<string, any> | undefined): string {
  const i = input ?? {};
  const base = (p: unknown) => (typeof p === 'string' ? p.split(/[\\/]/).slice(-2).join('/') : '');
  if (name === 'Bash' || name === 'PowerShell') return clip(String(i.description || i.command || '').replace(SECRETISH, '•••'), 90);
  if (name === 'Read' || name === 'Edit' || name === 'Write' || name === 'NotebookEdit') return base(i.file_path ?? i.notebook_path);
  if (name === 'Grep' || name === 'Glob') return clip(String(i.pattern ?? ''), 60);
  if (name === 'Agent' || name === 'Task') return clip(String(i.description ?? ''), 80);
  if (name === 'WebFetch' || name === 'WebSearch') return clip(String(i.url ?? i.query ?? ''), 80);
  if (name.endsWith('__delegate')) return clip(String(i.task ?? ''), 80);
  return '';
}

const LAUNCH = /^(Agent|Task|Workflow|mcp__soul-relay__delegate)$/;

function ingestLine(acc: FileAcc, line: string) {
  let o: Record<string, any>;
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof o.sessionId === 'string' && !acc.sessionId) acc.sessionId = o.sessionId;
  if (o.isSidechain === true) acc.isSidechain = true;
  if (typeof o.agentId === 'string' && !acc.agentId) acc.agentId = o.agentId;
  // A session belongs to the folder it started in, even if it later cd's elsewhere.
  if (typeof o.cwd === 'string' && !acc.cwd) acc.cwd = o.cwd;
  if (typeof o.gitBranch === 'string' && o.gitBranch) acc.branch = o.gitBranch;
  if (typeof o.entrypoint === 'string') acc.entrypoint = o.entrypoint;
  const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
  if (!Number.isNaN(ts)) {
    acc.firstTs = Math.min(acc.firstTs, ts);
    acc.lastTs = Math.max(acc.lastTs, ts);
  }

  switch (o.type) {
    case 'assistant': {
      const m = o.message ?? {};
      const u: RawUsage | undefined = m.usage;
      const model = typeof m.model === 'string' ? m.model : 'unknown';
      if (u && typeof m.id === 'string' && model !== '<synthetic>') {
        // One API response is written as several lines sharing an id: keep the last.
        acc.calls.set(m.id, {
          ts: Number.isNaN(ts) ? acc.lastTs : ts,
          model,
          input: u.input_tokens ?? 0,
          output: u.output_tokens ?? 0,
          cacheRead: u.cache_read_input_tokens ?? 0,
          cacheWrite: u.cache_creation_input_tokens ?? 0,
          cost: estimateCost(model, u),
        });
      }
      if (typeof m.stop_reason === 'string') acc.lastStop = m.stop_reason;
      for (const b of Array.isArray(m.content) ? m.content : []) {
        if (b?.type === 'tool_use' && typeof b.name === 'string') {
          const at = Number.isNaN(ts) ? acc.lastTs : ts;
          acc.doing = { tool: b.name, detail: describeTool(b.name, b.input), ts: at };
          acc.recentTools.push(b.name);
          if (acc.recentTools.length > 40) acc.recentTools.splice(0, acc.recentTools.length - 40);
          if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) {
            acc.todos = b.input.todos.slice(0, 12).map((t: any) => ({ content: clip(String(t.content ?? ''), 120), status: String(t.status ?? 'pending') }));
          }
          // A plan: the steps of an ExitPlanMode plan, or of a to-do list.
          if (b.name === 'ExitPlanMode' && typeof b.input?.plan === 'string') {
            const steps = String(b.input.plan).split('
').map((l) => /^\s*(?:\d+[.)]|[-*])\s+(.+)/.exec(l)?.[1]).filter((x): x is string => !!x).map((x) => clip(x.replace(/\*\*/g, ''), 140));
            if (steps.length) acc.plan = { ts: at, steps: steps.slice(0, 20) };
          } else if (b.name === 'TodoWrite' && acc.todos.length) {
            acc.plan = { ts: at, steps: acc.todos.map((t) => t.content) };
          }
          if (LAUNCH.test(b.name) && typeof b.id === 'string') {
            const i = b.input ?? {};
            const kind: FlowAgent['kind'] = b.name === 'Workflow' ? 'workflow' : b.name.endsWith('__delegate') ? 'delegate' : 'subagent';
            acc.launches.set(b.id, {
              id: b.id, kind,
              label: clip(String(i.description ?? i.task ?? (kind === 'workflow' ? 'workflow' : b.name)), 80),
              agentType: typeof i.subagent_type === 'string' ? i.subagent_type : kind === 'delegate' ? (i.worker ? 'worker' : 'delegate') : null,
              model: typeof i.model === 'string' ? i.model : kind === 'delegate' ? 'haiku' : null,
              task: clip(String(i.prompt ?? i.task ?? ''), 300),
              ts: at, endedAt: null, isError: false, background: i.run_in_background === true, agentId: null,
            });
          }
        }
        if (b?.type === 'text' && b.text && !acc.isSidechain) {
          pushCapped(acc.replies, { ts, text: clip(String(b.text), 700) }, 4);
        } else if (b?.type === 'tool_use' && typeof b.name === 'string') {
          acc.tools.set(b.name, (acc.tools.get(b.name) ?? 0) + 1);
          const fp = b.input?.file_path ?? b.input?.notebook_path;
          if (typeof fp === 'string') acc.files.set(fp, ts);
        }
      }
      break;
    }
    case 'user': {
      // A hand-off returns: the tool_result of its launch.
      for (const b of Array.isArray(o.message?.content) ? o.message.content : []) {
        const l = b?.type === 'tool_result' ? acc.launches.get(b.tool_use_id) : undefined;
        if (!l) continue;
        const r = o.toolUseResult ?? {};
        if (typeof r.agentId === 'string') l.agentId = r.agentId;
        if (typeof r.resolvedModel === 'string') l.model = r.resolvedModel;
        if (r.status === 'async_launched' || r.isAsync === true) l.background = true;
        else { l.endedAt = Number.isNaN(ts) ? acc.lastTs : ts; l.isError = b.is_error === true; }
      }
      if (o.isMeta || acc.isSidechain) break;
      const text = textOf(o.message?.content);
      if (text && !text.trimStart().startsWith('<')) {
        pushCapped(acc.prompts, { ts, text: clip(text, 400) });
      }
      break;
    }
    case 'last-prompt':
      if (typeof o.lastPrompt === 'string') acc.lastPrompt = clip(o.lastPrompt, 160);
      break;
    case 'cost-state':
      if (typeof o.totalCostUSD === 'number') {
        acc.reportedCost = Math.max(acc.reportedCost ?? 0, o.totalCostUSD);
      }
      break;
  }
}

async function readNew(acc: FileAcc, size: number) {
  if (size < acc.offset) {
    Object.assign(acc, newAcc(acc.file)); // file was rewritten; start over
  }
  if (size === acc.offset) return;
  const fh = await fs.open(acc.file, 'r');
  try {
    // Read in chunks so a large first parse doesn't need one giant buffer.
    while (acc.offset < size) {
      const len = Math.min(size - acc.offset, 8 * 1024 * 1024);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, acc.offset);
      if (bytesRead === 0) break;
      acc.offset += bytesRead;
      // Split on raw newline bytes so multi-byte characters are never cut.
      const end = buf.lastIndexOf(0x0a, bytesRead - 1);
      if (end === -1) {
        acc.remainder += buf.toString('utf8', 0, bytesRead);
        continue;
      }
      const text = acc.remainder + buf.toString('utf8', 0, end);
      acc.remainder = buf.toString('utf8', end + 1, bytesRead);
      for (const line of text.split('\n')) if (line.trim()) ingestLine(acc, line);
    }
  } finally {
    await fh.close();
  }
}

function statusOf(lastTs: number, now: number): ActivityStatus {
  const age = now - lastTs;
  if (age < ACTIVE_MS) return 'active';
  if (age < RECENT_MS) return 'recent';
  return 'idle';
}

function startOfDay(now: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const tokensOf = (c: Call) => c.input + c.output + c.cacheRead + c.cacheWrite;

function sumCost(calls: Call[]): number | null {
  let total = 0;
  let known = false;
  for (const c of calls) {
    if (c.cost != null) {
      total += c.cost;
      known = true;
    }
  }
  return known ? total : null;
}

export class TranscriptIndex {
  readonly root: string;
  private accs = new Map<string, FileAcc>();
  private maxAgeMs: number;

  constructor(root?: string, maxAgeDays = Number(process.env.SOUL_DAYS ?? 30)) {
    const base = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
    this.root = root ?? path.join(base, 'projects');
    this.maxAgeMs = maxAgeDays * 86_400_000;
  }

  /** Picks up new and grown transcript files. Cheap to call every few seconds. */
  async refresh(): Promise<void> {
    let entries: string[];
    try {
      entries = (await fs.readdir(this.root, { recursive: true })) as string[];
    } catch {
      return; // no ~/.claude/projects yet
    }
    const now = Date.now();
    const seen = new Set<string>();
    for (const rel of entries) {
      if (!rel.endsWith('.jsonl')) continue;
      const file = path.join(this.root, rel);
      let st;
      try {
        st = await fs.stat(file);
      } catch {
        continue;
      }
      if (now - st.mtimeMs > this.maxAgeMs) continue;
      seen.add(file);
      let acc = this.accs.get(file);
      if (!acc) {
        acc = newAcc(file);
        this.accs.set(file, acc);
        if (rel.includes('subagents')) {
          try { acc.meta = JSON.parse(await fs.readFile(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch { /* no meta */ }
        }
      }
      if (st.size !== acc.offset) {
        try {
          await readNew(acc, st.size);
        } catch {
          /* file vanished mid-read; try again next tick */
        }
      }
    }
    for (const file of this.accs.keys()) if (!seen.has(file)) this.accs.delete(file);
  }

  private sessions(): SessionAgg[] {
    const byId = new Map<string, SessionAgg>();
    for (const acc of this.accs.values()) {
      if (!acc.cwd || acc.lastTs === 0) continue;
      const id = acc.sessionId ?? acc.file;
      let s = byId.get(id);
      if (!s) {
        s = {
          id,
          cwd: acc.cwd,
          branch: null,
          entrypoint: null,
          firstTs: Infinity,
          lastTs: 0,
          calls: [],
          prompts: [],
          replies: [],
          tools: new Map(),
          files: new Map(),
          reportedCost: null,
          lastPrompt: null,
        };
        byId.set(id, s);
      }
      if (!acc.isSidechain) {
        s.cwd = acc.cwd;
        s.branch = acc.branch ?? s.branch;
        s.entrypoint = acc.entrypoint ?? s.entrypoint;
        s.lastPrompt = acc.lastPrompt ?? s.lastPrompt;
        s.prompts.push(...acc.prompts);
        s.replies.push(...acc.replies);
        if (acc.reportedCost != null) s.reportedCost = Math.max(s.reportedCost ?? 0, acc.reportedCost);
      }
      s.firstTs = Math.min(s.firstTs, acc.firstTs);
      s.lastTs = Math.max(s.lastTs, acc.lastTs);
      s.calls.push(...acc.calls.values());
      for (const [k, v] of acc.tools) s.tools.set(k, (s.tools.get(k) ?? 0) + v);
      for (const [k, v] of acc.files) s.files.set(k, Math.max(s.files.get(k) ?? 0, v));
    }
    for (const s of byId.values()) {
      s.calls.sort((a, b) => a.ts - b.ts);
      s.prompts.sort((a, b) => a.ts - b.ts);
      s.replies.sort((a, b) => a.ts - b.ts);
    }
    return [...byId.values()];
  }

  private summarize(s: SessionAgg, now: number, dayStart: number): SessionSummary {
    const today = s.calls.filter((c) => c.ts >= dayStart);
    const mainCalls = s.calls;
    const last = mainCalls[mainCalls.length - 1];
    const contextTokens = last ? last.input + last.cacheRead + last.cacheWrite : 0;
    const model = last?.model ?? null;
    const estimate = sumCost(s.calls);
    return {
      id: s.id,
      title: s.lastPrompt ?? s.prompts[s.prompts.length - 1]?.text ?? 'Untitled session',
      branch: s.branch,
      model,
      entrypoint: s.entrypoint,
      status: statusOf(s.lastTs, now),
      startedAt: s.firstTs,
      lastActivity: s.lastTs,
      tokensTotal: s.calls.reduce((n, c) => n + tokensOf(c), 0),
      tokensToday: today.reduce((n, c) => n + tokensOf(c), 0),
      outputToday: today.reduce((n, c) => n + c.output, 0),
      // Claude Code's own cost-state line is only written now and then, so it can lag.
      costTotal: s.reportedCost == null ? estimate : Math.max(s.reportedCost, estimate ?? 0),
      costToday: sumCost(today),
      contextTokens,
      contextPct: last ? Math.min(100, (contextTokens / contextWindow(model)) * 100) : null,
    };
  }

  snapshot(): Snapshot {
    const now = Date.now();
    const dayStart = startOfDay(now);
    const sessions = this.sessions();
    const groups = new Map<string, SessionAgg[]>();
    for (const s of sessions) {
      const list = groups.get(s.cwd) ?? [];
      list.push(s);
      groups.set(s.cwd, list);
    }

    const names = new Map<string, number>();
    for (const cwd of groups.keys()) {
      const n = path.basename(cwd);
      names.set(n, (names.get(n) ?? 0) + 1);
    }

    const projects: ProjectSnapshot[] = [];
    for (const [cwd, list] of groups) {
      const sums = list.map((s) => this.summarize(s, now, dayStart)).sort((a, b) => b.lastActivity - a.lastActivity);
      const base = path.basename(cwd) || cwd;
      const name = (names.get(base) ?? 0) > 1 ? `${path.basename(path.dirname(cwd))}/${base}` : base;
      const lastActivity = sums[0]?.lastActivity ?? 0;
      const live = sums.filter((s) => s.status === 'active');
      const costsToday = sums.map((s) => s.costToday).filter((c): c is number => c != null);
      const costsTotal = sums.map((s) => s.costTotal).filter((c): c is number => c != null);
      const ctx = live.map((s) => s.contextPct).filter((c): c is number => c != null);
      projects.push({
        id: cwd,
        name,
        path: cwd,
        status: statusOf(lastActivity, now),
        branch: sums[0]?.branch ?? null,
        lastActivity,
        sessionCount: sums.length,
        liveSessions: live.length,
        tokensToday: sums.reduce((n, s) => n + s.tokensToday, 0),
        tokensTotal: sums.reduce((n, s) => n + s.tokensTotal, 0),
        outputToday: sums.reduce((n, s) => n + s.outputToday, 0),
        costToday: costsToday.length ? costsToday.reduce((a, b) => a + b, 0) : null,
        costTotal: costsTotal.length ? costsTotal.reduce((a, b) => a + b, 0) : null,
        models: [...new Set(list.flatMap((s) => s.calls.map((c) => c.model)))],
        contextPct: ctx.length ? Math.max(...ctx) : null,
        lastPrompt: sums[0]?.title ?? null,
        sessions: sums.slice(0, 12),
      });
    }
    projects.sort((a, b) => b.lastActivity - a.lastActivity);

    const burn = new Array(30).fill(0);
    const minuteNow = Math.floor(now / 60_000);
    for (const s of sessions) {
      for (const c of s.calls) {
        const idx = 29 - (minuteNow - Math.floor(c.ts / 60_000));
        if (idx >= 0 && idx < 30) burn[idx] += tokensOf(c);
      }
    }
    const costs = projects.map((p) => p.costToday).filter((c): c is number => c != null);

    return {
      generatedAt: now,
      source: 'transcripts',
      root: this.root,
      projects,
      totals: {
        tokensToday: projects.reduce((n, p) => n + p.tokensToday, 0),
        outputToday: projects.reduce((n, p) => n + p.outputToday, 0),
        costToday: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
        liveSessions: projects.reduce((n, p) => n + p.liveSessions, 0),
        sessions: projects.reduce((n, p) => n + p.sessionCount, 0),
        projects: projects.length,
        burnPerMin: Math.round((burn[28] + burn[29]) / 2),
      },
      burn,
      relay: { countToday: 0, costToday: 0, savedToday: 0, recent: [] },
    };
  }

  /** Relay: live and recent chats, what each is doing, and the work it handed off. */
  flow(windowMs = 24 * 3_600_000): FlowChat[] {
    const now = Date.now();
    const dayStart = startOfDay(now);
    const mains = new Map<string, FileAcc>();
    const subs = new Map<string, FileAcc[]>();
    for (const acc of this.accs.values()) {
      if (!acc.sessionId) continue;
      if (acc.isSidechain || acc.agentId) {
        const list = subs.get(acc.sessionId) ?? [];
        list.push(acc);
        subs.set(acc.sessionId, list);
      } else {
        const cur = mains.get(acc.sessionId);
        if (!cur || acc.lastTs > cur.lastTs) mains.set(acc.sessionId, acc);
      }
    }
    const aggs = new Map(this.sessions().map((s) => [s.id, s]));
    const chats: FlowChat[] = [];
    for (const [id, m] of mains) {
      if (!m.cwd || now - m.lastTs > windowMs) continue;
      const agg = aggs.get(id);
      const sum = agg ? this.summarize(agg, now, dayStart) : null;
      const files = subs.get(id) ?? [];
      const byLaunch = new Map<string, FileAcc>();
      for (const f of files) {
        const key = f.meta?.toolUseId ?? [...m.launches.values()].find((l) => l.agentId && l.agentId === f.agentId)?.id;
        if (key) byLaunch.set(key, f);
      }
      const agents: FlowAgent[] = [...m.launches.values()].sort((a, b) => b.ts - a.ts).slice(0, 12).map((l) => {
        const f = byLaunch.get(l.id);
        const calls = f ? [...f.calls.values()] : [];
        const last = f?.lastTs ?? l.endedAt ?? l.ts;
        const model = calls[calls.length - 1]?.model ?? l.model;
        // A background sub-agent has returned once its last turn ended and it went quiet.
        const status: FlowAgent['status'] = l.isError ? 'failed'
          : l.endedAt != null && !l.background ? 'returned'
          : f && f.lastStop === 'end_turn' && now - f.lastTs > 15_000 ? 'returned'
          : now - last > 10 * 60_000 ? (l.background ? 'returned' : 'stopped')
          : 'running';
        return {
          id: l.id, kind: l.kind, label: l.label || f?.meta?.description || 'task',
          agentType: l.agentType ?? f?.meta?.agentType ?? null, model, task: l.task, status, background: l.background,
          startedAt: l.ts, endedAt: status === 'running' ? null : l.endedAt ?? last, lastActivity: last,
          tokens: calls.reduce((n, c) => n + tokensOf(c), 0), cost: calls.length ? sumCost(calls) : null,
          toolCalls: f ? [...f.tools.values()].reduce((a, b) => a + b, 0) : 0,
        };
      });
      const status = statusOf(m.lastTs, now);
      chats.push({
        id, title: sum?.title ?? m.lastPrompt ?? 'Untitled chat', cwd: m.cwd, folder: path.basename(m.cwd) || m.cwd,
        model: sum?.model ?? null, status,
        phase: status === 'idle' ? 'idle' : m.lastStop === 'end_turn' ? 'waiting' : 'working',
        lastActivity: m.lastTs, prompt: m.prompts[m.prompts.length - 1]?.text ?? m.lastPrompt,
        doing: m.doing, todos: m.todos, plan: m.plan, contextPct: sum?.contextPct ?? null, costToday: sum?.costToday ?? null,
        recentTools: m.recentTools.slice(-30), agents,
      });
    }
    return chats.sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 14);
  }

  /** Per-session detail (recent prompts, replies, tools, files) for one project. */
  sessionDetails(projectId: string): SessionDetail[] {
    const now = Date.now();
    const dayStart = startOfDay(now);
    return this.sessions()
      .filter((s) => s.cwd === projectId)
      .sort((a, b) => b.lastTs - a.lastTs)
      .slice(0, 6)
      .map((s) => ({
        ...this.summarize(s, now, dayStart),
        prompts: s.prompts.slice(-6),
        replies: s.replies.slice(-3),
        tools: [...s.tools].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
        files: [...s.files]
          .map(([p, ts]) => ({ path: p, ts }))
          .sort((a, b) => b.ts - a.ts)
          .slice(0, 10),
      }));
  }
}
