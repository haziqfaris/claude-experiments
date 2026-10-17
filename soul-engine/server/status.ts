// Project status: where each project is in the REKA Build Flow (steps 01 to 09), how many tasks and phases are
// left, whether it is live, and what was last published. Read from the repos on this machine; live checks are
// one GET per deployed address. Steps 01 to 03 happen before a repo exists, so they are only known when set.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Inventory, LiveCheck, PhaseProgress, ProjectInventory, ProjectStatus, Readiness, ReadinessLevel, Roadmap } from '../src/types';
import { readRoadmap, saveRoadmaps } from './roadmap';

const run = promisify(execFile);
const PROJECTS_FILE = process.env.SOUL_PROJECTS_FILE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../projects.local.json');

export const STEPS: Record<string, { name: string; gate: string | null }> = {
  '01': { name: 'Spot', gate: null },
  '02': { name: 'Shape', gate: 'GO' },
  '03': { name: 'Agree', gate: 'GC' },
  '04': { name: 'Pin down', gate: 'GR, GB' },
  '05': { name: 'Prove', gate: 'GD' },
  '06': { name: 'Translate', gate: null },
  '07': { name: 'Build', gate: 'GA, GP' },
  '08': { name: 'Deliver', gate: 'GU, GL, GH' },
  '09': { name: 'Grow', gate: 'GX' },
};

async function git(dir: string, args: string[]): Promise<string> {
  try {
    return (await run('git', ['-C', dir, ...args], { maxBuffer: 32 * 1024 * 1024, timeout: 20_000 })).stdout.trim();
  } catch {
    return '';
  }
}

interface Override { stage?: string; live?: string[]; note?: string; readiness?: string; roadmap?: string }
async function overrides(): Promise<Record<string, Override>> {
  try {
    const raw = JSON.parse(await fs.readFile(PROJECTS_FILE, 'utf8')) as { projects?: Record<string, { status?: Override }> };
    return Object.fromEntries(Object.entries(raw.projects ?? {}).filter(([, g]) => g.status).map(([n, g]) => [n, g.status!]));
  } catch {
    return {};
  }
}

const TASK_FILE = /(^|\/)(PROGRESS|ROADMAP|TODO|TASKS|BACKLOG|BUILD[-_ ]?PLAN|IMPLEMENTATION[-_ ]?PLAN)[^/]*\.md$|(^|\/)[^/]*[-_ ](PLAN|TASKS|BACKLOG)[^/]*\.md$|^docs\/plan\/[^/]+\.md$/i;
const SKIP_FILE = /(^|\/)(node_modules|templates?|kits?|vendor|examples?|\.github)\//i;
const PHASE = /^#{1,4}\s*(?:\d+[.)]\s*)?((?:phase|stage|milestone|sprint|batch|step)\b[^\n]*)$/i;
const BOX = /^\s*(?:[-*+]|\d+[.)])\s+\[( |x|X)\]/;

interface RepoFacts {
  repo: ProjectInventory;
  files: string[];
  commits: number;
  commits30d: number;
  last: { date: number; subject: string } | null;
  tag: { tag: string; date: number } | null;
  dirty: number;
  ahead: number | null;
  done: number;
  total: number;
  taskFiles: string[];
  phases: PhaseProgress[];
}

async function readRepo(repo: ProjectInventory): Promise<RepoFacts> {
  const dir = repo.path;
  const [ls, commits, commits30d, last, tag, porcelain, ahead] = await Promise.all([
    git(dir, ['ls-files']),
    git(dir, ['rev-list', '--count', 'HEAD']),
    git(dir, ['rev-list', '--count', '--since=30.days', 'HEAD']),
    git(dir, ['log', '-1', '--format=%ct%x09%s']),
    git(dir, ['describe', '--tags', '--abbrev=0']),
    git(dir, ['status', '--porcelain']),
    git(dir, ['rev-list', '--count', '@{u}..HEAD']),
  ]);
  const files = ls ? ls.split('\n') : [];
  const tagDate = tag ? Number(await git(dir, ['log', '-1', '--format=%ct', tag])) * 1000 : 0;
  const [lt, ...ls2] = last.split('\t');
  const out: RepoFacts = {
    repo, files,
    commits: Number(commits) || 0,
    commits30d: Number(commits30d) || 0,
    last: last ? { date: Number(lt) * 1000, subject: ls2.join('\t').slice(0, 120) } : null,
    tag: tag ? { tag, date: tagDate } : null,
    dirty: porcelain ? porcelain.split('\n').length : 0,
    ahead: ahead === '' ? null : Number(ahead),
    done: 0, total: 0, taskFiles: [], phases: [],
  };
  // Tasks and phases: checkboxes under Phase/Stage/Milestone headings in progress and plan files.
  for (const f of files.filter((x) => TASK_FILE.test(x) && !SKIP_FILE.test(x)).slice(0, 12)) {
    let text = '';
    try {
      const st = await fs.stat(path.join(dir, f));
      if (st.size > 1_000_000) continue;
      text = await fs.readFile(path.join(dir, f), 'utf8');
    } catch { continue; }
    let phase: PhaseProgress | null = null;
    let any = false;
    for (const line of text.split(/\r?\n/)) {
      const h = PHASE.exec(line);
      if (h) { phase = { name: h[1].replace(/[*_`]/g, '').trim().slice(0, 80), done: 0, total: 0, file: f }; out.phases.push(phase); continue; }
      const b = BOX.exec(line);
      if (!b) continue;
      any = true;
      const checked = b[1] !== ' ';
      out.total += 1;
      if (checked) out.done += 1;
      if (phase) { phase.total += 1; if (checked) phase.done += 1; }
    }
    if (any) out.taskFiles.push(f);
  }
  out.phases = out.phases.filter((p) => p.total > 0);
  return out;
}

/** Build Flow step from the documents and history in a repo (the Document Map homes in docs/). */
function estimate(r: RepoFacts, live: boolean): { step: string; evidence: string[] } | null {
  const has = (re: RegExp) => r.files.some((f) => re.test(f) && !SKIP_FILE.test(f));
  const ev: string[] = [];
  const spec = has(/^docs\/spec\/|(^|\/)(FRS|PRD)[^/]*\.md$/i);
  const plan = has(/^docs\/plan\/|(^|\/)BUILD[-_ ]?PLAN[^/]*\.md$/i);
  const workspace = has(/^(AGENTS|CLAUDE|PROGRESS)\.md$/i);
  const qa = has(/^docs\/qa\//i);
  const readiness = has(/^docs\/readiness\//i);
  const delivery = has(/^docs\/delivery\//i);
  if (spec) ev.push('spec (S4/S5)');
  if (plan) ev.push('build plan (S6)');
  if (qa) ev.push('test pack (S8)');
  if (readiness) ev.push('release pack (S9)');
  if (delivery) ev.push('delivery pack (S10)');
  if (r.tag) ev.push(`release tag ${r.tag.tag}`);
  if (live) ev.push('live address answers');
  ev.push(`${r.commits} commits`);
  const open = r.total - r.done;
  if (delivery && live) return { step: '09', evidence: ev };
  if (readiness || qa || (r.tag && r.total > 0 && open === 0)) return { step: '08', evidence: ev };
  if (r.commits >= 30 || r.done > 0 || r.tag) return { step: '07', evidence: ev };
  if (spec || plan) return { step: r.commits >= 5 ? '05' : '04', evidence: ev };
  if (workspace || r.commits > 0) return { step: '04', evidence: ev };
  return null;
}

// ---- Readiness: your own verdicts first, then the stage, capped by what the live check saw ----

const LEVELS: ReadinessLevel[] = ['not live', 'up, not the app', 'preview', 'internal testing', 'pilot / UAT', 'ready to use', 'in use'];
const READINESS_FILE = /(^|\/)(readiness|docs\/readiness)\/.*\.md$|(^|\/)[^/]*(readiness|go[-_ ]?live|release[-_ ]?decision|launch[-_ ]?decision)[^/]*\.md$/i;

/** The newest readiness verdict written in a repo ("Decision: Hold", "Ready for a supervised pilot"). */
async function verdictOf(r: RepoFacts): Promise<Readiness['verdict']> {
  const cands = r.files.filter((f) => READINESS_FILE.test(f) && !SKIP_FILE.test(f) && !/template/i.test(f)).slice(0, 12);
  const dated = await Promise.all(cands.map(async (f) => ({ f, ts: Number(await git(r.repo.path, ['log', '-1', '--format=%ct', '--', f])) * 1000 })));
  for (const { f, ts } of dated.sort((a, b) => b.ts - a.ts).slice(0, 5)) {
    let text = '';
    try { text = await fs.readFile(path.join(r.repo.path, f), 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/).slice(0, 200);
    let hit: string | null = null;
    for (let i = 0; i < lines.length && !hit; i++) {
      const l = lines[i];
      if (/^\**\s*(decision|verdict|readiness verdict|overall|ready for)\s*:?\**\s*:/i.test(l) || /^\**(decision|verdict)\**\s*[:—-]/i.test(l)) hit = l;
      else if (/^#{1,4}\s*(verdict|decision|readiness verdict)\b/i.test(l)) hit = lines.slice(i + 1).find((x) => x.trim()) ?? null;
    }
    if (hit && /ready|hold|\bgo\b|no-go|pilot|beta|approved|conditional|launch|production|blocked/i.test(hit)) return { text: hit.replace(/[*_`#|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200), file: `${r.repo.name}/${f}`, date: ts || null };
  }
  return null;
}

function verdictLevel(text: string): ReadinessLevel {
  const t = text.toLowerCase();
  if (/not ready|\bhold\b|no-?go|blocked|internal (development|use|testing) only/.test(t)) return 'internal testing';
  if (/pilot|beta|uat|supervised|limited|conditional/.test(t)) return 'pilot / UAT';
  if (/in production|operating|in use|live with/.test(t)) return 'in use';
  if (/ready for (production|release|launch|go-?live|use)|\bgo\b|approved/.test(t)) return 'ready to use';
  return 'internal testing';
}

function readinessOf(stage: string | null, verdict: Readiness['verdict'], live: LiveCheck[], set?: string): Readiness {
  const lvl = (l: ReadinessLevel) => ({ level: l, rank: LEVELS.indexOf(l) });
  if (set) {
    const m = LEVELS.find((l) => l.startsWith(set.toLowerCase().replace(/^uat$|^pilot$/, 'pilot / uat')));
    if (m) return { ...lvl(m), source: 'set', why: 'set in projects.local.json', verdict, wouldBe: null };
  }
  const fromStage: ReadinessLevel = stage === '09' ? 'in use' : stage === '08' ? 'pilot / UAT' : stage === '07' ? 'internal testing' : 'preview';
  const want = verdict ? verdictLevel(verdict.text) : fromStage;
  const prod = live.filter((l) => !l.staging);
  const real = prod.filter((l) => l.ok && (l.page.kind === 'app' || l.page.kind === 'sign-in'));
  const why = verdict ? `verdict in ${verdict.file}` : stage ? `Build Flow stage ${stage}` : 'no stage found';
  if (!live.length) return { ...lvl(want), source: verdict ? 'verdict' : 'stage', why: `${why}; no deployed address found`, verdict, wouldBe: null };
  if (!real.length) {
    const up = prod.some((l) => l.ok) || live.some((l) => l.ok);
    const stagingOnly = !prod.length && live.some((l) => l.ok && l.page.kind !== 'placeholder');
    const l: ReadinessLevel = stagingOnly ? 'preview' : up ? 'up, not the app' : 'not live';
    return { ...lvl(l), source: 'live check', why: stagingOnly ? 'only a staging address answers' : up ? 'the address answers with a placeholder or error page' : 'no address answers', verdict, wouldBe: want };
  }
  return { ...lvl(want), source: verdict ? 'verdict' : 'stage', why, verdict, wouldBe: null };
}

// ---- Live checks: one GET per deployed address, cached for ten minutes ----

const liveCache = new Map<string, LiveCheck>();
const LIVE_TTL = 10 * 60_000;

function addresses(repos: ProjectInventory[]): { url: string; source: string }[] {
  const out = new Map<string, string>();
  for (const r of repos) for (const f of r.facts) {
    const v = f.value.trim();
    if (f.category === 'hosting' && f.label === 'Cloudflare route') {
      const route = v.replace(/\*+$/, '').replace(/\/$/, '');
      if (!route.includes('*') && !/\/_/.test(route)) out.set(route, 'Cloudflare route');
    } else if (f.category === 'domain' && (f.label === 'Custom domain' || f.label === 'Platform address') && !v.includes('*') && !/x{3,}|example|your-|my-app|<|\{/i.test(v)) {
      out.set(v, f.label === 'Custom domain' ? 'custom domain' : 'platform address');
    } else if (f.category === 'hosting' && f.label === 'Fly.io app' && /^[a-z0-9-]+$/i.test(v)) {
      out.set(`${v}.fly.dev`, 'Fly.io app');
    }
  }
  return [...out].map(([url, source]) => ({ url, source }));
}

const PLACEHOLDER = /coming soon|under construction|parked|domain (is )?for sale|default (web )?page|welcome to nginx|it works!|hello,? world|vite \+ react|create next app|there isn'?t a github pages site|deployment(_| )not(_| )found|this page could not be found|no such app|application not found|worker threw exception|error 10\d\d|page not found/i;

/** What the page is: the real app, a sign-in gate, a placeholder or an error page. */
function pageKind(status: number | null, html: string): LiveCheck['page'] {
  const title = /<title[^>]*>([^<]{0,140})<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() || null;
  if (status == null) return { kind: 'none', title: null };
  if (status === 401 || status === 403) return { kind: 'sign-in', title };
  if (status >= 400) return { kind: 'error', title };
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  if (PLACEHOLDER.test(title ?? '') || (PLACEHOLDER.test(text) && text.replace(/<[^>]+>/g, ' ').trim().length < 3000)) return { kind: 'placeholder', title };
  if (/type=["']?password|sign ?in|log ?in/i.test(title ?? '') || (/type=["']?password/i.test(html) && html.length < 60_000)) return { kind: 'sign-in', title };
  return { kind: html || status < 300 ? 'app' : 'none', title };
}

async function check(url: string, source: string): Promise<LiveCheck> {
  const hit = liveCache.get(url);
  if (hit && Date.now() - hit.checkedAt < LIVE_TTL) return { ...hit, source };
  const started = Date.now();
  let status: number | null = null;
  let body = '';
  try {
    const res = await fetch(url.startsWith('http') ? url : `https://${url}`, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(7000), headers: { 'user-agent': 'REKA-Soul-Engine status check' } });
    status = res.status;
    if (/text\/html/i.test(res.headers.get('content-type') ?? '')) body = (await res.text()).slice(0, 200_000);
    else await res.body?.cancel();
  } catch { /* unreachable */ }
  // Up means it answered: 2xx/3xx, or 401/403 behind a sign-in.
  const c: LiveCheck = {
    url, source, staging: /staging|preview|dev\./i.test(url), status,
    ok: status != null && (status < 400 || status === 401 || status === 403),
    ms: status != null ? Date.now() - started : null, checkedAt: Date.now(),
    page: pageKind(status, body),
  };
  liveCache.set(url, c);
  return c;
}

async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]); } }));
  return out;
}

function nextStep(s: Omit<ProjectStatus, 'next'>): string {
  // Deploy config (routes, custom domains, set by you) counts; platform addresses found in docs only if nothing answers.
  const prod = s.live.filter((l) => !l.staging);
  const down = prod.filter((l) => !l.ok && (l.source !== 'platform address' || !prod.some((x) => x.ok)));
  if (down.length) return `Check ${down[0].url}: it did not answer${down[0].status ? ` (${down[0].status})` : ''}.`;
  const open = s.tasks.total - s.tasks.done;
  // The project's own roadmap leads: the first open section and what is left in it.
  const sec = s.roadmap?.kind !== 'roadmap' ? undefined : s.roadmap.sections.find((x) => x.state !== 'done' && x.items.some((i) => i.state !== 'done'));
  if (sec) {
    const open = sec.items.filter((i) => i.state !== 'done');
    const blocked = open.filter((i) => i.state === 'blocked').length;
    const first = open.find((i) => i.state !== 'blocked')?.title ?? open[0].title;
    return `${sec.title.slice(0, 60)}: ${open.length} item${open.length === 1 ? '' : 's'} left${blocked ? `, ${blocked} blocked` : ''} (next: ${first.length > 90 ? `${first.slice(0, 89)}…` : first}).`;
  }
  const phase = s.phases.find((p) => p.done < p.total);
  if (phase) return `${phase.total - phase.done} task${phase.total - phase.done === 1 ? '' : 's'} left in ${phase.name}.`;
  if (open > 0) return `${open} task${open === 1 ? '' : 's'} left.`;
  if (!s.stage) return 'No repo evidence yet. Set a stage in projects.local.json, or add a build plan with tasks.';
  if (s.stage.step === '07') return 'No open tasks found. Add the build plan (docs/plan) with checkboxes, or move to the phase-end sweep (gate GP).';
  if (s.stage.step === '08') return 'Finish the release pack (S9) and Delivery Pack (S10) for gates GL and GH.';
  if (s.stage.step === '09') return 'Operating. Keep the Access Register (S13) and support playbook current.';
  return `Next gate: ${s.stage.nextGate ?? 'none'}.`;
}

let cache: { at: number; scan: number; data: ProjectStatus[] } | null = null;
let inflight: Promise<ProjectStatus[]> | null = null;

export function projectStatus(inv: Inventory, force = false): Promise<ProjectStatus[]> {
  // Until the first inventory scan finishes there is nothing to report, and nothing is cached.
  if (!inv.scannedAt || !inv.groups.length) return Promise.resolve([]);
  // A new scan invalidates the cache; otherwise it holds for five minutes.
  if (!force && cache && cache.scan === inv.scannedAt && Date.now() - cache.at < 5 * 60_000) return Promise.resolve(cache.data);
  if (inflight) return inflight;
  inflight = (async () => {
    const ov = await overrides();
    const byId = new Map(inv.projects.map((p) => [p.id, p]));
    const groups = inv.groups.filter((g) => g.repos.length || ov[g.name]);
    const data = await pool(groups, 4, async (g): Promise<ProjectStatus> => {
      const repos = g.repos.map((id) => byId.get(id)).filter((r): r is ProjectInventory => !!r);
      const facts = await Promise.all(repos.map(readRepo));
      const o = ov[g.name] ?? {};
      const addrs = [...addresses(repos), ...(o.live ?? []).map((url) => ({ url, source: 'set by you' }))].slice(0, 8);
      const live = await pool(addrs, 4, (a) => check(a.url, a.source));
      const anyLive = live.some((l) => l.ok && !l.staging && l.page.kind !== 'placeholder');
      const verdicts = (await Promise.all(facts.map(verdictOf))).filter((v): v is NonNullable<typeof v> => !!v).sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
      // The roadmap: the one you pinned ("repo/path.md"), else a repo's ROADMAP, else a build plan.
      const [pinRepo, ...pinPath] = (o.roadmap ?? '').split('/');
      const order = [...facts].sort((a, b) => Number(b.repo.name === pinRepo) - Number(a.repo.name === pinRepo));
      let roadmap: Roadmap | null = null;
      for (const f of order) {
        const rm = await readRoadmap(f.repo.name, f.repo.path, f.files, f.repo.name === pinRepo ? pinPath.join('/') : null);
        if (rm && (!roadmap || (roadmap.kind === 'plan' && rm.kind === 'roadmap'))) roadmap = rm;
        if (roadmap?.kind === 'roadmap') break;
      }
      const est = facts.map((f) => ({ f, e: estimate(f, anyLive) })).filter((x) => x.e).sort((a, b) => Number(b.e!.step) - Number(a.e!.step))[0];
      const step = o.stage && STEPS[o.stage.padStart(2, '0')] ? o.stage.padStart(2, '0') : est?.e?.step ?? null;
      const tags = facts.filter((f) => f.tag).sort((a, b) => b.tag!.date - a.tag!.date);
      const lasts = facts.filter((f) => f.last).sort((a, b) => b.last!.date - a.last!.date);
      const base: Omit<ProjectStatus, 'next'> = {
        name: g.name, kind: g.kind,
        stage: step ? { step, name: STEPS[step].name, nextGate: STEPS[step].gate, source: o.stage ? 'set' : 'estimated', evidence: o.stage ? ['set in projects.local.json'] : est?.e?.evidence ?? [] } : null,
        tasks: { done: facts.reduce((n, f) => n + f.done, 0), total: facts.reduce((n, f) => n + f.total, 0), files: facts.flatMap((f) => f.taskFiles.map((x) => `${f.repo.name}/${x}`)) },
        phases: facts.flatMap((f) => f.phases.map((p) => ({ ...p, file: `${f.repo.name}/${p.file}` }))).slice(0, 30),
        live,
        published: tags[0] ? { tag: tags[0].tag!.tag, date: tags[0].tag!.date, repo: tags[0].repo.name } : null,
        lastCommit: lasts[0] ? { ...lasts[0].last!, repo: lasts[0].repo.name } : null,
        commits30d: facts.reduce((n, f) => n + f.commits30d, 0),
        repos: facts.map((f) => ({
          name: f.repo.name, path: f.repo.path, url: f.repo.repo, branch: f.repo.branch, dirty: f.dirty, ahead: f.ahead,
          step: estimate(f, anyLive)?.step ?? null, commits: f.commits, commits30d: f.commits30d,
          lastCommit: f.last, tag: f.tag, tasks: { done: f.done, total: f.total },
        })),
        note: o.note ?? null,
        readiness: readinessOf(o.stage ? o.stage.padStart(2, '0') : est?.e?.step ?? null, verdicts[0] ?? null, live, o.readiness),
        roadmap,
      };
      return { ...base, next: nextStep(base) };
    });
    cache = { at: Date.now(), scan: inv.scannedAt, data };
    void saveRoadmaps(data.map((d) => ({ project: d.name, roadmap: d.roadmap }))).catch(() => {});
    return data;
  })().finally(() => { inflight = null; });
  return inflight;
}

export function statusMarkdown(list: ProjectStatus[]): string {
  const lines = ['Project status (stage in the REKA Build Flow, estimated from the repos unless set):', ''];
  for (const s of list) {
    const live = s.live.filter((l) => !l.staging);
    lines.push(
      `- ${s.name}: ${s.stage ? `${s.stage.step} ${s.stage.name}${s.stage.source === 'set' ? ' (set)' : ''}` : 'stage unknown'}` +
      ` · tasks ${s.tasks.done}/${s.tasks.total}` +
      (s.phases.length ? ` · phases ${s.phases.filter((p) => p.done === p.total).length}/${s.phases.length} done` : '') +
      ` · ${live.length ? (live.some((l) => l.ok) ? `live (${live.filter((l) => l.ok).map((l) => l.url).slice(0, 2).join(', ')})` : 'not answering') : 'no live address found'}` +
      (s.published ? ` · published ${s.published.tag}` : '') +
      ` · readiness: ${s.readiness.level}${s.readiness.verdict ? ` ("${s.readiness.verdict.text.slice(0, 80)}")` : ''}` +
      (s.roadmap ? ` · roadmap ${s.roadmap.repo}/${s.roadmap.file}: ${s.roadmap.counts.done} done, ${s.roadmap.counts.inProgress + s.roadmap.counts.planned + s.roadmap.counts.blocked} left` : ' · no roadmap') +
      ` · next: ${s.next}`,
    );
  }
  return lines.join('\n');
}
