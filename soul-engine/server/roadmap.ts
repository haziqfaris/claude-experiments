// Roadmaps: each project keeps its own (docs/ROADMAP.md by default, in its repo). The hub reads it into sections
// (Now, Next, Later…) and items (table rows, checkboxes, sub-headings), lists every commit that changed it,
// and saves a daily snapshot so it can say what was added, finished, moved or slipped.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Roadmap, RoadmapChanges, RoadmapItem, RoadmapSection, RoadmapItemState } from '../src/types';

const run = promisify(execFile);
const DIR = path.join(path.dirname(process.env.SOUL_DATA_DIR ?? path.join(os.homedir(), '.claude', 'soul-engine', 'inventory-history')), 'roadmap-history');
const KEEP = 180;

const SKIP = /(^|\/)(node_modules|templates?|kits?|vendor|examples?)\//i;
/** Which file is a project's roadmap: one you set, else docs/ROADMAP.md, else the likeliest plan. */
export function pickRoadmapFile(files: string[], pinned?: string | null): { file: string; kind: Roadmap['kind'] } | null {
  if (pinned && files.includes(pinned)) return { file: pinned, kind: 'roadmap' };
  const md = files.filter((f) => f.toLowerCase().endsWith('.md') && !SKIP.test(f));
  const rank = (re: RegExp) => md.filter((f) => re.test(f)).sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0];
  const roadmap = md.find((f) => /^docs\/roadmap\.md$/i.test(f)) ?? md.find((f) => /^roadmap\.md$/i.test(f)) ?? rank(/(^|\/)[^/]*roadmap[^/]*\.md$/i);
  if (roadmap) return { file: roadmap, kind: 'roadmap' };
  const plan = rank(/(^|\/)[^/]*(build[-_ ]?plan|implementation[-_ ]?plan|delivery[-_ ]?plan|backlog)[^/]*\.md$/i) ?? rank(/(^|\/)(progress|plan)\.md$/i);
  return plan ? { file: plan, kind: 'plan' } : null;
}

const HORIZON: [RegExp, RoadmapSection['horizon']][] = [
  [/\b(recently done|done|completed|shipped|released)\b/i, 'done'],
  [/^(now|current|in progress|this (month|quarter|sprint))\b/i, 'now'],
  [/^next\b/i, 'next'],
  [/^later\b/i, 'later'],
  [/^(future|beyond|someday|ideas?)\b/i, 'future'],
];
const NOT_ROADMAP = /^(where (it|the product|we|things) (stand|are)s?|summary|overview|context|contents|sources|how to (read|use)|decisions?\b|risks?|glossary|notes?|what changed|assumptions)/i;
const DATE = /\b(\d{4}-\d{2}-\d{2}|(?:\d{1,2}[–-]?\d{0,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s+\d{4})?(?:\s+to\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{0,4})?|q[1-4]\s+\d{4}|w\d{1,2}\s+\d{4})\b/i;
const GATE = /\b(gate\s+[a-z0-9]+|G[A-Z]{1,2})\b/;

export function stateOf(text: string): RoadmapItemState {
  const t = text.toLowerCase();
  if (/✅|\bdone\b|complete|shipped|closed|merged|released|\blive\b|finished/.test(t)) return 'done';
  if (/blocked|on hold|waiting|needs (a )?(decision|approval|account|owner|access)|depends on (an? )?(decision|client)|stuck/.test(t)) return 'blocked';
  if (/in progress|wip|building|ongoing|started|partial|underway|half/.test(t)) return 'in progress';
  return 'planned';
}

const clean = (s: string) => s.replace(/\*\*|__|`|\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const keyOf = (id: string | null, title: string) => (id ? id.toLowerCase() : title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60));

export function parseRoadmap(text: string): { title: string | null; sections: RoadmapSection[] } {
  const lines = text.split(/\r?\n/);
  const sections: RoadmapSection[] = [];
  let title: string | null = null;
  let sec: RoadmapSection | null = null;
  let table: { cols: string[] } | null = null;
  let order = 0;
  const startSection = (heading: string) => {
    const h = clean(heading);
    const horizon = HORIZON.find(([re]) => re.test(h))?.[1] ?? (/^\d+[a-z]?[.)]/.test(h) ? 'step' : 'other');
    sec = { title: h.slice(0, 140), horizon, date: DATE.exec(h)?.[0] ?? null, gate: GATE.exec(h)?.[0] ?? null, state: 'planned', items: [], order: order++ };
    if (/\*\*done|✅|— done|: done|\bdone \d{4}/i.test(heading)) sec.state = 'done';
    sections.push(sec);
  };
  const add = (it: Omit<RoadmapItem, 'key' | 'section'>) => {
    if (!sec) startSection('Roadmap');
    const s = sec!;
    if (!it.title || s.items.length >= 60) return;
    s.items.push({ ...it, key: keyOf(it.id, it.title), section: s.title });
  };
  for (const line of lines) {
    const h = /^(#{1,4})\s+(.+)$/.exec(line);
    if (h) {
      table = null;
      const level = h[1].length;
      if (level === 1) { title = title ?? clean(h[2]); continue; }
      if (level === 2) { startSection(h[2]); continue; }
      // Sub-headings under a section are items (a track or a deliverable).
      if (sec) add({ id: null, title: clean(h[2]).slice(0, 160), state: stateOf(h[2]), status: null, owner: null, due: DATE.exec(h[2])?.[0] ?? null });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => clean(c));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;
      if (!table) { table = { cols: cells.map((c) => c.toLowerCase()) }; continue; }
      const col = (re: RegExp) => { const i = table!.cols.findIndex((c) => re.test(c)); return i >= 0 ? cells[i] ?? '' : ''; };
      const id = col(/^(id|#|ref|no\.?)$/) || null;
      const itemTitle = col(/^(item|title|task|deliverable|work|what|feature|milestone|scope|name)/) || (id ? cells[1] ?? '' : '');
      if (!itemTitle || (!id && !table.cols.some((c) => /status|state|done|owner|due|date|when|target/.test(c)))) continue;
      const status = col(/^(status|state|progress|done)/) || null;
      add({ id, title: itemTitle.slice(0, 160), state: status ? stateOf(status) : 'planned', status, owner: col(/^(owner|who|by|lead)/) || null, due: col(/^(due|date|when|target|by when|eta)/) || null });
      continue;
    }
    table = null;
    const box = /^\s*[-*+]\s+\[( |x|X)\]\s+(.+)$/.exec(line);
    if (box) add({ id: null, title: clean(box[2]).slice(0, 160), state: box[1] === ' ' ? stateOf(box[2]) === 'blocked' ? 'blocked' : 'planned' : 'done', status: null, owner: null, due: DATE.exec(box[2])?.[0] ?? null });
  }
  for (const s of sections) {
    if (s.state !== 'done' && s.items.length && s.items.every((i) => i.state === 'done')) s.state = 'done';
    else if (s.state !== 'done' && (s.horizon === 'now' || s.items.some((i) => i.state === 'in progress' || i.state === 'done'))) s.state = 'in progress';
    if (s.horizon === 'done') { s.state = 'done'; for (const i of s.items) if (i.state === 'planned') i.state = 'done'; }
  }
  return { title, sections: sections.filter((s) => s.items.length || (!NOT_ROADMAP.test(s.title) && s.horizon !== 'other')) };
}

export async function readRoadmap(repoName: string, dir: string, files: string[], pinned?: string | null): Promise<Roadmap | null> {
  const pick = pickRoadmapFile(files, pinned);
  if (!pick) return null;
  let text = '';
  try { text = await fs.readFile(path.join(dir, pick.file), 'utf8'); } catch { return null; }
  const { title, sections } = parseRoadmap(text);
  let log = '';
  try { log = (await run('git', ['-C', dir, 'log', '--follow', '-n', '20', '--format=%ct%x09%h%x09%an%x09%s', '--', pick.file], { timeout: 15_000 })).stdout.trim(); } catch { /* not committed */ }
  const history = log ? log.split('\n').map((l) => { const [t, hash, author, ...s] = l.split('\t'); return { ts: Number(t) * 1000, hash, author, subject: s.join('\t').slice(0, 140) }; }) : [];
  const items = sections.flatMap((s) => s.items);
  return {
    repo: repoName, file: pick.file, kind: pick.kind, title, sections,
    updated: history[0]?.ts ?? null, history,
    counts: {
      done: items.filter((i) => i.state === 'done').length,
      inProgress: items.filter((i) => i.state === 'in progress').length,
      blocked: items.filter((i) => i.state === 'blocked').length,
      planned: items.filter((i) => i.state === 'planned').length,
    },
  };
}

// ---- Daily snapshots and what changed ----

type Snap = Record<string, { file: string; sections: { title: string; date: string | null; items: { key: string; title: string; state: RoadmapItemState; status: string | null; due: string | null; section: string }[] }[] }>;

const day = (ts: number) => { const d = new Date(ts), p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

export async function saveRoadmaps(list: { project: string; roadmap: Roadmap | null }[]): Promise<void> {
  const snap: Snap = {};
  for (const { project, roadmap } of list) if (roadmap) snap[project] = { file: `${roadmap.repo}/${roadmap.file}`, sections: roadmap.sections.map((s) => ({ title: s.title, date: s.date, items: s.items.map((i) => ({ key: i.key, title: i.title, state: i.state, status: i.status, due: i.due, section: i.section })) })) };
  if (!Object.keys(snap).length) return;
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${day(Date.now())}.json`), JSON.stringify(snap));
  const files = (await fs.readdir(DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) await fs.unlink(path.join(DIR, f)).catch(() => {});
}

async function snapBefore(days: number): Promise<{ at: number; snap: Snap } | null> {
  let files: string[] = [];
  try { files = (await fs.readdir(DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort(); } catch { return null; }
  const cutoff = day(Date.now() - days * 86_400_000);
  const older = files.filter((f) => f.slice(0, 10) <= cutoff && f.slice(0, 10) < day(Date.now()));
  const pick = older[older.length - 1] ?? files.find((f) => f.slice(0, 10) < day(Date.now()));
  if (!pick) return null;
  try { return { at: Date.parse(pick.slice(0, 10)), snap: JSON.parse(await fs.readFile(path.join(DIR, pick), 'utf8')) as Snap }; } catch { return null; }
}

/** What changed in each project's roadmap since `days` ago: items added, removed, finished, moved, or with a new date. */
export async function roadmapChanges(list: { project: string; roadmap: Roadmap | null }[], days: number): Promise<RoadmapChanges> {
  const before = await snapBefore(days);
  const out: RoadmapChanges = { from: before?.at ?? null, to: Date.now(), firstRun: !before, projects: [] };
  for (const { project, roadmap } of list) {
    const commits = (roadmap?.history ?? []).filter((h) => h.ts >= Date.now() - days * 86_400_000);
    const old = before?.snap[project];
    const now = roadmap ? roadmap.sections.flatMap((s) => s.items) : [];
    const was = old ? old.sections.flatMap((s) => s.items) : [];
    const byKey = new Map(was.map((i) => [i.key, i]));
    const nowKeys = new Set(now.map((i) => i.key));
    const added = old ? now.filter((i) => !byKey.has(i.key)).map((i) => ({ title: i.title, section: i.section })) : [];
    const removed = was.filter((i) => !nowKeys.has(i.key)).map((i) => ({ title: i.title, section: i.section }));
    const changed: RoadmapChanges['projects'][number]['changed'] = [];
    for (const i of now) {
      const o = byKey.get(i.key);
      if (!o) continue;
      if (o.state !== i.state) changed.push({ title: i.title, what: 'state', from: o.status ?? o.state, to: i.status ?? i.state });
      if (o.section !== i.section) changed.push({ title: i.title, what: 'moved', from: o.section, to: i.section });
      if ((o.due ?? '') !== (i.due ?? '') && (o.due || i.due)) changed.push({ title: i.title, what: 'date', from: o.due ?? '—', to: i.due ?? '—' });
    }
    if (old && roadmap) for (const s of roadmap.sections) {
      const os2 = old.sections.find((x) => x.title === s.title);
      if (os2 && (os2.date ?? '') !== (s.date ?? '')) changed.push({ title: s.title, what: 'date', from: os2.date ?? '—', to: s.date ?? '—' });
    }
    if (commits.length || added.length || removed.length || changed.length || (!roadmap && old)) {
      out.projects.push({ project, file: roadmap ? `${roadmap.repo}/${roadmap.file}` : old?.file ?? '', commits, added, removed, changed, gone: !roadmap && !!old });
    }
  }
  return out;
}

export function roadmapMarkdown(project: string, r: Roadmap | null): string {
  if (!r) return `${project} has no roadmap yet. In a Claude Code chat in this project, type /soul-roadmap to draft docs/ROADMAP.md from its plans.`;
  const lines = [`${project} roadmap (${r.repo}/${r.file}${r.kind === 'plan' ? ', a plan file: no ROADMAP.md yet' : ''}${r.updated ? `, last changed ${new Date(r.updated).toISOString().slice(0, 10)}` : ''})`,
    `${r.counts.done} done · ${r.counts.inProgress} in progress · ${r.counts.blocked} blocked · ${r.counts.planned} planned`, ''];
  for (const s of r.sections) {
    lines.push(`## ${s.title} [${s.state}]`);
    for (const i of s.items.slice(0, 25)) lines.push(`- ${i.id ? `${i.id} ` : ''}${i.title} · ${i.status ?? i.state}${i.owner ? ` · ${i.owner}` : ''}${i.due ? ` · ${i.due}` : ''}`);
  }
  if (r.history.length) lines.push('', 'Recent changes to the file:', ...r.history.slice(0, 6).map((h) => `- ${new Date(h.ts).toISOString().slice(0, 10)} ${h.hash} ${h.subject}`));
  return lines.join('\n');
}
