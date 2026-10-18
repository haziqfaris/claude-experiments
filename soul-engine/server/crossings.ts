// Crossings: which chat writes, commits or pushes into which repo, and when that needs you. A push into a repo
// another chat is working in means that chat should pull before it goes on; two chats editing one repo at once can
// overwrite each other; a chat writing into another project's repo may be a mistake. All computed on this machine
// from transcripts and git; the only network use is a read-only `git fetch` for repos with open chats.
import { execFile } from 'node:child_process';
import type { ChatItem, Crossings, CrossingAlert, CrossingLink, CrossingRepo, Inventory, ProjectStatus } from '../src/types';
import type { GitOp } from './transcripts';

type Work = Map<string, { writes: { path: string; ts: number }[]; git: GitOp[] }>;

const HOURS = 24;
const TOGETHER_MS = 30 * 60_000;
const FETCH_EVERY_MS = 5 * 60_000;
const n = (p: string) => p.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/\/+$/, '').toLowerCase();

function git(cwd: string, args: string[], timeout = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout, maxBuffer: 256 * 1024, windowsHide: true }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

// ---- Behind the remote: a light fetch every few minutes for the copies chats work in ----
const remote = new Map<string, { behind: number | null; fetchedAt: number; branch: string | null }>();
let fetching = false;

async function refreshRemote(dirs: string[]) {
  if (fetching || process.env.SOUL_FETCH === 'off') return;
  fetching = true;
  try {
    for (const dir of dirs) {
      const cur = remote.get(n(dir));
      if (cur && Date.now() - cur.fetchedAt < FETCH_EVERY_MS) continue;
      // Read-only for your work: it updates what the hub knows about GitHub, never your files or branches.
      await git(dir, ['fetch', '--quiet', '--no-tags', '--no-recurse-submodules'], 20_000);
      const [behind, branch] = await Promise.all([git(dir, ['rev-list', '--count', 'HEAD..@{u}']), git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])]);
      remote.set(n(dir), { behind: behind == null || behind === '' ? null : Number(behind), fetchedAt: Date.now(), branch });
    }
  } finally { fetching = false; }
}

/** The repo (one inventory entry, copies and worktrees merged) a path is in, and which copy. */
function repoIndex(inv: Inventory) {
  const roots = inv.projects.flatMap((p) => [p.path, ...(p.alsoAt ?? [])].map((r) => ({ id: p.id, root: n(r), raw: r }))).sort((a, b) => b.root.length - a.root.length);
  return (p: string) => { const x = n(p); return roots.find((r) => x === r.root || x.startsWith(r.root + '/')) ?? null; };
}

const projectOfRepo = (inv: Inventory, id: string) => inv.groups.find((g) => g.repos.includes(id))?.name ?? inv.projects.find((p) => p.id === id)?.name ?? id;
const nameOf = (c: ChatItem) => c.name ?? c.title.slice(0, 60);

export function buildCrossings(chats: ChatItem[], work: Work, inv: Inventory | null, status: ProjectStatus[], now = Date.now()): Crossings {
  const since = now - HOURS * 3_600_000;
  const empty: Crossings = { generatedAt: now, repos: [], links: [], alerts: [], fetch: process.env.SOUL_FETCH === 'off' ? 'off' : 'on' };
  if (!inv) return empty;
  const where = repoIndex(inv);
  const byId = new Map(chats.map((c) => [c.id, c]));
  const links = new Map<string, CrossingLink>();
  // Which copy (folder) of each repo each chat works in: its own folder, or where it wrote.
  const copies = new Map<string, Set<string>>();
  // A chat started in a folder that is no repo (a parent folder) belongs to no project here, so nothing it changes is foreign.
  const homeProject = new Map(chats.map((c) => { const h = where(c.cwd); return [c.id, h ? projectOfRepo(inv, h.id) : null] as const; }));
  const touch = (chat: ChatItem, repo: string, root: string) => {
    const key = `${chat.id}|${repo}`;
    let l = links.get(key);
    if (!l) {
      l = { chat: chat.id, repo, edits: 0, files: [], commits: 0, pushes: 0, merges: 0, pulls: 0, lastAt: 0, lastPushAt: null, lastPullAt: null, lastOp: null, home: false, foreign: homeProject.get(chat.id) != null && homeProject.get(chat.id) !== projectOfRepo(inv, repo), copy: root };
      links.set(key, l);
    }
    const s = copies.get(key) ?? new Set<string>(); s.add(root); copies.set(key, s);
    return l;
  };

  for (const c of chats) {
    if (c.lastActivity < since) continue;
    const home = where(c.cwd);
    if (home) { const l = touch(c, home.id, home.root); l.home = true; l.foreign = false; l.lastAt = Math.max(l.lastAt, c.lastActivity); }
    const w = work.get(c.id);
    if (!w) continue;
    for (const f of w.writes) {
      const r = where(f.path); if (!r) continue;
      const l = touch(c, r.id, r.root);
      l.edits++; l.lastAt = Math.max(l.lastAt, f.ts);
      const rel = n(f.path).slice(r.root.length + 1);
      if (!l.files.includes(rel) && l.files.length < 40) l.files.push(rel);
    }
    for (const g of w.git) {
      if (g.failed) continue;
      const r = where(g.dir); if (!r) continue;
      const l = touch(c, r.id, r.root);
      if (g.op === 'commit') l.commits++;
      if (g.op === 'push') { l.pushes++; l.lastPushAt = Math.max(l.lastPushAt ?? 0, g.ts); }
      if (g.op === 'merge') { l.merges++; l.lastPushAt = Math.max(l.lastPushAt ?? 0, g.ts); }
      if (g.op === 'pull') l.lastPullAt = Math.max(l.lastPullAt ?? 0, g.ts);
      l.lastAt = Math.max(l.lastAt, g.ts);
      if (!l.lastOp || g.ts >= l.lastOp.at) l.lastOp = { op: g.op, at: g.ts, detail: g.detail, copy: r.root };
    }
  }

  // ---- Repos that show up, with what git says about them ----
  const statusRepo = new Map(status.flatMap((s) => s.repos.map((r) => [n(r.path), r] as const)));
  const repos = new Map<string, CrossingRepo>();
  for (const l of links.values()) {
    if (repos.has(l.repo)) continue;
    const p = inv.projects.find((x) => x.id === l.repo)!;
    const sr = statusRepo.get(n(p.path));
    const rm = remote.get(n(p.path));
    repos.set(l.repo, {
      id: l.repo, name: p.name, project: projectOfRepo(inv, l.repo), path: p.path, branch: rm?.branch ?? sr?.branch ?? p.branch,
      dirty: sr?.dirty ?? 0, ahead: sr?.ahead ?? null, behind: rm?.behind ?? null, fetchedAt: rm?.fetchedAt ?? null,
      chats: 0, writers: 0, hot: false, lastCommitAt: sr?.recentCommits?.[0]?.date ?? sr?.lastCommit?.date ?? null,
    });
  }
  const linkList = [...links.values()].filter((l) => l.home ? (byId.get(l.chat)!.lastActivity >= since) : true);
  for (const r of repos.values()) {
    const ls = linkList.filter((l) => l.repo === r.id);
    r.chats = new Set(ls.map((l) => l.chat)).size;
    r.writers = new Set(ls.filter((l) => l.edits || l.commits || l.pushes || l.merges).map((l) => l.chat)).size;
  }

  // ---- What needs you ----
  const alerts: CrossingAlert[] = [];
  const openish = (c: ChatItem) => c.state !== 'idle' || now - c.lastActivity < 6 * 3_600_000;
  for (const r of repos.values()) {
    const ls = linkList.filter((l) => l.repo === r.id);
    // 1. A chat pushed or merged (or committed in the very folder another chat works in): the others should pull.
    for (const a of ls) {
      const ca = byId.get(a.chat)!;
      const events = (work.get(a.chat)?.git ?? []).filter((g) => !g.failed && (g.op === 'push' || g.op === 'merge' || g.op === 'commit') && where(g.dir)?.id === r.id);
      for (const b of ls) {
        if (b.chat === a.chat) continue;
        const cb = byId.get(b.chat)!;
        if (!openish(cb)) continue;
        const bCopies = copies.get(`${b.chat}|${r.id}`) ?? new Set<string>();
        const hits = events.filter((g) => g.op !== 'commit' || bCopies.has(where(g.dir)!.root));
        // B is caught up once it pulled after the latest of them, or wrote nothing and started after it.
        const latest = hits.reduce((m, g) => Math.max(m, g.ts), 0);
        if (!latest || (b.lastPullAt ?? 0) > latest) continue;
        if (!b.edits && !b.commits && !b.home) continue;
        const pushes = hits.filter((g) => g.op !== 'commit');
        const sameFolder = hits.some((g) => g.op === 'commit' && bCopies.has(where(g.dir)!.root));
        const what = pushes.length
          ? `${pushes.length === 1 ? (pushes[0].op === 'merge' ? 'merged a PR into' : 'pushed to') : `pushed ${pushes.length} times to`} ${r.name}${pushes.find((g) => g.op === 'push' && g.detail)?.detail ? ` (${pushes.find((g) => g.op === 'push' && g.detail)!.detail})` : ''}`
          : `committed ${hits.length === 1 ? `“${hits[0].detail || 'a change'}”` : `${hits.length} times`} in the same ${r.name} folder`;
        alerts.push({
          id: `under:${a.chat}:${b.chat}:${r.id}:${latest}`, at: latest, kind: 'pushed-under', level: 'attend', repo: r.id, from: a.chat, to: b.chat,
          title: `${nameOf(ca)} ${what}`,
          text: sameFolder && !pushes.length
            ? `${nameOf(cb)} works in that folder too: the files under it changed. It should re-read them before editing again.`
            : `${nameOf(cb)} also works in ${r.name}${r.behind ? ` and is ${r.behind} commit${r.behind === 1 ? '' : 's'} behind GitHub` : ''}. It should pull or rebase before it goes on.`,
          fix: `Heads-up from the Soul Engine: another chat (“${nameOf(ca)}”) just ${pushes.length ? 'pushed to' : 'committed in'} ${r.name}${pushes.length ? '' : ' in this same folder'}. Before you go on: check git status, ${pushes.length ? 'fetch and pull (or rebase) the latest' : 're-read the files you were changing'}, resolve any conflicts with your own changes, then tell me what changed and carry on.`,
        });
      }
    }
    // 2. Two chats editing the same repo at the same time.
    const editing = ls.filter((l) => l.edits > 0 && now - l.lastAt < 2 * 3_600_000);
    for (let i = 0; i < editing.length; i++) for (let j = i + 1; j < editing.length; j++) {
      const a = editing[i], b = editing[j];
      if (Math.abs(a.lastAt - b.lastAt) > TOGETHER_MS) continue;
      const same = a.files.filter((f) => b.files.includes(f));
      const sameCopy = [...(copies.get(`${a.chat}|${r.id}`) ?? [])].some((x) => copies.get(`${b.chat}|${r.id}`)?.has(x));
      if (!same.length && !sameCopy) continue;
      const [ca, cb] = [byId.get(a.chat)!, byId.get(b.chat)!];
      alerts.push({
        id: `together:${[a.chat, b.chat].sort().join(':')}:${r.id}:${Math.floor(Math.max(a.lastAt, b.lastAt) / TOGETHER_MS)}`,
        at: Math.max(a.lastAt, b.lastAt), kind: 'same-time', level: same.length ? 'attend' : 'note', repo: r.id, from: a.chat, to: b.chat,
        title: `${nameOf(ca)} and ${nameOf(cb)} are both editing ${r.name}`,
        text: same.length ? `Both changed ${same.slice(0, 3).join(', ')}${same.length > 3 ? ` and ${same.length - 3} more` : ''}: one may overwrite the other.` : 'In the same folder, within half an hour: keep them on separate files or give one a worktree.',
        fix: `Heads-up from the Soul Engine: another chat (“${nameOf(ca)}”) is editing ${r.name} at the same time as you${same.length ? `, including ${same.slice(0, 3).join(', ')}` : ''}. Check git status and diff before your next edit, and don't overwrite its changes. Tell me if you two are about to clash.`,
      });
    }
    // 3. A chat working in another project's repo.
    for (const l of ls.filter((x) => x.foreign && (x.edits || x.commits || x.pushes || x.merges))) {
      const c = byId.get(l.chat)!;
      alerts.push({
        id: `foreign:${l.chat}:${r.id}`, at: l.lastAt, kind: 'foreign', level: 'note', repo: r.id, from: l.chat, to: null,
        title: `${nameOf(c)} (${c.project}) changed ${r.name}`,
        text: `${r.name} belongs to ${r.project}. ${l.edits} file edit${l.edits === 1 ? '' : 's'}${l.commits ? `, ${l.commits} commit${l.commits === 1 ? '' : 's'}` : ''}${l.pushes ? `, ${l.pushes} push${l.pushes === 1 ? '' : 'es'}` : ''}. Fine if you meant it.`,
        fix: null,
      });
    }
    // 4. Behind GitHub (someone pushed from elsewhere) while a chat works here.
    if (r.behind && r.behind > 0) {
      const here = ls.filter((l) => l.home && openish(byId.get(l.chat)!));
      for (const l of here) {
        if (alerts.some((x) => x.kind === 'pushed-under' && x.to === l.chat && x.repo === r.id)) continue;
        const c = byId.get(l.chat)!;
        alerts.push({
          id: `behind:${l.chat}:${r.id}:${r.behind}`, at: r.fetchedAt ?? now, kind: 'behind', level: 'attend', repo: r.id, from: null, to: l.chat,
          title: `${r.name} is ${r.behind} commit${r.behind === 1 ? '' : 's'} behind GitHub`,
          text: `${nameOf(c)} works on an old copy${r.branch ? ` of ${r.branch}` : ''}. Pull before going on.`,
          fix: `Heads-up from the Soul Engine: ${r.name} is ${r.behind} commit${r.behind === 1 ? '' : 's'} behind GitHub${r.branch ? ` on ${r.branch}` : ''}. Before you go on: check git status, pull (or rebase) the latest, resolve any conflicts, then carry on.`,
        });
      }
    }
  }
  for (const r of repos.values()) r.hot = alerts.some((a) => a.repo === r.id && a.level === 'attend') || r.writers > 1;

  // Fetch in the background for the copies open chats work in; the next call sees the result.
  const dirs = [...new Set(linkList.filter((l) => l.home && openish(byId.get(l.chat)!)).map((l) => inv.projects.find((p) => p.id === l.repo)!.path))];
  void refreshRemote(dirs.slice(0, 12));

  return { ...empty, repos: [...repos.values()], links: linkList.sort((a, b) => b.lastAt - a.lastAt), alerts: alerts.sort((a, b) => b.at - a.at).slice(0, 40) };
}
