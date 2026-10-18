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
