// Inventory history: one snapshot per day on this machine (never in the repo), and what changed
// between two of them: new or removed keys, APIs, services, hosting, domains, addresses, sign-in, jobs.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Inventory, InventoryCategory, InventoryFact } from '../src/types';
import { CATEGORY_LABEL } from './inventory';

const DIR = process.env.SOUL_DATA_DIR ?? path.join(os.homedir(), '.claude', 'soul-engine', 'inventory-history');
const KEEP = 90;
const WATCH: InventoryCategory[] = ['apikey', 'api', 'service', 'hosting', 'domain', 'email', 'signin', 'job'];

function day(ts: number): string {
  const d = new Date(ts), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Saves today's snapshot (overwriting an earlier one from today) and prunes old ones. */
export async function saveSnapshot(inv: Inventory): Promise<void> {
  if (!inv.projects.length) return;
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(path.join(DIR, `${day(inv.scannedAt)}.json`), JSON.stringify(inv));
  const files = (await fs.readdir(DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) await fs.unlink(path.join(DIR, f)).catch(() => {});
}

/** The newest saved snapshot from at least `days` ago, else the oldest one there is. */
export async function snapshotBefore(days: number): Promise<Inventory | null> {
  let files: string[] = [];
  try { files = (await fs.readdir(DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort(); } catch { return null; }
  if (!files.length) return null;
  const cutoff = day(Date.now() - days * 86_400_000);
  const pick = [...files].reverse().find((f) => f.slice(0, 10) <= cutoff) ?? files[0];
  try { return JSON.parse(await fs.readFile(path.join(DIR, pick), 'utf8')) as Inventory; } catch { return null; }
}

export interface RepoChange { project: string; repo: string; status: 'new' | 'gone' | 'changed'; added: InventoryFact[]; removed: InventoryFact[] }
export interface ChangeReport { from: number | null; to: number; repos: RepoChange[]; firstRun: boolean }

const key = (f: InventoryFact) => `${f.category}|${f.label}|${f.value}`.toLowerCase();

export function diffInventories(older: Inventory | null, newer: Inventory): ChangeReport {
  if (!older) return { from: null, to: newer.scannedAt, repos: [], firstRun: true };
  const byRepo = (inv: Inventory) => new Map(inv.projects.map((p) => [p.name.toLowerCase(), p]));
  const a = byRepo(older), b = byRepo(newer);
  const out: RepoChange[] = [];
  for (const [name, p] of b) {
    const prev = a.get(name);
    const now = p.facts.filter((f) => WATCH.includes(f.category));
    if (!prev) { out.push({ project: p.project, repo: p.name, status: 'new', added: now, removed: [] }); continue; }
    const before = new Set(prev.facts.filter((f) => WATCH.includes(f.category)).map(key));
    const after = new Set(now.map(key));
    const added = now.filter((f) => !before.has(key(f)));
    const removed = prev.facts.filter((f) => WATCH.includes(f.category) && !after.has(key(f)));
    if (added.length || removed.length) out.push({ project: p.project, repo: p.name, status: 'changed', added, removed });
  }
  for (const [name, p] of a) if (!b.has(name)) out.push({ project: p.project ?? p.name, repo: p.name, status: 'gone', added: [], removed: [] });
  out.sort((x, y) => x.project.localeCompare(y.project) || x.repo.localeCompare(y.repo));
  return { from: older.scannedAt, to: newer.scannedAt, repos: out, firstRun: false };
}

export function changeReportMarkdown(r: ChangeReport): string {
  const when = (t: number) => new Date(t).toISOString().slice(0, 10);
  if (r.firstRun) return `# Inventory changes\n\nNo earlier snapshot yet. The first one was saved ${when(r.to)}; changes appear from tomorrow on.\n`;
  const lines = [`# Inventory changes, ${when(r.from!)} to ${when(r.to)}`, ''];
  if (!r.repos.length) lines.push('Nothing changed in keys, APIs, services, hosting, domains, addresses, sign-in or jobs.');
  let project = '';
  for (const c of r.repos) {
    if (c.project !== project) { project = c.project; lines.push(`## ${project}`, ''); }
    lines.push(`### ${c.repo}${c.status === 'new' ? ' (new on this machine)' : c.status === 'gone' ? ' (no longer on this machine)' : ''}`);
    for (const cat of WATCH) {
      const add = c.added.filter((f) => f.category === cat), rem = c.removed.filter((f) => f.category === cat);
      if (!add.length && !rem.length) continue;
      lines.push(`- **${CATEGORY_LABEL[cat]}**`);
      for (const f of add) lines.push(`  - added: ${f.label}: ${f.value}${f.evidence[0] ? ` (${f.evidence[0]})` : ''}`);
      for (const f of rem) lines.push(`  - removed: ${f.label}: ${f.value}`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

/** Once a week, writes the change report as Markdown next to the snapshots (reports/YYYY-MM-DD.md). */
export async function maybeWriteWeeklyReport(inv: Inventory): Promise<string | null> {
  const dir = path.join(DIR, 'reports');
  await fs.mkdir(dir, { recursive: true });
  const last = (await fs.readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().pop();
  if (last && Date.now() - Date.parse(last.slice(0, 10)) < 7 * 86_400_000) return null;
  const report = diffInventories(await snapshotBefore(7), inv);
  if (report.firstRun) return null;
  const file = path.join(dir, `${day(inv.scannedAt)}.md`);
  await fs.writeFile(file, changeReportMarkdown(report));
  return file;
}
