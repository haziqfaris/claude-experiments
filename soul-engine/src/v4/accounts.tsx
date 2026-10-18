// Accounts in the inventory: under each fact, the account, login e-mail and cloud project it runs under; on each
// project, one strip with every provider it uses, where you can note what the repos cannot show.
import React, { useState } from 'react';
import type { AccountsConfig } from '../types';
import type { AccountView } from '../accounts';

const Tag: React.FC<{ k: string; v: string | null | undefined; from?: 'repo' | 'you' }> = ({ k, v, from }) =>
  v ? <span className={`acct-tag ${from === 'you' ? 'you' : ''}`} title={from === 'you' ? 'You noted this' : 'Found in the repo'}><i>{k}</i>{v}</span> : null;

/** One line under a fact: account · e-mail · project, or a quiet hint when nothing is known. */
export const AccountLine: React.FC<{ a: AccountView }> = ({ a }) => (
  <div className="acct-line">
    <span className="acct-prov">{a.provider}</span>
    {a.account || a.email || a.project ? <>
      <Tag k="account" v={a.account} from={a.from.account} />
      <Tag k="e-mail" v={a.email} from={a.from.email} />
      <Tag k="project" v={a.project} from={a.from.project} />
      {!a.email && <span className="acct-none">e-mail not noted</span>}
    </> : <span className="acct-none">account not known yet</span>}
  </div>
);

/** Every provider a project uses, with its account; edit one to note the login e-mail. */
export const AccountsStrip: React.FC<{ project: string; rows: AccountView[]; onSaved: (c: AccountsConfig) => void }> = ({ project, rows, onSaved }) => {
  const list = [...new Map(rows.map((r) => [r.provider, r])).values()].sort((a, b) => Number(!!b.email) - Number(!!a.email) || a.provider.localeCompare(b.provider));
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  if (!list.length) return null;
  const missing = list.filter((r) => !r.email).length;
  return (
    <div className="acct-strip">
      <button type="button" className="acct-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="label">Accounts · {list.length}</span>
        {missing > 0 && <span className="tiny" style={{ color: 'var(--wait)' }}>{missing} without an e-mail</span>}
        <span className="dim" style={{ marginLeft: 'auto' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && list.map((a) => editing === a.provider
        ? <AccountEditor key={a.provider} a={a} project={project} onDone={(c) => { if (c) onSaved(c); setEditing(null); }} />
        : (
          <div key={a.provider} className="acct-row">
            <b>{a.provider}</b>
            <span className={a.account ? '' : 'dim'}>{a.account ?? '—'}{a.from.account === 'you' && <i className="you-dot" title="You noted this" />}</span>
            <span className={a.email ? '' : 'dim'}>{a.email ?? 'no e-mail'}{a.from.email === 'you' && <i className="you-dot" title="You noted this" />}</span>
            <span className={a.project ? '' : 'dim'}>{a.project ?? '—'}{a.from.project === 'you' && <i className="you-dot" title="You noted this" />}</span>
            <button type="button" className="ghost" onClick={() => setEditing(a.provider)} title={a.evidence.length ? `Found in ${a.evidence.join(', ')}` : 'Nothing in the repos names it'}>{a.email ? 'Edit' : 'Add'}</button>
          </div>
        ))}
    </div>
  );
};

const AccountEditor: React.FC<{ a: AccountView; project: string; onDone: (c: AccountsConfig | null) => void }> = ({ a, project, onDone }) => {
  // Start from what you noted; what the repos show stays underneath as the fallback.
  const [account, setAccount] = useState(a.from.account === 'you' ? a.account ?? '' : '');
  const [email, setEmail] = useState(a.from.email === 'you' ? a.email ?? '' : '');
  const [cloud, setCloud] = useState(a.from.project === 'you' ? a.project ?? '' : '');
  const [everywhere, setEverywhere] = useState(false);
  const [err, setErr] = useState('');
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await fetch('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: a.provider, project: everywhere ? null : project, account, email, cloudProject: cloud }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error ?? 'Not saved.'); return; }
      onDone(d as AccountsConfig);
    } catch { setErr('The hub is not answering.'); }
  };
  return (
    <form className="acct-edit" onSubmit={save}>
      <b>{a.provider}</b>
      <label><span>Account</span><input value={account} onChange={(e) => setAccount(e.target.value)} placeholder={a.from.account === 'repo' ? a.account ?? '' : 'team or account name'} /></label>
      <label><span>Login e-mail</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="who signs in" /></label>
      <label><span>Cloud project</span><input value={cloud} onChange={(e) => setCloud(e.target.value)} placeholder={a.from.project === 'repo' ? a.project ?? '' : 'project or app name'} /></label>
      <label className="acct-all"><input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} /> Same for every project</label>
      <div className="acct-btns">
        {err && <span className="tiny" style={{ color: 'var(--red)' }}>{err}</span>}
        <button type="button" className="btn text sm" onClick={() => onDone(null)}>Cancel</button>
        <button type="submit" className="btn primary sm">Save</button>
      </div>
      <p className="tiny dim">Names and addresses only, never a password or key. Kept on this laptop in accounts.local.json. Leave a field empty to use what the repo shows.</p>
    </form>
  );
};

// ---- Infrastructure: per provider, how many accounts, and which projects and cloud projects sit under each ----
export interface InfraRow { project: string; repo: string | null; cloud: string | null; a: AccountView }
export interface InfraProvider { provider: string; accounts: { key: string; label: string; known: boolean; rows: InfraRow[] }[]; projects: number; clouds: number }

/** Groups every project's use of a provider by the account it runs under (login e-mail, else account ID). */
export function infraByProvider(rows: InfraRow[]): InfraProvider[] {
  const by = new Map<string, InfraRow[]>();
  for (const r of rows) by.set(r.a.provider, [...(by.get(r.a.provider) ?? []), r]);
  return [...by].map(([provider, rs]) => {
    const groups = new Map<string, InfraRow[]>();
    for (const r of rs) { const k = (r.a.email ?? r.a.account ?? '').toLowerCase() || '?'; groups.set(k, [...(groups.get(k) ?? []), r]); }
    const accounts = [...groups].map(([key, g]) => ({ key, known: key !== '?', label: key === '?' ? 'Account not known' : g[0].a.email ?? g[0].a.account ?? key, rows: g.sort((a, b) => a.project.localeCompare(b.project)) }))
      .sort((a, b) => Number(b.known) - Number(a.known) || b.rows.length - a.rows.length);
    return { provider, accounts, projects: new Set(rs.map((r) => r.project)).size, clouds: new Set(rs.map((r) => r.cloud).filter(Boolean)).size };
  }).sort((a, b) => b.projects - a.projects || a.provider.localeCompare(b.provider));
}

export const InfraOverview: React.FC<{ list: InfraProvider[]; onPick: (provider: string) => void; picked: string | null; onSaved: (c: AccountsConfig) => void }> = ({ list, onPick, picked, onSaved }) => {
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) return null;
  return (
    <section className="infra">
      <div className="section-h" style={{ marginTop: 0 }}><h2>Infrastructure</h2><span className="tiny dim">accounts per provider, and the projects under each · click a card for detail</span></div>
      <div className="infra-grid">
        {list.map((p) => {
          const known = p.accounts.filter((a) => a.known).length, unknown = p.accounts.find((a) => !a.known);
          const isOpen = open === p.provider;
          return (
            <article key={p.provider} className={`glass infra-card ${isOpen ? 'open' : ''} ${picked === p.provider ? 'picked' : ''}`}>
              <button type="button" className="infra-h" onClick={() => setOpen(isOpen ? null : p.provider)} aria-expanded={isOpen}>
                <b>{p.provider}</b>
                <span className={`infra-n ${known ? '' : 'none'}`}>{known ? `${known} account${known === 1 ? '' : 's'}` : 'no account noted'}{unknown && known ? ` + ${unknown.rows.length} unknown` : ''}</span>
                <span className="tiny muted">{p.projects} project{p.projects === 1 ? '' : 's'}{p.clouds ? ` · ${p.clouds} cloud project${p.clouds === 1 ? '' : 's'}` : ''}</span>
              </button>
              {isOpen && <div className="infra-b">
                {p.accounts.map((a) => (
                  <div key={a.key} className="infra-acct">
                    <div className={`infra-al ${a.known ? '' : 'unknown'}`}>{a.label}<span className="tiny dim"> · {a.rows.length}</span></div>
                    {a.rows.map((r, i) => <div key={i} className="infra-r"><span>{r.project}</span><small>{r.cloud ?? (r.repo ? `uses it (${r.repo})` : 'uses it')}</small></div>)}
                    {!a.known && <AssignAccount provider={p.provider} projects={[...new Set(a.rows.map((r) => r.project))]} onSaved={onSaved} />}
                  </div>
                ))}
                <button type="button" className="btn text sm" onClick={() => onPick(p.provider)}>{picked === p.provider ? 'Show all rows' : `Show only ${p.provider} rows`}</button>
              </div>}
            </article>
          );
        })}
      </div>
    </section>
  );
};

/** Note one login e-mail (and account name) for several projects at once. */
const AssignAccount: React.FC<{ provider: string; projects: string[]; onSaved: (c: AccountsConfig) => void }> = ({ provider, projects, onSaved }) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState('');
  const [pick, setPick] = useState<Set<string>>(() => new Set(projects));
  const [err, setErr] = useState('');
  if (!open) return <button type="button" className="btn text sm infra-add" onClick={() => setOpen(true)}>Note which account these use…</button>;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() && !account.trim()) { setErr('Add an e-mail or an account name.'); return; }
    let last: AccountsConfig | null = null;
    for (const project of pick) {
      const r = await fetch('/api/accounts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, project, email, account }) }).catch(() => null);
      const d = r ? await r.json() : { error: 'The hub is not answering.' };
      if (!r?.ok) { setErr(d.error ?? 'Not saved.'); return; }
      last = d as AccountsConfig;
    }
    if (last) onSaved(last);
    setOpen(false); setEmail(''); setAccount('');
  };
  return (
    <form className="infra-form" onSubmit={save}>
      <div className="infra-form-f">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`${provider} login e-mail`} aria-label="Login e-mail" />
        <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Account or org name (optional)" aria-label="Account name" />
      </div>
      <div className="infra-picks">{projects.map((p) => <label key={p}><input type="checkbox" checked={pick.has(p)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(p); else n.delete(p); setPick(n); }} />{p}</label>)}</div>
      <div className="acct-btns">{err && <span className="tiny" style={{ color: 'var(--red)' }}>{err}</span>}<button type="button" className="btn text sm" onClick={() => setOpen(false)}>Cancel</button><button type="submit" className="btn primary sm" disabled={!pick.size}>Save for {pick.size} project{pick.size === 1 ? '' : 's'}</button></div>
      <p className="tiny dim">Names and addresses only. Projects on different accounts: save once per account, ticking only its projects.</p>
    </form>
  );
};
