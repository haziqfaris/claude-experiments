// Savings: the model mix per day, what it would have cost all on Opus, the delegate hand-offs the plugin reports,
// and the auto-split switch the soul-relay plugin reads. Delegations and the switch are kept in ~/.claude/soul-engine
// so they survive hub restarts.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AutoSplit, Delegation, ModelMix, Savings } from '../src/types';

const DIR = path.join(os.homedir(), '.claude', 'soul-engine');
const DELEGATIONS = path.join(DIR, 'delegations.jsonl');
const AUTOSPLIT = path.join(DIR, 'autosplit.json');

// ---- Delegations, kept on disk ----
let kept: Delegation[] | null = null;
export async function keptDelegations(): Promise<Delegation[]> {
  if (kept) return kept;
  try {
    kept = (await fs.readFile(DELEGATIONS, 'utf8')).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as Delegation; } catch { return null; } }).filter((d): d is Delegation => !!d);
  } catch { kept = []; }
  return kept;
}
export async function keepDelegation(d: Delegation) {
  (await keptDelegations()).push(d);
  try { await fs.mkdir(DIR, { recursive: true }); await fs.appendFile(DELEGATIONS, JSON.stringify(d) + '\n', 'utf8'); } catch { /* best effort */ }
}

// ---- The auto-split switch ----
let split: AutoSplit | null = null;
export async function getAutoSplit(): Promise<AutoSplit> {
  if (split) return split;
  try { const r = JSON.parse(await fs.readFile(AUTOSPLIT, 'utf8')) as Partial<AutoSplit>; split = { all: r.all === true, chats: r.chats ?? {}, since: r.since ?? null }; }
  catch { split = { all: false, chats: {}, since: null }; }
  return split;
}
/** Turns it on or off for every chat (session null) or one chat; `reset` drops a chat's own setting. */
export async function setAutoSplit(body: { session?: unknown; on?: unknown; reset?: unknown }): Promise<AutoSplit | string> {
  const s = await getAutoSplit();
  const session = typeof body.session === 'string' && body.session ? body.session.slice(0, 100) : null;
  if (body.reset === true && session) delete s.chats[session];
  else if (typeof body.on !== 'boolean') return 'expected { on: true|false, session? }';
  else if (session) s.chats[session] = body.on;
  else s.all = body.on;
  if ((s.all || Object.values(s.chats).some(Boolean)) && !s.since) s.since = Date.now();
  try { await fs.mkdir(DIR, { recursive: true }); await fs.writeFile(AUTOSPLIT, JSON.stringify(s, null, 2) + '\n', 'utf8'); } catch { /* best effort */ }
  return s;
}
export const autoSplitFor = (s: AutoSplit, session: string) => (session in s.chats ? s.chats[session] : s.all);

export async function buildSavings(mix: ModelMix): Promise<Savings> {
  const ds = await keptDelegations();
  const delegates = mix.days.map((d) => {
    const mine = ds.filter((x) => x.route === 'model' && x.at >= d.date && x.at < d.date + 86_400_000);
    return { date: d.date, count: mine.length, tokens: mine.reduce((n, x) => n + x.tokens, 0), cost: mine.reduce((n, x) => n + x.cost, 0), saved: mine.reduce((n, x) => n + x.saved, 0) };
  });
  return { ...mix, delegates, autoSplit: await getAutoSplit() };
}
