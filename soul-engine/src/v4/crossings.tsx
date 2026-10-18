// Crossings: which chat changes which repo, and when one chat's push means another should pull. The 3D map is the
// picture; the list beside it says the same in words, with a one-click (confirmed) heads-up to the chat that should act.
import React, { Suspense, lazy, useMemo, useState } from 'react';
import type { ChatItem, CrossingAlert, Crossings } from '../types';
import { hueOf } from '../projects';
import { ago } from '../format';
import type { AppCtx } from './views';
import { chatName } from './ui';

const Scene = lazy(() => import('./crossings3d'));
const DISMISS = 'soul.crossings.dismissed';

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

export const CrossingsView: React.FC<{ ctx: AppCtx }> = ({ ctx }) => {
  const x = ctx.crossings;
  const [focus, setFocus] = useState<string | null>(null);
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

  const repoRows = (data?.repos ?? []).slice().sort((a, b) => Number(b.hot) - Number(a.hot) || b.writers - a.writers || b.chats - a.chats);
  return (
    <div className="view-in">
      <div className="head"><h1>Crossings</h1><span className="s">Which chat changes which repo, over the last day{attend.length ? <> · <b style={{ color: 'var(--wait)' }}>{attend.length} need{attend.length === 1 ? 's' : ''} you</b></> : ' · nothing needs you'}</span></div>
      <div className="xgrid">
        <div className="glass xstage">
          {data && data.repos.length
            ? <Suspense fallback={<div className="x3 x3-wait"><span className="livedot" /> Drawing the map…</div>}>
                <Scene data={data} chats={ctx.chats} focus={focus} onChat={(id) => ctx.openChat(id)} onRepo={setFocus} />
              </Suspense>
            : <div className="x3 x3-wait">{x ? 'No chat has worked in a repo in the last day.' : 'Reading chats and repos…'}</div>}
          <div className="xlegend">
            <span><i style={{ background: 'var(--muted)' }} />worked in</span>
            <span><i style={{ background: '#fb923c' }} />committed or pushed</span>
            <span><i style={{ background: 'var(--wait)' }} />should pull</span>
            <span><i className="dash" />another project’s repo</span>
            <span className="dim">Drag to turn · scroll to zoom · click a chat to open it</span>
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
      <div className="section-h"><h2>Repos chats touched</h2><span className="tiny dim">the last 24 hours</span></div>
      <div className="glass xtable" role="table" aria-label="Repos">
        <div className="xrow xh" role="row"><span>Repo</span><span>Chats</span><span>Edits</span><span>Commits</span><span>Pushes</span><span>GitHub</span></div>
        {repoRows.map((r) => {
          const ls = (data?.links ?? []).filter((l) => l.repo === r.id);
          const sum = (k: 'edits' | 'commits' | 'pushes' | 'merges') => ls.reduce((n, l) => n + l[k], 0);
          return (
            <div key={r.id} className={`xrow ${focus === r.id ? 'on' : ''}`} role="row" tabIndex={0} onMouseEnter={() => setFocus(r.id)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(r.id)}>
              <span className="xname"><i className="dot" style={{ background: hueOf(r.project) }} /><span><b>{r.name}</b><small>{r.project}{r.branch ? ` · ${r.branch}` : ''}</small></span>{r.hot && <em>look</em>}</span>
              <span className="xchats">{ls.slice(0, 4).map((l) => { const c = chatById.get(l.chat); return c ? <button key={l.chat} type="button" title={chatName(c)} onClick={() => ctx.openChat(c.id)} style={{ ['--hue' as string]: hueOf(c.project) }}>{chatName(c).slice(0, 18)}</button> : null; })}{ls.length > 4 && <small>+{ls.length - 4}</small>}</span>
              <span>{sum('edits') || '–'}</span><span>{sum('commits') || '–'}</span><span>{sum('pushes') + sum('merges') || '–'}</span>
              <span>{r.behind ? <b style={{ color: 'var(--wait)' }}>↓{r.behind} behind</b> : r.behind === 0 ? <span className="dim">up to date</span> : <span className="dim">—</span>}{r.ahead ? <span className="dim"> · ↑{r.ahead}</span> : null}</span>
            </div>
          );
        })}
        {!repoRows.length && <div className="xrow"><span className="dim">Nothing yet.</span></div>}
      </div>
    </div>
  );
};
