// Projects as the dashboard sees them: inventory groups (projects.local.json) joined with live
// Claude Code activity. A folder Claude worked in that belongs to no project shows as its own.
import type { ActivityStatus, Inventory, ProjectInventory, ProjectSnapshot, SessionSummary, Snapshot } from './types';

export interface DashProject {
  /** The scope sent to the hub: the project name. */
  name: string;
  kind: string;
  repos: ProjectInventory[];
  missing: { name: string; url: string | null }[];
  activity: ProjectSnapshot[];
  sessions: SessionSummary[];
  status: ActivityStatus;
  lastActivity: number;
  liveSessions: number;
  sessionCount: number;
  tokensToday: number;
  costToday: number | null;
  costTotal: number | null;
  lastPrompt: string | null;
  counts: { keys: number; apis: number; hosting: number; emails: number; services: number };
}

const PALETTE = ['#ff6ad5', '#ffb347', '#7cff6b', '#6ba8ff', '#c792ff', '#ff6b6b', '#4dffe1', '#ffe14d', '#ff9f6b', '#9dff4d', '#ff4d9d', '#6bffb8'];
export const MAIN_HUE = '#00f2ff';

/** Stable number from a name, so a project always gets the same soul. */
export function seedOf(name: string): number {
  let h = 2166136261;
  for (const ch of name) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) || 1;
}
export function hueOf(name: string): string {
  return PALETTE[seedOf(name) % PALETTE.length];
}

const KIND_ORDER = ['product', 'platform', 'client', 'internal', 'web', 'other', 'activity'];
export const KIND_LABEL: Record<string, string> = { product: 'Products', platform: 'Platform', client: 'Client work', internal: 'Internal', web: 'Websites', other: 'Other repos', activity: 'Other activity' };

const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
const statusRank: Record<ActivityStatus, number> = { active: 2, recent: 1, idle: 0 };

export function buildProjects(snapshot: Snapshot | null, inventory: Inventory | null): DashProject[] {
  const snaps = snapshot?.projects ?? [];
  const used = new Set<string>();
  const out: DashProject[] = [];
  const make = (name: string, kind: string, repos: ProjectInventory[], missing: DashProject['missing'], activity: ProjectSnapshot[]): DashProject => {
    const sessions = activity.flatMap((a) => a.sessions).sort((a, b) => b.lastActivity - a.lastActivity);
    const sum = (f: (p: ProjectSnapshot) => number | null) => activity.reduce<number | null>((n, p) => (n == null || f(p) == null ? null : n + (f(p) as number)), 0);
    const facts = repos.flatMap((r) => r.facts);
    const latest = [...activity].sort((a, b) => b.lastActivity - a.lastActivity)[0];
    return {
      name, kind, repos, missing, activity, sessions,
      status: activity.reduce<ActivityStatus>((s, p) => (statusRank[p.status] > statusRank[s] ? p.status : s), 'idle'),
      lastActivity: latest?.lastActivity ?? 0,
      liveSessions: activity.reduce((n, p) => n + p.liveSessions, 0),
      sessionCount: activity.reduce((n, p) => n + p.sessionCount, 0),
      tokensToday: activity.reduce((n, p) => n + p.tokensToday, 0),
      costToday: activity.length ? sum((p) => p.costToday) : 0,
      costTotal: activity.length ? sum((p) => p.costTotal) : 0,
      lastPrompt: latest?.lastPrompt ?? null,
      counts: {
        keys: facts.filter((f) => f.category === 'apikey').length,
        apis: facts.filter((f) => f.category === 'api').length,
        hosting: facts.filter((f) => f.category === 'hosting').length,
        emails: facts.filter((f) => f.category === 'email').length,
        services: facts.filter((f) => f.category === 'service').length,
      },
    };
  };
  for (const g of inventory?.groups ?? []) {
    const repos = g.repos.map((id) => inventory!.projects.find((p) => p.id === id)).filter((p): p is ProjectInventory => !!p);
    const paths = new Set(repos.flatMap((r) => [r.path, ...(r.alsoAt ?? [])]).map(norm));
    const activity = snaps.filter((s) => paths.has(norm(s.path)));
    activity.forEach((s) => used.add(s.id));
    out.push(make(g.name, g.kind, repos, g.missing, activity));
  }
  for (const s of snaps) if (!used.has(s.id)) out.push(make(s.name, 'activity', [], [], [s]));
  return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.lastActivity - a.lastActivity || a.name.localeCompare(b.name));
}

/** The project a folder belongs to (longest matching repo or activity path), or null. */
export function projectOfPath(projects: DashProject[], cwd: string): DashProject | null {
  const c = norm(cwd).replace(/\\/g, '/');
  let best: { p: DashProject; len: number } | null = null;
  for (const p of projects) {
    for (const raw of [...p.repos.flatMap((r) => [r.path, ...(r.alsoAt ?? [])]), ...p.activity.map((a) => a.path)]) {
      const n = norm(raw).replace(/\\/g, '/');
      if ((c === n || c.startsWith(n + '/')) && (!best || n.length > best.len || (n.length === best.len && p.kind !== 'activity'))) best = { p, len: n.length };
    }
  }
  return best?.p ?? null;
}
