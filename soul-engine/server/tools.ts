// Tools the Soul Engine may call while answering. All read-only, confined to the scanned repos,
// never open .env files, and every line they return passes through scrub() (no secret values).
import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Inventory, ProjectInventory } from '../src/types';

/** A project soul's boundary: its name and the repo names it may touch. */
export interface SoulScope { name: string; repos: Set<string> }

export function scopedInventory(inv: Inventory, scope: SoulScope | null): Inventory {
  if (!scope) return inv;
  return { ...inv, projects: inv.projects.filter((p) => scope.repos.has(p.name.toLowerCase())), groups: inv.groups.filter((g) => g.name === scope.name) };
}

/** The scope of a project (a group in projects.local.json), or of a lone repo with that name. */
export function scopeFor(inv: Inventory, name: string | null | undefined): SoulScope | null {
  if (!name) return null;
  const g = inv.groups.find((x) => x.name === name);
  const repos = g ? inv.projects.filter((p) => g.repos.includes(p.id)) : inv.projects.filter((p) => p.name === name);
  return { name, repos: new Set(repos.map((r) => r.name.toLowerCase())) };
}
import { accessRegisterDraft, rotationChecklist } from './docs';
import { changeReportMarkdown, diffInventories, snapshotBefore } from './history';
import { InventoryIndex, inventoryContext, scrub, searchInventory } from './inventory';

const run = promisify(execFile);
const MAX_OUT = 24_000;

const str = { type: 'string' as const };
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): Anthropic.Beta.BetaTool => ({
  name, description, eager_input_streaming: true, input_schema: { type: 'object', properties, required },
});

export const SOUL_TOOLS: Anthropic.Beta.BetaTool[] = [
  tool('search_inventory', 'Search every repo\'s inventory (tools, API keys by name, APIs called, hosting, domains, e-mail addresses, sign-in, jobs, defaults). Returns matching facts with file:line evidence.', { query: { ...str, description: 'Words to match, e.g. "resend", "SERVICE_ROLE", "noreply"' } }, ['query']),
  tool('project_inventory', 'The full inventory of one project (all its repos) or one repo, including environment variable names.', { name: { ...str, description: 'Project name (e.g. "PLExyz") or repo name (e.g. "plexyz-grid")' } }, ['name']),
  tool('list_files', 'List tracked files in a repo, optionally only paths containing some text.', { repo: str, contains: { ...str, description: 'Optional text the path must contain' } }, ['repo']),
  tool('search_code', 'Search a repo\'s tracked files for exact text (git grep). Returns file:line and the line, secrets hidden.', { repo: str, text: str }, ['repo', 'text']),
  tool('read_file', 'Read a text file from a repo (up to about 400 lines; .env files are refused; secret-looking values are hidden).', { repo: str, path: { ...str, description: 'Path inside the repo' }, from_line: { type: 'integer', description: 'Optional first line, 1-based' } }, ['repo', 'path']),
  tool('rescan_repo', 'Re-read one repo now and refresh its inventory, when files changed since the last scan.', { repo: str }, ['repo']),
  tool('continuity_check', 'Run the REKA continuity check (handover readiness, Green/Amber/Red per item) on a repo. Read-only.', { repo: str }, ['repo']),
  tool('change_report', 'What changed in keys, APIs, services, hosting, domains, addresses, sign-in and jobs over the last N days.', { days: { type: 'integer', description: 'Look back this many days (default 7)' } }, []),
  tool('access_register_draft', 'Draft an Access and Account Register for a project from its inventory.', { project: str }, ['project']),
  tool('rotation_checklist', 'Checklist of every repo, CI secret, host and file to update when one key is rotated.', { key: { ...str, description: 'Variable name, e.g. RESEND_API_KEY' } }, ['key']),
];

const clip = (s: string) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + `\n…[cut at ${MAX_OUT} characters]` : s);

function findRepo(index: InventoryIndex, name: string, scope: SoulScope | null): ProjectInventory | null {
  const n = String(name ?? '').toLowerCase().trim();
  const all = scopedInventory(index.get(), scope).projects;
  return all.find((p) => p.name.toLowerCase() === n) ?? all.find((p) => path.basename(p.path).toLowerCase() === n)
    ?? all.find((p) => p.project.toLowerCase() === n) ?? all.find((p) => p.name.toLowerCase().includes(n)) ?? null;
}
function inside(root: string, rel: string): string | null {
  const target = path.resolve(root, rel);
  const r = path.relative(root, target);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
  return target;
}

type Input = Record<string, unknown>;
const need = (input: Input, keys: string[]): string | null => {
  for (const k of keys) if (typeof input[k] !== 'string' || !(input[k] as string).trim()) return `missing "${k}"`;
  return null;
};

/** Runs one tool. Returns text for the tool_result, and a short label for the UI. */
export async function runTool(name: string, input: Input, index: InventoryIndex, continuityScript: string | null, scope: SoulScope | null = null): Promise<{ text: string; label: string; isError?: boolean }> {
  const inv = scopedInventory(index.get(), scope);
  const outside = (what: string) => ({ text: `${what} is outside ${scope?.name}. This soul only sees ${scope?.name}; ask the main REKA soul about other projects.`, label: `kept to ${scope?.name}`, isError: true });
  const bad = (msg: string, label = name) => ({ text: msg, label, isError: true });
  switch (name) {
    case 'search_inventory': {
      const e = need(input, ['query']); if (e) return bad(e);
      const hits = searchInventory(inv, input.query as string, 80);
      return { label: `searched the inventory for "${input.query}"`, text: hits.length ? hits.map((h) => `${h.project} · ${h.fact.label}: ${h.fact.value}${h.fact.evidence[0] ? ` (${h.fact.evidence.slice(0, 2).join(', ')})` : ''}`).join('\n') : 'No matches.' };
    }
    case 'project_inventory': {
      const e = need(input, ['name']); if (e) return bad(e);
      const nm = scope && !scope.repos.has((input.name as string).toLowerCase()) ? scope.name : (input.name as string);
      const ctx = inventoryContext(inv, [nm], 30_000);
      return { label: `opened the inventory of ${input.name}`, text: clip(ctx) };
    }
    case 'list_files': {
      const e = need(input, ['repo']); if (e) return bad(e);
      const r = findRepo(index, input.repo as string, scope); if (!r) return scope ? outside(`"${input.repo}"`) : bad(`No repo named "${input.repo}".`);
      try {
        const { stdout } = await run('git', ['-C', r.path, 'ls-files'], { maxBuffer: 32 * 1024 * 1024 });
        const want = typeof input.contains === 'string' ? (input.contains as string).toLowerCase() : '';
        const files = stdout.split('\n').filter((f) => f && (!want || f.toLowerCase().includes(want)));
        return { label: `listed files in ${r.name}${want ? ` matching "${want}"` : ''}`, text: clip(files.slice(0, 400).join('\n') + (files.length > 400 ? `\n…and ${files.length - 400} more` : '')) };
      } catch { return bad(`${r.name} is not a git repo.`); }
    }
    case 'search_code': {
      const e = need(input, ['repo', 'text']); if (e) return bad(e);
      const r = findRepo(index, input.repo as string, scope); if (!r) return scope ? outside(`"${input.repo}"`) : bad(`No repo named "${input.repo}".`);
      try {
        const { stdout } = await run('git', ['-C', r.path, 'grep', '-n', '-I', '-F', '--max-count=8', '-e', input.text as string, '--', '.', ':(exclude)*.env*', ':(exclude)*lock*'], { maxBuffer: 16 * 1024 * 1024 });
        const lines = stdout.split('\n').filter(Boolean).map((l) => { const m = /^([^:]+):(\d+):(.*)$/.exec(l); return m ? `${m[1]}:${m[2]}: ${scrub(m[3])}` : scrub(l); });
        return { label: `searched ${r.name} for "${input.text}"`, text: clip(lines.slice(0, 120).join('\n') + (lines.length > 120 ? `\n…and ${lines.length - 120} more` : '')) || 'No matches.' };
      } catch { return { label: `searched ${r.name} for "${input.text}"`, text: 'No matches.' }; }
    }
    case 'read_file': {
      const e = need(input, ['repo', 'path']); if (e) return bad(e);
      const r = findRepo(index, input.repo as string, scope); if (!r) return scope ? outside(`"${input.repo}"`) : bad(`No repo named "${input.repo}".`);
      const rel = input.path as string;
      if (/(^|[\\/])\.env(\.|$)/i.test(rel) && !/\.env\.(example|sample|template)$/i.test(rel)) return bad('Refused: .env files hold secrets and are never read. Use .env.example for names.', `refused ${rel}`);
      const target = inside(r.path, rel); if (!target) return bad('Path is outside the repo.', `refused ${rel}`);
      try {
        const st = await fs.stat(target);
        if (st.size > 2_000_000) return bad('File too large to read here; use search_code instead.');
        const lines = (await fs.readFile(target, 'utf8')).split(/\r?\n/);
        const from = Math.max(1, Number(input.from_line) || 1);
        const slice = lines.slice(from - 1, from - 1 + 400).map((l, i) => `${from + i}: ${scrub(l)}`);
        return { label: `read ${r.name}/${rel}`, text: clip(slice.join('\n') + (lines.length > from + 399 ? `\n…${lines.length} lines in all; ask again with from_line` : '')) };
      } catch { return bad(`Could not read ${rel}.`); }
    }
    case 'rescan_repo': {
      const e = need(input, ['repo']); if (e) return bad(e);
      if (scope && !findRepo(index, input.repo as string, scope)) return outside(`"${input.repo}"`);
      const r = await index.rescanOne(input.repo as string);
      return r ? { label: `rescanned ${r.name}`, text: `Rescanned ${r.name}: ${r.facts.length} facts from ${r.filesScanned} files.` } : bad(`No repo named "${input.repo}".`);
    }
    case 'continuity_check': {
      const e = need(input, ['repo']); if (e) return bad(e);
      const r = findRepo(index, input.repo as string, scope); if (!r) return scope ? outside(`"${input.repo}"`) : bad(`No repo named "${input.repo}".`);
      const inRepo = path.join(r.path, 'tools', 'reka-handover-kit', 'tools', 'continuity-check.js');
      const script = (await fs.access(inRepo).then(() => inRepo).catch(() => null)) ?? continuityScript;
      if (!script) return bad('No continuity check found: add the REKA Handover kit to the repo or set SOUL_CONTINUITY_CHECK.');
      try {
        const { stdout } = await run('node', [script, r.path], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
        return { label: `ran the continuity check on ${r.name}`, text: clip(stdout) };
      } catch (err) {
        const out = (err as { stdout?: string }).stdout; // exits 2 when Red: the report is still valid
        return out ? { label: `ran the continuity check on ${r.name}`, text: clip(out) } : bad(`The continuity check failed: ${(err as Error).message}`);
      }
    }
    case 'change_report': {
      const days = Math.max(1, Math.min(90, Number(input.days) || 7));
      const before = await snapshotBefore(days);
      return { label: `compared the inventory with ${days} days ago`, text: clip(changeReportMarkdown(diffInventories(before ? scopedInventory(before, scope) : null, inv))) };
    }
    case 'access_register_draft': {
      const e = need(input, ['project']); if (e) return bad(e);
      const md = accessRegisterDraft(inv, scope ? scope.name : (input.project as string));
      return md ? { label: `drafted the Access Register for ${input.project}`, text: clip(md) } : bad(`No project or repo named "${input.project}".`);
    }
    case 'rotation_checklist': {
      const e = need(input, ['key']); if (e) return bad(e);
      const md = rotationChecklist(inv, input.key as string);
      return md ? { label: `built the rotation checklist for ${input.key}`, text: clip(md) } : bad(`No repo uses a key named "${input.key}".`);
    }
    default:
      return bad(`Unknown tool ${name}.`);
  }
}
