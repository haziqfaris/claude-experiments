// v4 data for the dashboard: chats in their projects, the Today feed, one task board, and an outbox for messages
// you send into a chat. Everything is computed on this machine from transcripts, repos and the status scan.
import { randomUUID } from 'node:crypto';
import type { ChatItem, ChatState, FeedItem, FlowChat, FlowSuggestion, OutboxItem, ProjectStatus, TaskItem } from '../src/types';
import { routeStep } from './routes';

const WAITING_DAYS = 7;

/** A reply that ends by asking you something (its last line or two carry a question). */
function questionIn(reply: string | null): string | null {
  if (!reply) return null;
  const tail = reply.trim().split(/(?<=[.!?])\s+/).slice(-3).join(' ');
  const q = tail.split(/(?<=[.!?])\s+/).reverse().find((x) => x.trim().endsWith('?'));
  return q ? q.trim().slice(0, 240) : null;
}

export function toChatItems(chats: FlowChat[], projectOf: (cwd: string) => string | null, now = Date.now()): ChatItem[] {
  return chats.map((c) => {
    const asked = questionIn(c.lastReply);
    // Working while it calls tools; waiting when it ended its turn with a question for you; otherwise idle.
    const state: ChatState = c.phase === 'working' ? 'working'
      : asked && now - c.lastActivity < WAITING_DAYS * 86_400_000 ? 'waiting'
      : 'idle';
    const todos = c.todos ?? [];
    const steps = todos.length
      ? todos.map((t) => ({ text: t.content, done: t.status === 'completed', now: t.status === 'in_progress' }))
      : (c.plan?.steps ?? []).map((t) => ({ text: t, done: false, now: false }));
    return { ...c, project: projectOf(c.cwd) ?? c.folder, state, asked: state === 'waiting' ? asked : null, steps };
  });
}

const kindOf = (s: string) => (/merged|came back|returned/.test(s) ? 'merge' : 'split');

/** What happened recently, newest first: splits and merges, questions waiting, commits, roadmap changes, sites down. */
export function buildFeed(chats: ChatItem[], status: ProjectStatus[], hours = 24, now = Date.now()): FeedItem[] {
  const since = now - hours * 3_600_000;
  const out: FeedItem[] = [];
  for (const c of chats) {
    const name = c.name ?? c.title;
    for (const a of c.agents) {
      const model = a.model ? (/haiku/i.test(a.model) ? 'Haiku' : /sonnet/i.test(a.model) ? 'Sonnet' : /opus|fable/i.test(a.model) ? 'Opus' : a.model) : 'a cheaper model';
      if (a.startedAt >= since) out.push({ at: a.startedAt, kind: 'split', text: `${name} handed “${a.label}” to ${model}${a.agentType ? ` (${a.agentType})` : ''}`, project: c.project, chat: c.id });
      if (a.status === 'returned' && a.endedAt && a.endedAt >= since) out.push({ at: a.endedAt, kind: 'merge', text: `“${a.label}” came back from ${model} and merged into ${name}`, project: c.project, chat: c.id });
    }
    if (c.state === 'waiting' && c.asked) out.push({ at: c.lastActivity, kind: 'ask', text: `${name} is waiting for you: “${c.asked}”`, project: c.project, chat: c.id });
  }
  for (const p of status) {
    for (const r of p.repos) if (r.lastCommit && r.lastCommit.date >= since) out.push({ at: r.lastCommit.date, kind: 'commit', text: `${r.name}: ${r.lastCommit.subject}`, project: p.name, chat: null });
    for (const h of p.roadmap?.history ?? []) if (h.ts >= since) out.push({ at: h.ts, kind: 'roadmap', text: `Roadmap: ${h.subject}`, project: p.name, chat: null });
    for (const l of p.live) if (!l.ok && !l.staging && l.source !== 'platform address') out.push({ at: l.checkedAt, kind: 'site', text: `${l.url} is not answering${l.status ? ` (${l.status})` : ''}`, project: p.name, chat: null });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 60);
}

/** One board: roadmap items, chat plan steps, and the soul's suggestions, each with where it should run. */
export function buildTasks(chats: ChatItem[], status: ProjectStatus[], suggestions: FlowSuggestion[]): TaskItem[] {
  const out: TaskItem[] = [];
  const add = (t: Omit<TaskItem, 'model' | 'where' | 'why' | 'instruction'> & Partial<Pick<TaskItem, 'model' | 'where' | 'why' | 'instruction'>>) => {
    const r = routeStep(t.title, t.project);
    out.push({ model: r.model, where: r.where, why: r.why, instruction: r.instruction, ...t });
  };
  for (const p of status) {
    const rm = p.roadmap?.kind === 'roadmap' ? p.roadmap : null;
    if (!rm) continue;
    let n = 0;
    for (const sec of rm.sections) {
      for (const i of sec.items) {
        if (sec.horizon === 'done' || (i.state === 'done' && n > 20)) continue;
        if (++n > 24) break;
        add({
          id: `rm:${p.name}:${i.key}`, title: i.title, project: p.name, src: 'roadmap', ref: i.id ?? sec.title.slice(0, 40),
          status: i.state === 'done' ? 'done' : i.state === 'blocked' ? 'blocked' : i.state === 'in progress' ? 'doing' : 'todo',
          chat: null, owner: i.owner, due: i.due, saving: null,
        });
      }
    }
  }
  for (const c of chats.filter((x) => x.state !== 'idle' || Date.now() - x.lastActivity < 3 * 86_400_000)) {
    c.steps.slice(0, 16).forEach((s, i) => add({
      id: `plan:${c.id}:${i}`, title: s.text, project: c.project, src: 'plan', ref: `${c.name ?? 'chat'} · step ${i + 1}`,
      status: s.done ? 'done' : s.now ? 'doing' : c.state === 'waiting' && i === c.steps.findIndex((x) => !x.done) ? 'blocked' : 'todo',
      chat: c.id, owner: null, due: null, saving: null,
    }));
  }
  for (const s of suggestions) {
    const c = chats.find((x) => x.id === s.chatId);
    out.push({
      id: `soul:${s.id}`, title: s.title, project: c?.project ?? 'Other', src: 'soul', ref: s.kind, status: 'todo', chat: s.chatId,
      model: /haiku/.test(s.to) ? 'haiku' : /sonnet/.test(s.to) ? 'sonnet' : 'opus', where: s.to, why: s.why, instruction: s.instruction,
      owner: null, due: null, saving: s.saving,
    });
  }
  return out;
}

// ---- Outbox: a message you chose to send into one chat. The soul-relay plugin in that chat collects it. ----
const outbox: OutboxItem[] = [];

export function queueMessage(session: string, text: string): OutboxItem {
  const item: OutboxItem = { id: randomUUID(), session, text: text.slice(0, 8000), at: Date.now(), status: 'queued', deliveredAt: null };
  outbox.push(item);
  if (outbox.length > 200) outbox.splice(0, outbox.length - 200);
  return item;
}

/** Called by the plugin in a chat: hands over what is queued for that chat, once. */
export function collectMessages(session: string): OutboxItem[] {
  const now = Date.now();
  const mine = outbox.filter((m) => m.session === session && m.status === 'queued');
  for (const m of mine) { m.status = 'delivered'; m.deliveredAt = now; }
  return mine;
}

export const outboxList = () => [...outbox].reverse().slice(0, 50);
