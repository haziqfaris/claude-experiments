// One-click documents built from the inventory, with no AI needed:
// an Access Register draft for a project, and a rotation checklist for one key.
import type { Inventory, InventoryFact, ProjectInventory } from '../src/types';

const today = () => new Date().toISOString().slice(0, 10);
const ev = (f: InventoryFact) => (f.evidence.length ? ` (${f.evidence.slice(0, 2).join(', ')})` : '');

function reposOf(inv: Inventory, project: string): ProjectInventory[] {
  const g = inv.groups.find((x) => x.name.toLowerCase() === project.toLowerCase());
  if (g) return g.repos.map((id) => inv.projects.find((p) => p.id === id)).filter((p): p is ProjectInventory => !!p);
  return inv.projects.filter((p) => p.name.toLowerCase() === project.toLowerCase());
}

/** Access Register draft in the shape of the REKA S13 template: services, keys by name, addresses, personal access. */
export function accessRegisterDraft(inv: Inventory, project: string): string | null {
  const repos = reposOf(inv, project);
  if (!repos.length) return null;
  const all = repos.flatMap((r) => r.facts.map((f) => ({ r, f })));
  const pick = (cat: string) => all.filter((x) => x.f.category === cat);
  const out: string[] = [
    `# ${project}: Access and Account Register (draft)`,
    '',
    `> Drafted ${today()} by the REKA Soul Engine from ${repos.length} repo${repos.length === 1 ? '' : 's'} (${repos.map((r) => r.name).join(', ')}). Every row is a lead to confirm, not a fact: fill the organisation, admins (two per account, rule R20), billing owner and vault entry. Never write a secret value here.`,
    '',
    '## 1. Services',
    '',
    '| Service | Used for | Repo | Organisation | Admins (two) | Billing owner | Vault entry | Renews |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const services = new Map<string, Set<string>>();
  // One row per account: providers, not libraries or config details.
  const provider = (cat: string, label: string, value: string): string | null => {
    const t = `${label} ${value}`;
    if (/Cloudflare/i.test(t)) return 'Cloudflare';
    if (/Supabase/i.test(t)) return 'Supabase';
    if (/Vercel/i.test(t)) return 'Vercel';
    if (/Netlify/i.test(t)) return 'Netlify';
    if (/Fly\.io/i.test(t)) return 'Fly.io';
    if (/Appwrite/i.test(t)) return 'Appwrite';
    if (/Docker/i.test(t)) return 'Server or on-premise host (Docker)';
    if (cat === 'hosting') return null;
    if (/^(React|Vite|Next\.js|Astro|Vitest|Playwright|Expo|Three\.js|Maps|Document generation|WebSockets|Postgres client|Prisma|Drizzle ORM|Vercel AI SDK)$/.test(value)) return null; // libraries, not accounts
    return value.replace(/ \(e-mail\)$/, '');
  };
  for (const { r, f } of [...pick('service'), ...pick('hosting')]) {
    const name = provider(f.category, f.label, f.value);
    if (!name) continue;
    const s = services.get(name) ?? new Set<string>(); s.add(r.name); services.set(name, s);
  }
  for (const [name, rs] of [...services.entries()].sort()) out.push(`| ${name} | [CONFIRM] | ${[...rs].join(', ')} | [CONFIRM] | [CONFIRM] | [CONFIRM] | [CONFIRM] | |`);
  out.push('', '## 2. Secrets inventory (names only)', '', '| Variable or key | API it calls | Used by | Vault entry | Rotated last | Rotation steps |', '|---|---|---|---|---|---|');
  for (const { r, f } of pick('apikey')) {
    const testsOnly = f.evidence.length > 0 && f.evidence.every((e) => /(^|\/)(e2e|tests?|__tests__|spec|playwright|puppeteer|fixtures?)[^/]*\/|\.(test|spec)\.|puppeteer\.config/i.test(e));
    out.push(`| \`${f.value}\` | ${f.label}${testsOnly ? ' (tests only)' : ''} | ${r.name}${ev(f)} | [CONFIRM] | [CONFIRM] | See the rotation checklist |`);
  }
  out.push('', '## 3. Domains', '', '| Domain | Repo | Registrar and DNS owner |', '|---|---|---|');
  const domains = new Map<string, string>();
  for (const { r, f } of pick('domain')) if (!domains.has(f.value)) domains.set(f.value, r.name);
  for (const [d, r] of [...domains.entries()].sort()) out.push(`| ${d} | ${r} | [CONFIRM] |`);
  out.push('', '## 4. Addresses and accounts found in the repos', '', '| Address | Role found | Repo | Personal? (move to a role mailbox) |', '|---|---|---|---|');
  const seen = new Set<string>();
  for (const { r, f } of pick('email')) {
    if (f.label === 'Demo or test account' || seen.has(f.value)) continue; seen.add(f.value);
    const personal = f.masked || (!/^(no-?reply|support|hello|holla|info|admin|ops|alerts|billing|host[a-z-]*|team|mail|notifications?)@/i.test(f.value));
    out.push(`| ${f.value} | ${f.label} | ${r.name} | ${personal ? 'Check: looks personal' : 'Role address'} |`);
  }
  out.push('', '## 5. Personal access to remove or justify', '', '- [CONFIRM] Personal tokens or accounts tied to one person (look for personal access tokens in CI secrets and personal addresses above).');
  out.push('', '## 6. Scheduled jobs that need credentials', '');
  for (const { r, f } of pick('job')) out.push(`- ${r.name}: ${f.label}: ${f.value}`);
  return out.join('\n') + '\n';
}

/** Everything to change when one key is rotated: where it is defined, read and deployed. */
export function rotationChecklist(inv: Inventory, keyName: string): string | null {
  const k = keyName.trim().toUpperCase();
  const uses = inv.projects.flatMap((p) => p.facts.filter((f) => (f.category === 'apikey' || f.category === 'env') && f.value.toUpperCase() === k).map((f) => ({ p, f })));
  if (!uses.length) return null;
  const api = uses.find((u) => u.f.category === 'apikey')?.f.label ?? 'Unknown API';
  const repos = [...new Map(uses.map((u) => [u.p.id, u.p])).values()];
  const out = [
    `# Rotate \`${k}\` (${api})`,
    '',
    `> Drafted ${today()} by the REKA Soul Engine. ${repos.length} repo${repos.length === 1 ? '' : 's'} use this key. Rotate in one sitting: new key first, then every place below, then revoke the old one.`,
    '',
    '## Before',
    '',
    `- [ ] Who owns the account behind ${api}, and is there a second admin? (Access Register)`,
    '- [ ] Pick a quiet time; tell support which features may hiccup',
    `- [ ] Create the new key in ${api}; store it in the vault under the same entry name`,
    '',
    '## Update every place that holds it',
    '',
  ];
  for (const p of repos) {
    const files = [...new Set(uses.filter((u) => u.p.id === p.id).flatMap((u) => u.f.evidence))];
    const ci = files.filter((e) => /\(CI\)|\.github\/workflows/.test(e));
    const code = files.filter((e) => !ci.includes(e));
    const hosting = p.facts.filter((f) => f.category === 'hosting').map((f) => `${f.label}: ${f.value}`);
    out.push(`### ${p.project === p.name ? p.name : `${p.project} / ${p.name}`}`, '');
    if (ci.length) out.push(`- [ ] GitHub Actions secret \`${k}\` (used in ${ci.map((c) => c.replace(' (CI)', '')).join(', ')})`);
    if (hosting.length) out.push(`- [ ] Runtime secret on the host: ${[...new Set(hosting)].slice(0, 4).join('; ')}`);
    out.push(`- [ ] Local \`.env\` files of everyone who runs ${p.name}`);
    if (code.length) out.push(`- [ ] Read in code (no change needed unless the name changes): ${code.slice(0, 6).join(', ')}`);
    out.push('');
  }
  out.push('## After', '', '- [ ] Redeploy or restart what reads it; run the smoke test', '- [ ] Revoke the old key at the provider', '- [ ] Note the rotation date in the Access Register (Rotated last)', '');
  return out.join('\n');
}
