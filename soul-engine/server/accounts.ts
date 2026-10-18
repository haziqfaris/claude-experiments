// Accounts: which account, login e-mail and cloud project each provider runs under, per repo. Read from config files
// that name them (IDs and names only: wrangler account_id, .vercel/project.json, .firebaserc, Supabase project ref,
// the GitHub remote). The login e-mail is rarely in a repo, so you note it once in accounts.local.json (git-ignored).
// Never reads .env files or CLI login state, which hold tokens.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AccountNote, AccountsConfig, InventoryFact, RepoAccount } from '../src/types';

const FILE = process.env.SOUL_ACCOUNTS_FILE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../accounts.local.json');

const read = async (p: string) => { try { return await fs.readFile(p, 'utf8'); } catch { return null; } };
const json = <T>(t: string | null): T | null => { try { return t ? (JSON.parse(t.replace(/^\s*\/\/.*$/gm, '')) as T) : null; } catch { return null; } };
/** A long account ID, shortened so it is recognisable without filling the row. */
const short = (id: string) => (id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id);
function gitConfig(dir: string, key: string): Promise<string | null> {
  return new Promise((resolve) => execFile('git', ['-C', dir, 'config', '--get', key], { timeout: 3000, windowsHide: true }, (err, out) => resolve(err ? null : out.trim() || null)));
}

/** What a repo's own config files say about its accounts. */
export async function detectAccounts(dir: string, remote: string | null, facts: InventoryFact[]): Promise<RepoAccount[]> {
  const out: RepoAccount[] = [];
  const add = (a: RepoAccount) => { if (a.account || a.email || a.project) out.push(a); };

  for (const f of ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']) {
    const t = await read(path.join(dir, f)); if (!t) continue;
    const id = /"?account_id"?\s*[=:]\s*"([0-9a-f]{16,})"/i.exec(t)?.[1];
    const name = /(?:^|\n)\s*"?name"?\s*[=:]\s*"([^"]+)"/.exec(t)?.[1];
    add({ provider: 'Cloudflare', account: id ? short(id) : null, project: name ?? null, evidence: f });
  }
  const vercel = json<{ orgId?: string; projectId?: string; projectName?: string }>(await read(path.join(dir, '.vercel', 'project.json')));
  if (vercel) add({ provider: 'Vercel', account: vercel.orgId ? short(vercel.orgId) : null, project: vercel.projectName ?? (vercel.projectId ? short(vercel.projectId) : null), evidence: '.vercel/project.json' });
  const ref = (await read(path.join(dir, 'supabase', '.temp', 'project-ref')))?.trim();
  const sbName = /project_id\s*=\s*"([^"]+)"/.exec((await read(path.join(dir, 'supabase', 'config.toml'))) ?? '')?.[1];
  if (ref || sbName) add({ provider: 'Supabase', project: ref ? `${ref}${sbName ? ` (${sbName})` : ''}` : sbName ?? null, evidence: ref ? 'supabase/.temp/project-ref' : 'supabase/config.toml' });
  const fb = json<{ projects?: Record<string, string> }>(await read(path.join(dir, '.firebaserc')));
  if (fb?.projects) add({ provider: 'Firebase', project: Object.values(fb.projects).join(', '), evidence: '.firebaserc' });
  const aw = json<{ projectId?: string; projectName?: string; endpoint?: string }>(await read(path.join(dir, 'appwrite.json')));
  if (aw) add({ provider: 'Appwrite', project: aw.projectName ? `${aw.projectName}${aw.projectId ? ` (${aw.projectId})` : ''}` : aw.projectId ?? null, evidence: 'appwrite.json' });
  const fly = /app\s*=\s*['"]([^'"]+)['"]/.exec((await read(path.join(dir, 'fly.toml'))) ?? '')?.[1];
  if (fly) add({ provider: 'Fly.io', project: fly, evidence: 'fly.toml' });
  const nl = json<{ siteId?: string }>(await read(path.join(dir, '.netlify', 'state.json')));
  if (nl?.siteId) add({ provider: 'Netlify', project: short(nl.siteId), evidence: '.netlify/state.json' });
  // A Google service account names its cloud project: name@<project>.iam.gserviceaccount.com
  for (const f of facts.filter((x) => x.category === 'email' && /gserviceaccount\.com$/.test(x.value))) {
    const m = /^([^@]+)@([^.]+)\.iam\.gserviceaccount\.com$/.exec(f.value);
    if (m) add({ provider: 'Google Cloud', account: f.value, project: m[2], evidence: f.evidence[0] ?? 'service account' });
  }
  const gh = remote ? /github\.com[/:]([^/]+)\/([^/]+)$/.exec(remote) : null;
  if (gh) add({ provider: 'GitHub', account: gh[1], project: gh[2], email: await gitConfig(dir, 'user.email'), evidence: 'git remote origin' });
  return out;
}

// ---- What you noted ----
let cache: AccountsConfig | null = null;
export async function loadAccounts(): Promise<AccountsConfig> {
  if (cache) return cache;
  const raw = json<Partial<AccountsConfig>>(await read(FILE)) ?? {};
  cache = { providers: raw.providers ?? {}, projects: raw.projects ?? {} };
  return cache;
}

const clean = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
const SECRETISH = /(sk-|ghp_|github_pat_|eyJ|xox[bap]-|AKIA)[A-Za-z0-9_-]{6,}|-----BEGIN/;

/** Saves one note: for one project, or (project null) for every project. Empty fields clear it. */
export async function saveAccount(body: { provider?: unknown; project?: unknown; account?: unknown; email?: unknown; cloudProject?: unknown }): Promise<AccountsConfig | string> {
  const provider = clean(body.provider, 60);
  if (!provider) return 'expected { provider }';
  const note: AccountNote = { account: clean(body.account, 120), email: clean(body.email, 160), project: clean(body.cloudProject, 160) };
  if (note.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(note.email)) return 'that e-mail does not look like an address';
  if (Object.values(note).some((v) => v && SECRETISH.test(v))) return 'that looks like a key or token; only names and addresses go here';
  const cfg = await loadAccounts();
  const scope = clean(body.project, 120);
  const empty = !note.account && !note.email && !note.project;
  const tidy = Object.fromEntries(Object.entries(note).filter(([, v]) => v)) as AccountNote;
  if (scope) {
    const p = cfg.projects[scope] ?? {};
    if (empty) delete p[provider]; else p[provider] = tidy;
    if (Object.keys(p).length) cfg.projects[scope] = p; else delete cfg.projects[scope];
  } else if (empty) delete cfg.providers[provider];
  else cfg.providers[provider] = tidy;
  await fs.writeFile(FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  cache = cfg;
  return cfg;
}
