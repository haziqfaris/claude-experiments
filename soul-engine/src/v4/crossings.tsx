// Crossings: which chat changes which repo, and when one chat's push means another should pull. The 3D map is the
// picture; the list beside it says the same in words, with a one-click (confirmed) heads-up to the chat that should act.
import React, { Suspense, lazy, useMemo, useState } from 'react';
import type { ChatItem, CrossingAlert, CrossingLink, Crossings } from '../types';
import { hueOf } from '../projects';
import { ago } from '../format';
import type { AppCtx } from './views';
import { chatName } from './ui';

const Scene = lazy(() => import('./crossings3d'));
const DISMISS = 'soul.crossings.dismissed';
const GUIDE = 'soul.crossings.guide';

function readDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS) ?? '[]') as string[]); } catch { return new Set(); }
}
function writeDismissed(s: Set<string>) {
  try { localStorage.setItem(DISMISS, JSON.stringify([...s].slice(-300))); } catch { /* private window: forget on reload */ }
}

/** Alerts still worth showing: not dismissed, and within the open scope. */
export function liveAlerts(x: Crossings | null, chats: ChatItem[], scope: string | null, dismissed = readDismissed()): CrossingAlert[] {
  if (!x) return [];
  const proj = new Map(chats.map((c) => [c.id, c.project]));
  const repoProj = new Map(x.repos.map((r) => [r.id, r.project]));
  return x.alerts.filter((a) => !dismissed.has(a.id) && (!scope || [proj.get(a.to ?? ''), proj.get(a.from ?? ''), repoProj.get(a.repo)].includes(scope)));
}

const KIND: Record<CrossingAlert['kind'], [string, string]> = {
  'pushed-under': ['Pushed under another chat', 'var(--wait)'],
  'same-time': ['Editing at the same time', 'var(--wait)'],
  behind: ['Behind GitHub', 'var(--wait)'],
  foreign: ['Another project’s repo', 'var(--violet)'],
};

/** What a chat did in a repo, in words: "8 file edits · 2 commits · 1 push". */
function did(l: CrossingLink): string {
  const p = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : '');
  const parts = [p(l.edits, 'file edit', 'file edits'), p(l.commits, 'commit', 'commits'), p(l.pushes, 'push', 'pushes'), p(l.merges, 'PR merged', 'PRs merged')].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'working there, nothing changed yet';
}

// Small drawings for the guide, matching what the map draws.
const G = {
  chat: <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="6" fill="#ff6ad5" /><circle cx="14" cy="14" r="9" fill="#ff6ad5" opacity="0.25" /></svg>,
  chatNeeds: <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="5" fill="#6ba8ff" /><circle cx="14" cy="14" r="10" fill="none" stroke="#fbbf24" strokeWidth="2" /></svg>,
  repo: <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><polygon points="14,4 22,9 22,19 14,24 6,19 6,9" fill="none" stroke="#7cff6b" strokeWidth="1" opacity="0.6" /><circle cx="14" cy="14" r="5" fill="#7cff6b" /><ellipse cx="14" cy="22" rx="10" ry="2.5" fill="none" stroke="#7cff6b" opacity="0.6" /></svg>,
  repoHot: <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><polygon points="14,4 22,9 22,19 14,24 6,19 6,9" fill="none" stroke="#fbbf24" strokeWidth="1.4" /><circle cx="14" cy="14" r="5" fill="#7cff6b" /><ellipse cx="14" cy="22" rx="11" ry="3" fill="none" stroke="#fbbf24" /></svg>,
  thin: <svg viewBox="0 0 44 12" width="44" height="12" aria-hidden="true"><path d="M2 9 Q22 1 42 9" stroke="#ff6ad5" strokeWidth="1.5" fill="none" opacity="0.6" /></svg>,
  push: <svg viewBox="0 0 44 12" width="44" height="12" aria-hidden="true"><path d="M2 9 Q22 1 42 9" stroke="#fb923c" strokeWidth="3" fill="none" /><circle cx="15" cy="5" r="2.2" fill="#fff3e0" /><circle cx="29" cy="5" r="2.2" fill="#fff3e0" /></svg>,
  pull: <svg viewBox="0 0 44 12" width="44" height="12" aria-hidden="true"><path d="M2 9 Q22 1 42 9" stroke="#fbbf24" strokeWidth="2.5" fill="none" opacity="0.8" /><circle cx="22" cy="5" r="3" fill="#fbbf24" /></svg>,
  foreign: <svg viewBox="0 0 44 12" width="44" height="12" aria-hidden="true"><path d="M2 9 Q22 1 42 9" stroke="#b39dff" strokeWidth="2" fill="none" strokeDasharray="4 3" /></svg>,
  wave: <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><ellipse cx="14" cy="16" rx="12" ry="5" fill="none" stroke="#fb923c" opacity="0.5" /><ellipse cx="14" cy="16" rx="7" ry="3" fill="none" stroke="#fb923c" /></svg>,
};

const Guide: React.FC = () => {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(GUIDE) !== 'closed'; } catch { return true; } });
  const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem(GUIDE, v ? 'open' : 'closed'); } catch { /* fine */ } };
  return (
    <div className="xguide">
      <button type="button" className="xguide-h" onClick={toggle} aria-expanded={open}><b>How to read the map</b><span className="dim">{open ? 'Hide ▾' : 'Show ▸'}</span></button>
      {open && <div className="xguide-b">
        <div className="xg-col">
          <div className="xg-k">The shapes</div>
          <div className="xg-i">{G.chat}<span><b>Small glowing ball: a chat</b>One Claude Code chat, in its project’s colour. Bright means active now, faint means idle. Chats sit on the outer ring.</span></div>
          <div className="xg-i">{G.chatNeeds}<span><b>Amber ring around a ball</b>That chat needs you: it is waiting for an answer, or another chat changed its repo.</span></div>
          <div className="xg-i">{G.repo}<span><b>Crystal with a ring: a repo</b>A code repository on this laptop (copies and worktrees count as one), in the middle. Its label shows the branch and anything unusual: files changed but not committed, commits not pushed, commits on GitHub not pulled.</span></div>
          <div className="xg-i">{G.repoHot}<span><b>Amber cage: look at this repo</b>More than one chat is changing it, or something there needs you.</span></div>
        </div>
        <div className="xg-col">
          <div className="xg-k">The lines, chat to repo</div>
          <div className="xg-i">{G.thin}<span><b>Thin line in the chat’s colour</b>The chat works in that repo: it is the chat’s folder, or the chat edited files there.</span></div>
          <div className="xg-i">{G.push}<span><b>Thick orange line, light flowing to the repo</b>The chat committed or pushed into that repo. Thicker means more.</span></div>
          <div className="xg-i">{G.pull}<span><b>Amber line, light flowing out to a chat</b>The repo changed under that chat (someone pushed). That chat should pull before it carries on.</span></div>
          <div className="xg-i">{G.foreign}<span><b>Dashed violet line</b>The chat changed a repo that belongs to a different project. Often fine, worth knowing.</span></div>
          <div className="xg-i">{G.wave}<span><b>Orange ripple under a repo</b>Someone pushed there in the last 30 minutes.</span></div>
        </div>
        <div className="xg-col">
          <div className="xg-k">The alerts, on the right</div>
          <p><b>Pushed under another chat</b>: one chat pushed or merged into a repo another chat is still working in. Send that chat a heads-up to pull.</p>
          <p><b>Editing at the same time</b>: two chats changed the same repo within half an hour (the same file is riskier). One could overwrite the other.</p>
          <p><b>Behind GitHub</b>: GitHub has commits this folder does not (pushed from elsewhere). The hub checks every 5 minutes.</p>
          <p><b>Another project’s repo</b>: a heads-up only.</p>
          <div className="xg-k" style={{ marginTop: 8 }}>Moving around</div>
          <p>Drag to turn, scroll to zoom. Point at a ball or a crystal to see what it is; click a chat to open it.</p>
        </div>
      </div>}
    </div>
  );
};

export const CrossingsView: React.FC<{ ctx: AppCtx }> = ({ ctx }) => {
  const x = ctx.crossings;
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [showNotes, setShowNotes] = useState(true);
  const chatById = useMemo(() => new Map(ctx.chats.map((c) => [c.id, c])), [ctx.chats]);
  const name = (id: string | null) => { const c = id ? chatById.get(id) : undefined; return c ? chatName(c) : 'a chat'; };

  // In a project, only its repos and the chats touching them.
  const data: Crossings | null = useMemo(() => {
    if (!x || !ctx.scope) return x;
    const repos = x.repos.filter((r) => r.project === ctx.scope || x.links.some((l) => l.repo === r.id && chatById.get(l.chat)?.project === ctx.scope));
    const ids = new Set(repos.map((r) => r.id));
    return { ...x, repos, links: x.links.filter((l) => ids.has(l.repo)), alerts: x.alerts.filter((a) => ids.has(a.repo)) };
  }, [x, ctx.scope, chatById]);

  const alerts = liveAlerts(data, ctx.chats, null, dismissed);
  const attend = alerts.filter((a) => a.level === 'attend');
  const notes = alerts.filter((a) => a.level === 'note');
  const dismiss = (id: string) => { const s = new Set(dismissed); s.add(id); writeDismissed(s); setDismissed(s); };
  const repoName = (id: string) => data?.repos.find((r) => r.id === id)?.name ?? id;

  const card = (a: CrossingAlert) => {
    const [k, col] = KIND[a.kind];
    const target = a.to ? chatById.get(a.to) : undefined;
    return (
      <article key={a.id} className={`glass xalert ${focus === a.repo ? 'on' : ''}`} style={{ ['--k' as string]: col }}
        onMouseEnter={() => setFocus(a.to ?? a.repo)} onMouseLeave={() => setFocus(null)}>
        <div className="xk"><span>{k}</span><span className="dim">{ago(a.at)} ago · {repoName(a.repo)}</span></div>
        <b>{a.title}</b>
        <p>{a.text}</p>
        <div className="xact">
          {a.fix && target && <button type="button" className="btn primary sm" onClick={() => ctx.sendTo(target.id, `Heads-up to “${chatName(target)}”`, a.fix!)}>Tell “{chatName(target)}”…</button>}
          {a.to && !(a.fix && target) && <button type="button" className="btn text sm" onClick={() => ctx.openChat(a.to!)}>Open “{name(a.to)}”</button>}
          {a.from && a.from !== a.to && <button type="button" className="btn text sm" onClick={() => ctx.openChat(a.from!)}>Open “{name(a.from)}”</button>}
          <button type="button" className="btn text sm" style={{ marginLeft: 'auto', color: 'var(--dim)' }} onClick={() => dismiss(a.id)}>Dismiss</button>
        </div>
      </article>
    );
  };

  // What the pointer is on, in words.
  const info = (() => {
    const id = hover ?? focus;
    if (!id || !data) return null;
    const repo = data.repos.find((r) => r.id === id);
    const mine = alerts.filter((a) => a.repo === id || a.to === id || a.from === id);
    if (repo) {
      const ls = data.links.filter((l) => l.repo === id);
      const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
      const state = [repo.branch ? `on branch ${repo.branch}` : '', repo.dirty ? `${n(repo.dirty, 'file')} changed, not committed` : '', repo.ahead ? `${n(repo.ahead, 'commit')} not pushed` : '',
        repo.behind ? `${n(repo.behind, 'commit')} on GitHub not pulled yet` : repo.behind === 0 ? 'up to date with GitHub' : ''].filter(Boolean);
      return { kind: 'Repo', title: repo.name, sub: repo.project, hue: hueOf(repo.project), state,
        rows: ls.map((l) => ({ k: name(l.chat), v: did(l) + (l.home ? ' (its folder)' : '') + (l.foreign ? ' · from another project' : '') })), alerts: mine };
    }
    const c = chatById.get(id);
    if (!c) return null;
    const ls = data.links.filter((l) => l.chat === id);
    return { kind: 'Chat', title: chatName(c), sub: c.project, hue: hueOf(c.project),
      state: [c.state === 'working' ? 'working now' : c.state === 'waiting' ? 'waiting for you' : `idle, last active ${ago(c.lastActivity)} ago`],
      rows: ls.map((l) => ({ k: repoName(l.repo), v: did(l) + (l.home ? ' (its folder)' : '') + (l.foreign ? ' · another project’s repo' : '') })), alerts: mine };
  })();

  const repoRows = (data?.repos ?? []).slice().sort((a, b) => Number(b.hot) - Number(a.hot) || b.writers - a.writers || b.chats - a.chats);
  return (
    <div className="view-in">
      <div className="head"><h1>Crossings</h1><span className="s">Which chats change which repos over the last day, so you catch one chat pushing under another{attend.length ? <> · <b style={{ color: 'var(--wait)' }}>{attend.length} need{attend.length === 1 ? 's' : ''} you</b></> : ' · nothing needs you'}</span></div>
      <div className="xgrid">
        <div className="glass xstage">
          {data && data.repos.length
            ? <Suspense fallback={<div className="x3 x3-wait"><span className="livedot" /> Drawing the map…</div>}>
                <Scene data={data} chats={ctx.chats} focus={focus} onChat={(id) => ctx.openChat(id)} onRepo={setFocus} onHover={setHover} />
              </Suspense>
            : <div className="x3 x3-wait">{x ? 'No chat has worked in a repo in the last day.' : 'Reading chats and repos…'}</div>}
          {data && data.repos.length > 0 && (info
            ? <div className="xinfo" style={{ ['--hue' as string]: info.hue }}>
                <div className="xinfo-k">{info.kind} · <span style={{ color: info.hue }}>{info.sub}</span></div>
                <b>{info.title}</b>
                {info.state.map((s) => <div key={s} className="tiny muted">{s}</div>)}
                {info.rows.length > 0 && <div className="xinfo-rows">{info.rows.slice(0, 6).map((r) => <div key={r.k}><span>{r.k}</span><small>{r.v}</small></div>)}</div>}
                {info.alerts.slice(0, 2).map((a) => <div key={a.id} className="xinfo-alert">{a.title}</div>)}
              </div>
            : <div className="xinfo hint">Point at a <b>ball</b> (a chat) or a <b>crystal</b> (a repo) to see what it is.</div>)}
          <div className="xlegend">
            <span>{G.thin}works in</span>
            <span>{G.push}committed or pushed</span>
            <span>{G.pull}should pull</span>
            <span>{G.foreign}another project’s repo</span>
          </div>
        </div>
        <aside className="xside">
          <div className="label" style={{ color: attend.length ? 'var(--wait)' : undefined }}>Needs you · {attend.length}</div>
          {attend.length ? attend.map(card) : <p className="small dim" style={{ margin: '6px 0 14px' }}>No chat has pushed under another. When one does, it shows here and on the map.</p>}
          {notes.length > 0 && <>
            <button type="button" className="label xtoggle" onClick={() => setShowNotes(!showNotes)}>Good to know · {notes.length} {showNotes ? '▾' : '▸'}</button>
            {showNotes && notes.map(card)}
          </>}
          {data?.fetch === 'off' && <p className="tiny dim">GitHub checks are off (SOUL_FETCH=off): pushes from other machines are not seen.</p>}
        </aside>
      </div>
      <Guide />
      <div className="section-h"><h2>Repos chats touched</h2><span className="tiny dim">the last 24 hours, and what each chat did there</span></div>
      <div className="glass xtable" role="table" aria-label="Repos">
        <div className="xrow xh" role="row"><span>Repo</span><span title="Chats that worked in it">Chats</span><span title="Files changed by those chats">File edits</span><span title="Commits those chats made">Commits</span><span title="Pushes and merged PRs by those chats">Pushes</span><span title="Compared with GitHub at the hub's last check">vs GitHub</span></div>
        {repoRows.map((r) => {
          const ls = (data?.links ?? []).filter((l) => l.repo === r.id);
          const sum = (k: 'edits' | 'commits' | 'pushes' | 'merges') => ls.reduce((n, l) => n + l[k], 0);
          return (
            <div key={r.id} className={`xrow ${focus === r.id ? 'on' : ''}`} role="row" tabIndex={0} onMouseEnter={() => setFocus(r.id)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(r.id)}>
              <span className="xname"><i className="dot" style={{ background: hueOf(r.project) }} /><span><b>{r.name}</b><small>{r.project}{r.branch ? ` · ${r.branch}` : ''}</small></span>{r.hot && <em>look</em>}</span>
              <span className="xchats">{ls.slice(0, 4).map((l) => { const c = chatById.get(l.chat); return c ? <button key={l.chat} type="button" title={chatName(c)} onClick={() => ctx.openChat(c.id)} style={{ ['--hue' as string]: hueOf(c.project) }}>{chatName(c).slice(0, 18)}</button> : null; })}{ls.length > 4 && <small>+{ls.length - 4}</small>}</span>
              <span>{sum('edits') || '–'}</span><span>{sum('commits') || '–'}</span><span>{sum('pushes') + sum('merges') || '–'}</span>
              <span>{r.behind ? <b style={{ color: 'var(--wait)' }} title="Commits on GitHub this folder does not have">{r.behind} to pull</b> : r.behind === 0 ? <span className="dim">up to date</span> : <span className="dim" title="Checked only for repos with an open chat">not checked</span>}{r.ahead ? <span className="dim" title="Local commits not on GitHub yet"> · {r.ahead} to push</span> : null}</span>
            </div>
          );
        })}
        {!repoRows.length && <div className="xrow"><span className="dim">Nothing yet.</span></div>}
      </div>
    </div>
  );
};
