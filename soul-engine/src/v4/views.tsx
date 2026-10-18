// The five places of v4: Today (the soul, full page), Chats, Tasks, Projects, Inventory.
import React, { useMemo, useState } from 'react';
import type { ChatItem, Crossings, FeedItem, Inventory, InventoryCategory, InventoryFact, ProjectStatus, Snapshot, TaskItem } from '../types';
import { hueOf } from '../projects';
import { ago, fmtCost, fmtTokens } from '../format';
import { usePoll } from '../services/soulService';
import { SoulChat, HomePicker, type SoulMsg } from './soulchat';
import { liveAlerts } from './crossings';
import { Avatar, chatName, Health, Icon, MODEL_C, Progress, ReadinessTrack, recentSplits, since, SplitBoard, StageTrack, StatePill, Topology } from './ui';

export type View = 'today' | 'chats' | 'crossings' | 'tasks' | 'projects' | 'inventory';
export const VIEWS: [View, string][] = [['today', 'Today'], ['chats', 'Chats'], ['crossings', 'Crossings'], ['tasks', 'Tasks'], ['projects', 'Projects'], ['inventory', 'Inventory']];

export interface AppCtx {
  chats: ChatItem[];
  feed: FeedItem[];
  tasks: TaskItem[];
  status: ProjectStatus[];
  inventory: Inventory | null;
  snapshot: Snapshot | null;
  scope: string | null;
  setScope: (s: string | null) => void;
  go: (v: View) => void;
  openChat: (id: string, list?: string[]) => void;
  openTask: (id: string) => void;
  askRoadmap: (chatId: string) => void;
  statusOf: (name: string) => ProjectStatus | undefined;
  crossings: Crossings | null;
  /** Opens the confirm-then-send dialog for one chat. */
  sendTo: (chatId: string, title: string, text: string) => void;
}

const inScope = (ctx: AppCtx, project: string) => !ctx.scope || ctx.scope === project;
/** The first crossing that asks this chat to act, if any. */
const crossFor = (ctx: AppCtx, chatId: string) => liveAlerts(ctx.crossings, ctx.chats, null).find((a) => a.level === 'attend' && a.to === chatId);
const ORDER = { waiting: 0, working: 1, idle: 2 } as const;

// ---- Cards ----
export const ChatCard: React.FC<{ c: ChatItem; ctx: AppCtx; list?: string[]; showProject?: boolean }> = ({ c, ctx, list, showProject = true }) => {
  const hue = hueOf(c.project), s = ctx.statusOf(c.project);
  const done = c.steps.filter((x) => x.done).length, next = c.steps.find((x) => !x.done);
  return (
    <article className="glass ucard chatc" style={{ ['--hue' as string]: hue }} tabIndex={0} onClick={() => ctx.openChat(c.id, list)} onKeyDown={(e) => { if (e.key === 'Enter') ctx.openChat(c.id, list); }}>
      <header>
        <Avatar name={c.project} size="sm" />
        <div className="t"><b title={chatName(c)}>{chatName(c)}</b><span>{showProject ? `${c.project} · ` : ''}{c.model ? c.model.replace(/^claude-/, '').replace(/-/g, ' ') : 'model unknown'}</span></div>
        <StatePill state={c.state} />
      </header>
      <Progress done={done} total={c.steps.length} hue={hue} />
      {c.asked ? <div className="line" style={{ color: 'var(--wait)' }}>“{c.asked}”</div>
        : <div className="line"><b>{c.state === 'working' && c.doing ? 'Now:' : 'Next:'}</b> {c.state === 'working' && c.doing ? `${c.doing.tool}${c.doing.detail ? ' · ' + c.doing.detail : ''}` : next ? next.text : c.steps.length ? 'plan finished' : (c.lastReply ?? c.prompt ?? '').slice(0, 140) || 'no plan yet'}</div>}
      <footer>
        {s ? <Health s={s} /> : <span className="tiny dim">{c.folder}</span>}
        {s && !s.roadmap && <span className="rm-chip none">no roadmap</span>}
        {recentSplits(c).some((a) => a.status === 'running') && <span className="srcpill s-split" style={{ marginLeft: 0 }}>splitting</span>}
        {crossFor(ctx, c.id) && <button type="button" className="rm-chip none xchip" title={crossFor(ctx, c.id)!.title} onClick={(e) => { e.stopPropagation(); ctx.go('crossings'); }}>⇄ {crossFor(ctx, c.id)!.kind === 'same-time' ? 'another chat is editing here' : 'repo changed: pull'}</button>}
        <span style={{ marginLeft: 'auto' }}>{c.steps.length ? `${done}/${c.steps.length} · ` : ''}{since(c.lastActivity)}</span>
      </footer>
    </article>
  );
};

const ProjectCard: React.FC<{ s: ProjectStatus; ctx: AppCtx }> = ({ s, ctx }) => {
  const hue = hueOf(s.name), chats = ctx.chats.filter((c) => c.project === s.name), waiting = chats.filter((c) => c.state === 'waiting').length;
  const rm = s.roadmap?.kind === 'roadmap' ? s.roadmap : null;
  const total = rm ? rm.counts.done + rm.counts.inProgress + rm.counts.blocked + rm.counts.planned : 0;
  const down = s.live.some((l) => !l.ok && !l.staging && l.source !== 'platform address'), up = s.live.some((l) => l.ok && !l.staging);
  return (
    <article className="glass ucard" tabIndex={0} onClick={() => { ctx.setScope(s.name); ctx.go('projects'); }} onKeyDown={(e) => { if (e.key === 'Enter') { ctx.setScope(s.name); ctx.go('projects'); } }}>
      <header><Avatar name={s.name} /><div className="t"><b>{s.name}</b><span>{s.kind}</span></div><Health s={s} /></header>
      <Progress done={rm?.counts.done ?? 0} total={total} hue={hue} />
      <div className="line"><b>{rm ? `Roadmap ${rm.counts.done}/${total}` : 'No roadmap yet'}</b> · {s.next}</div>
      <footer>
        <span>{chats.length} chat{chats.length === 1 ? '' : 's'}</span>{waiting > 0 && <span style={{ color: 'var(--wait)' }}>· {waiting} waiting</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}><i className="dot" style={{ background: down ? 'var(--red)' : up ? 'var(--work)' : 'var(--dim)' }} />{down ? 'a site is down' : up ? 'live' : 'not live'}</span>
      </footer>
    </article>
  );
};

// ---- Today: the soul as a full page, only a HUD ----
export interface AskState {
  msgs: SoulMsg[];
  busy: boolean;
  onAsk: (q: string) => void;
  onClear: () => void;
  /** The Claude Code chat that answers (the soul's home), or null for offline answers. */
  home: { session: string; name: string | null } | null;
  onPick: (session: string | null) => void;
}
export const TodayHUD: React.FC<{ ctx: AppCtx; soul: React.ReactNode; badges: Partial<Record<View, [number, string]>>; ask: AskState; onSearch: () => void; onLock: () => void; update: boolean }> = ({ ctx, soul, badges, ask, onSearch, onLock, update }) => {
  const chats = ctx.chats.filter((c) => inScope(ctx, c.project));
  const waiting = chats.filter((c) => c.state === 'waiting'), working = chats.filter((c) => c.state === 'working');
  const crossing = liveAlerts(ctx.crossings, ctx.chats, ctx.scope).filter((a) => a.level === 'attend');
  const feed = ctx.feed.filter((f) => !ctx.scope || f.project === ctx.scope);
  const [q, setQ] = useState('');
  const t = ctx.snapshot?.totals;
  const ICONS: Record<FeedItem['kind'], [string, string]> = { split: ['⑂', 'var(--work)'], merge: ['↩', 'var(--done)'], ask: ['?', 'var(--wait)'], commit: ['●', 'var(--muted)'], site: ['!', 'var(--red)'], roadmap: ['▤', 'var(--accent)'], you: ['›', 'var(--text)'], reply: ['‹', 'var(--work)'], cross: ['⇄', 'var(--wait)'] };
  const row = (c: ChatItem) => (
    <button type="button" className="nowrow" key={c.id} onClick={() => ctx.openChat(c.id)}>
      <span className={`dot ${c.state === 'working' ? 'pulse' : ''}`} style={{ background: c.state === 'waiting' ? 'var(--wait)' : hueOf(c.project) }} />
      <span style={{ minWidth: 0 }}><span className="small" style={{ fontWeight: 500, display: 'block' }}>{chatName(c)}</span>
        <span className="tiny" style={{ color: c.state === 'waiting' ? 'var(--wait)' : 'var(--muted)' }}>{c.state === 'waiting' ? c.asked : c.doing ? `${c.doing.tool}${c.doing.detail ? ' · ' + c.doing.detail : ''}` : 'working'}</span>
        <span className="tiny dim" style={{ display: 'block' }}>{c.project}{recentSplits(c).filter((a) => a.status === 'running').length ? ` · ${recentSplits(c).filter((a) => a.status === 'running').length} split${recentSplits(c).filter((a) => a.status === 'running').length === 1 ? '' : 's'} running` : ''}</span></span>
    </button>
  );
  return (
    <section className="hud" aria-label="The soul">
      <div style={{ position: 'absolute', inset: 0 }}>{soul}</div>
      <header className="hud-top">
        <div className="hud-brand"><span className="hud-mark" /><b>REKA</b>
          <button type="button" className="hud-scope" onClick={onSearch} title="Choose a project (Ctrl+K)"><i className="dot" style={{ background: ctx.scope ? hueOf(ctx.scope) : 'var(--accent)' }} />{ctx.scope ?? 'All projects'}<span className="dim">▾</span></button></div>
        <nav className="hudnav" aria-label="Places">{VIEWS.map(([id, l]) => { const [n, k] = badges[id] ?? [0, '']; return <button type="button" key={id} className="hudnav-i" aria-current={id === 'today' ? 'page' : undefined} onClick={() => ctx.go(id)} title={l}>{Icon[id]}<span>{l}</span>{n > 0 && <span className={`nb ${k}`}>{n}</span>}</button>; })}</nav>
        <div className="hud-right">
          {update && <button type="button" className="update-btn" onClick={() => location.reload()}>Updated · Reload</button>}
          <div className="hud-m"><small>Tokens today</small><b>{t ? fmtTokens(t.tokensToday) : '—'}</b></div>
          <div className="hud-m"><small>Est. cost</small><b>{fmtCost(t?.costToday)}</b></div>
          <div className="hud-m" title="Open means active in the last 15 minutes"><small>Chats</small><b>{working.length} working · {chats.filter((c) => c.status !== 'idle').length} open</b></div>
          <button type="button" className="hud-btn" onClick={onSearch} title="Search or jump to (Ctrl+K)" aria-label="Search">{Icon.search}</button>
          <button type="button" className="hud-btn" onClick={onLock} title="Lock (Ctrl+Shift+L)" aria-label="Lock">{Icon.lock}</button>
        </div>
      </header>
      <aside className="hud-panel hud-left">
        <div className="label">Happening now</div>
        <div style={{ marginTop: 8 }}>
          {waiting.length > 0 && <><div className="label" style={{ color: 'var(--wait)', marginBottom: 6 }}>Waiting for you · {waiting.length}</div>{waiting.map(row)}</>}
          {crossing.length > 0 && <><div className="label" style={{ color: 'var(--wait)', margin: '12px 0 6px' }}>Crossings · {crossing.length}</div>{crossing.slice(0, 4).map((a) => (
            <button type="button" className="nowrow" key={a.id} onClick={() => ctx.go('crossings')}>
              <span className="dot pulse" style={{ background: 'var(--wait)' }} />
              <span style={{ minWidth: 0 }}><span className="small" style={{ fontWeight: 500, display: 'block' }}>{a.title}</span><span className="tiny" style={{ color: 'var(--muted)' }}>{a.text}</span></span>
            </button>))}</>}
          <div className="label" style={{ margin: '12px 0 6px' }}>Working · {working.length}</div>
          {working.length ? working.map(row) : <p className="small dim">No chat is working right now.</p>}
        </div>
      </aside>
      <aside className="hud-panel hud-right-panel">
        <div className="label" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="livedot" />Latest</div>
        <ol className="feed">
          {feed.length ? feed.slice(0, 16).map((f, i) => { const [ic, col] = ICONS[f.kind]; return (
            <li key={i} {...(f.chat ? { tabIndex: 0, onClick: () => ctx.openChat(f.chat!), 'data-chat': f.chat } : {})}>
              <span className="ficon" style={{ color: col, background: `color-mix(in srgb, ${col} 14%, transparent)` }}>{ic}</span>
              <div style={{ minWidth: 0 }}><div className="small">{f.text}</div><div className="tiny dim">{ago(f.at)} ago{f.project ? <> · <span style={{ color: hueOf(f.project) }}>{f.project}</span></> : null}</div></div>
            </li>); }) : <li className="small dim">Nothing in the last day.</li>}
        </ol>
      </aside>
      <div className="hud-bottom">
        {ask.msgs.length ? <SoulChat msgs={ask.msgs} hue={ctx.scope ? hueOf(ctx.scope) : '#34d399'} onClear={ask.onClear} title={ctx.scope ? `Soul of ${ctx.scope}` : 'The soul'} />
          : <div className="soulmurmur">{feed[0]?.text ?? ''}</div>}
        <form className="hud-ask" onSubmit={(e) => { e.preventDefault(); if (q.trim() && !ask.busy) { ask.onAsk(q.trim()); setQ(''); } }}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>{Icon.spark}</span>
          <label htmlFor="ask" className="sr">Ask the soul</label>
          <input id="ask" value={q} onChange={(e) => setQ(e.target.value)} placeholder={ask.busy ? 'The soul is answering…' : ctx.scope ? `Ask the soul of ${ctx.scope}…` : 'Ask the soul about any project…'} autoComplete="off" />
          <kbd>Enter</kbd>
        </form>
        <HomePicker chats={ctx.chats} home={ask.home} onPick={ask.onPick} />
      </div>
    </section>
  );
};

// ---- Chats: grouped by project (or by status), project chips, search, live splits ----
export const ChatsView: React.FC<{ ctx: AppCtx; topoMode: 'diagram' | 'board'; setTopoMode: (m: 'diagram' | 'board') => void }> = ({ ctx, topoMode, setTopoMode }) => {
  const [group, setGroup] = useState<'project' | 'status'>('project');
  const [q, setQ] = useState('');
  const [liveOpen, setLiveOpen] = useState(true);
  const [more, setMore] = useState<Set<string>>(new Set());
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = ctx.chats.filter((c) => inScope(ctx, c.project) && words.every((w) => `${chatName(c)} ${c.project} ${c.goal ?? ''} ${c.asked ?? ''}`.toLowerCase().includes(w)))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.lastActivity - a.lastActivity);
  const ids = list.map((c) => c.id);
  const projects = useMemo(() => {
    const names = [...new Set(ctx.chats.map((c) => c.project))];
    return names.map((n) => ({ n, chats: ctx.chats.filter((c) => c.project === n) }))
      .sort((a, b) => Math.min(...a.chats.map((c) => ORDER[c.state])) - Math.min(...b.chats.map((c) => ORDER[c.state])) || Math.max(...b.chats.map((c) => c.lastActivity)) - Math.max(...a.chats.map((c) => c.lastActivity)));
  }, [ctx.chats]);
  const live = list.filter((c) => recentSplits(c).length > 0).slice(0, 6);
  const splitFeed = ctx.feed.filter((f) => (f.kind === 'split' || f.kind === 'merge') && (!ctx.scope || f.project === ctx.scope)).slice(0, 7);
  return (
    <div className="view-in">
      <div className="head"><h1>Chats</h1><span className="s">{list.length} chats · {list.filter((c) => c.state === 'waiting').length} waiting for you · {list.filter((c) => c.state === 'working').length} working</span></div>
      <div className="chiprow" aria-label="Projects">
        <button type="button" className="fchip" aria-pressed={!ctx.scope} onClick={() => ctx.setScope(null)}>All <span>{ctx.chats.length}</span></button>
        {projects.map(({ n, chats }) => (
          <button key={n} type="button" className="fchip pchip" aria-pressed={ctx.scope === n} style={{ ['--hue' as string]: hueOf(n) }} onClick={() => ctx.setScope(ctx.scope === n ? null : n)}>
            <i className="dot" style={{ background: hueOf(n) }} />{n} <span>{chats.length}</span>{chats.some((c) => c.state === 'waiting') && <i className="dot" style={{ background: 'var(--wait)', width: 6, height: 6 }} title="waiting for you" />}
          </button>
        ))}
      </div>
      <div className="invbar">
        <div className="search"><span className="dim">{Icon.search}</span><label htmlFor="chatq" className="sr">Find a chat</label><input id="chatq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a chat by name, project or question" autoComplete="off" /></div>
        <div className="seg" role="group" aria-label="Group chats"><button type="button" aria-pressed={group === 'project'} onClick={() => setGroup('project')}>By project</button><button type="button" aria-pressed={group === 'status'} onClick={() => setGroup('status')}>By status</button></div>
      </div>

      {live.length > 0 && (liveOpen ? (
        <section className="glass livetopo">
          <div className="lt-head"><span className="livedot" /><b>Live splits</b><span className="tiny muted">chats that split work across models in the last day, and what merged back</span>
            <span className="legend"><i style={{ ['--c' as string]: MODEL_C.opus }} />Opus<i style={{ ['--c' as string]: MODEL_C.sonnet }} />Sonnet<i style={{ ['--c' as string]: MODEL_C.haiku }} />Haiku<i className="back" />merged</span>
            <span className="seg" role="group" aria-label="Show splits as"><button type="button" aria-pressed={topoMode === 'diagram'} onClick={() => setTopoMode('diagram')}>Diagram</button><button type="button" aria-pressed={topoMode === 'board'} onClick={() => setTopoMode('board')}>Board</button></span>
            <button type="button" className="collapse" onClick={() => setLiveOpen(false)}>Hide</button></div>
          <div className={`lt-body ${topoMode === 'board' ? 'wide' : ''}`}>
            {topoMode === 'board' ? <SplitBoard chats={live} onOpen={(id) => ctx.openChat(id, ids)} />
              : <div className="clusters">{live.map((c) => (
                <button type="button" key={c.id} className="cluster" onClick={() => ctx.openChat(c.id, ids)}><Topology chat={c} />
                  <div className="small" style={{ fontWeight: 500 }}>{chatName(c)}</div>
                  <div className="tiny muted">{c.project} · {recentSplits(c).length} splits · <span style={{ color: 'var(--work)' }}>{recentSplits(c).filter((a) => a.status === 'running').length} running</span> · <span style={{ color: 'var(--done)' }}>{recentSplits(c).filter((a) => a.status === 'returned').length} merged</span></div>
                </button>))}</div>}
            <ol className="eventlog">{splitFeed.length ? splitFeed.map((f, i) => <li key={i}><span className="dim">{ago(f.at)}</span><span>{f.text}</span></li>) : <li><span /><span className="dim">No splits in the last day.</span></li>}</ol>
          </div>
        </section>
      ) : (
        <button type="button" className="glass banner" onClick={() => setLiveOpen(true)} style={{ width: '100%', marginBottom: 18, borderColor: 'var(--outline)' }}><span className="livedot" /><b style={{ fontWeight: 600 }}>Live splits</b><span className="small muted" style={{ flex: 1, textAlign: 'left' }}>{live.length} chats split work across models in the last day</span><span className="collapse">Show</span></button>
      ))}

      {group === 'status' ? (
        <div className="kcols3">{([['waiting', 'Waiting for you', 'var(--wait)'], ['working', 'Working', 'var(--work)'], ['idle', 'Recent', 'var(--dim)']] as const).map(([st, label, col]) => {
          const cs = list.filter((c) => c.state === st);
          return <div key={st}><div className="colhead"><span className="dot" style={{ background: col }} />{label}<span className="count">{cs.length}</span></div>{cs.map((c) => <ChatCard key={c.id} c={c} ctx={ctx} list={ids} />)}{!cs.length && <p className="small dim" style={{ marginLeft: 4 }}>Nothing here.</p>}</div>;
        })}</div>
      ) : (
        projects.filter(({ n }) => list.some((c) => c.project === n)).map(({ n }) => {
          const cs = list.filter((c) => c.project === n), s = ctx.statusOf(n), open = more.has(n), shown = open ? cs : cs.slice(0, 6);
          return (
            <section key={n} className="projgroup" style={{ ['--hue' as string]: hueOf(n) }}>
              <div className="projgroup-h">
                <Avatar name={n} /><div style={{ minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 16 }}>{n}</div><div className="tiny muted">{cs.length} chat{cs.length === 1 ? '' : 's'}{cs.filter((c) => c.state === 'waiting').length ? <span style={{ color: 'var(--wait)' }}> · {cs.filter((c) => c.state === 'waiting').length} waiting</span> : null}{cs.filter((c) => c.state === 'working').length ? <span style={{ color: 'var(--work)' }}> · {cs.filter((c) => c.state === 'working').length} working</span> : null}</div></div>
                <Health s={s} />{s && !s.roadmap && <span className="rm-chip none">no roadmap</span>}
                {s && <button type="button" className="collapse" style={{ marginLeft: 'auto' }} onClick={() => { ctx.setScope(n); ctx.go('projects'); }}>Open project</button>}
              </div>
              <div className="ugrid">{shown.map((c) => <ChatCard key={c.id} c={c} ctx={ctx} list={ids} showProject={false} />)}</div>
              {cs.length > 6 && <button type="button" className="collapse" style={{ marginTop: 8 }} onClick={() => setMore((m) => { const x = new Set(m); if (x.has(n)) x.delete(n); else x.add(n); return x; })}>{open ? 'Show fewer' : `Show ${cs.length - 6} more`}</button>}
            </section>
          );
        })
      )}
      {!list.length && <div className="glass empty">No chat matches “{q}”.</div>}
    </div>
  );
};

// ---- Tasks ----
const SRC_LABEL: Record<TaskItem['src'], string> = { roadmap: 'Roadmap', plan: 'Chat plan', soul: 'Soul suggests' };
const TaskCard: React.FC<{ t: TaskItem; ctx: AppCtx }> = ({ t, ctx }) => {
  const c = t.chat ? ctx.chats.find((x) => x.id === t.chat) : null;
  return (
    <article className="glass task" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => ctx.openTask(t.id)} onKeyDown={(e) => { if (e.key === 'Enter') ctx.openTask(t.id); }}>
      <div className="task-top"><Avatar name={t.project} size="sm" /><span className="tiny" style={{ color: hueOf(t.project) }}>{t.project}</span>
        {c && recentSplits(c).length > 0 && <span className="srcpill s-split">split ×{recentSplits(c).length}</span>}
        <span className={`srcpill s-${t.src}`}>{SRC_LABEL[t.src]}{t.ref ? ` · ${t.ref}` : ''}</span></div>
      <div className="task-title">{t.title}</div>
      {t.why && t.src === 'soul' && <div className="tiny muted">{t.why}{t.saving ? ` · saves ≈ $${t.saving.toFixed(2)}` : ''}</div>}
      <div className="task-foot">
        <span className="model" style={{ ['--m' as string]: MODEL_C[t.model] }}>{t.model}</span><span className="tiny muted">{t.where}</span>
        {t.owner && <span className="tiny dim">· {t.owner}</span>}{t.due && <span className="tiny dim">· {t.due}</span>}
      </div>
    </article>
  );
};
export const TasksView: React.FC<{ ctx: AppCtx; project?: string }> = ({ ctx, project }) => {
  const [src, setSrc] = useState<'all' | TaskItem['src']>('all');
  const [mode, setMode] = useState<'board' | 'list'>('board');
  const [more, setMore] = useState(false);
  const p = project ?? ctx.scope;
  const base = ctx.tasks.filter((t) => !p || t.project === p);
  const list = base.filter((t) => src === 'all' || t.src === src);
  const cheap = list.filter((t) => t.status === 'todo' && t.model !== 'opus' && t.where !== 'this chat');
  const cols: [TaskItem['status'], string, string][] = [['todo', 'To do', 'var(--muted)'], ['doing', 'In progress', 'var(--work)'], ['blocked', 'Blocked', 'var(--wait)'], ['done', 'Done', 'var(--done)']];
  const cap = more ? 400 : 12;
  return (
    <div className={project ? '' : 'view-in'}>
      {!project && <div className="head"><h1>Tasks</h1><span className="s">{p ?? 'every project'} · from roadmaps, chat plans and the soul’s suggestions</span></div>}
      {cheap.length > 0 && <div className="glass suggest"><Avatar name="✦" size="sm" /><div className="small"><b>{cheap.length} task{cheap.length === 1 ? '' : 's'} could run on cheaper models now</b><span className="muted"> · {cheap.slice(0, 2).map((t) => t.title).join(' · ')}{cheap.length > 2 ? ' …' : ''}</span></div></div>}
      <div className="chiprow">
        {(['all', 'roadmap', 'plan', 'soul'] as const).map((s) => <button key={s} type="button" className="fchip" aria-pressed={src === s} onClick={() => setSrc(s)}>{s === 'all' ? 'All' : SRC_LABEL[s]} <span>{base.filter((t) => s === 'all' || t.src === s).length}</span></button>)}
        <span style={{ marginLeft: 'auto' }} className="seg" role="group" aria-label="View"><button type="button" aria-pressed={mode === 'board'} onClick={() => setMode('board')}>Board</button><button type="button" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>List</button></span>
      </div>
      {mode === 'list' ? (
        <div className="glass scroll"><table><thead><tr><th>Task</th><th>Project</th><th>From</th><th>Status</th><th>Model · where</th><th>Owner</th><th>Due</th></tr></thead><tbody>
          {list.slice(0, 300).map((t) => <tr key={t.id} onClick={() => ctx.openTask(t.id)} style={{ cursor: 'pointer' }}><td>{t.title}</td><td style={{ color: hueOf(t.project) }}>{t.project}</td><td className="muted">{SRC_LABEL[t.src]}{t.ref ? ` · ${t.ref}` : ''}</td><td><span className={`pill ${t.status === 'doing' ? 'p-work' : t.status === 'blocked' ? 'p-wait' : t.status === 'done' ? 'p-done' : 'p-idle'}`}>{{ todo: 'to do', doing: 'in progress', blocked: 'blocked', done: 'done' }[t.status]}</span></td><td><span className="model" style={{ ['--m' as string]: MODEL_C[t.model] }}>{t.model}</span> <span className="tiny muted">{t.where}</span></td><td className="muted">{t.owner ?? '—'}</td><td className="muted">{t.due ?? '—'}</td></tr>)}
        </tbody></table></div>
      ) : (
        <>
          <div className="kanban">{cols.map(([s, l, c]) => { const ts = list.filter((t) => t.status === s); return (
            <div className="kcol" key={s}><h2><span className="dot" style={{ background: c }} />{l} <span className="count">{ts.length}</span></h2>{ts.slice(0, cap).map((t) => <TaskCard key={t.id} t={t} ctx={ctx} />)}{!ts.length && <p className="small dim" style={{ padding: '4px 2px' }}>Nothing here.</p>}{ts.length > cap && <p className="tiny dim" style={{ padding: '4px 2px' }}>+{ts.length - cap} more</p>}</div>); })}</div>
          {list.length > 48 && <button type="button" className="collapse" style={{ marginTop: 10 }} onClick={() => setMore((m) => !m)}>{more ? 'Show fewer' : 'Show every task'}</button>}
        </>
      )}
    </div>
  );
};

// ---- Projects: the list, or one project's page ----
export const ProjectsView: React.FC<{ ctx: AppCtx }> = ({ ctx }) => {
  if (ctx.scope) {
    const s = ctx.statusOf(ctx.scope);
    if (s) return <Overview s={s} ctx={ctx} />;
  }
  return (
    <div className="view-in">
      <div className="head"><h1>Projects</h1><span className="s">{ctx.status.length} projects · open one to see everything about it</span></div>
      {!ctx.status.length && <div className="ugrid"><div className="skel" /><div className="skel" /><div className="skel" /></div>}
      <div className="ugrid">{ctx.status.map((s) => <ProjectCard key={s.name} s={s} ctx={ctx} />)}</div>
    </div>
  );
};
const Overview: React.FC<{ s: ProjectStatus; ctx: AppCtx }> = ({ s, ctx }) => {
  const hue = hueOf(s.name), chats = ctx.chats.filter((c) => c.project === s.name);
  const waiting = chats.filter((c) => c.state === 'waiting'), blocked = ctx.tasks.filter((t) => t.project === s.name && t.status === 'blocked').slice(0, 6);
  const ids = chats.map((c) => c.id), rm = s.roadmap;
  const live = s.live.find((l) => l.ok && !l.staging) ?? s.live[0];
  return (
    <div className="view-in">
      <section className="glass ov-head">
        <Avatar name={s.name} size="lg" />
        <div><div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{s.name}</h1><Health s={s} /></div>
          <div className="small muted" style={{ marginTop: 4 }}>{s.kind} · {chats.length} chats · {s.repos.length} repos{live ? <> · <a href={live.url.startsWith('http') ? live.url : `https://${live.url}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{live.url}</a></> : ''}</div></div>
        <div className="ov-grid"><StageTrack s={s} /><ReadinessTrack s={s} /><div><div className="label">Next</div><div className="small" style={{ marginTop: 6 }}>{s.next}</div></div></div>
      </section>
      {(!rm || rm.kind === 'plan') && chats[0] && (
        <div className="glass banner" style={{ marginTop: 14 }}><span className="rm-chip none">No roadmap</span><span className="small" style={{ flex: 1 }}>{s.name} has no docs/ROADMAP.md yet. A chat in this project can draft one from its plans.</span><button type="button" className="btn primary" onClick={() => ctx.askRoadmap(chats[0].id)}>Ask “{chatName(chats[0])}” to write it</button></div>
      )}
      {(waiting.length > 0 || blocked.length > 0) && <><div className="section-h"><h2>Needs you</h2></div><div className="ugrid">{waiting.map((c) => <ChatCard key={c.id} c={c} ctx={ctx} list={ids} showProject={false} />)}{blocked.map((t) => <TaskCard key={t.id} t={t} ctx={ctx} />)}</div></>}
      <div className="section-h"><h2>Chats</h2><span className="tiny muted">{chats.length}</span><button type="button" className="collapse" onClick={() => ctx.go('chats')}>See all in Chats</button></div>
      <div className="ugrid">{chats.slice(0, 6).map((c) => <ChatCard key={c.id} c={c} ctx={ctx} list={ids} showProject={false} />)}{!chats.length && <p className="small dim">No Claude Code chats in this project in 30 days.</p>}</div>
      {rm && <>
        <div className="section-h"><h2>Roadmap</h2><span className="tiny muted">{rm.repo}/{rm.file} · {rm.counts.done} done · {rm.counts.inProgress} in progress · {rm.counts.blocked} blocked{rm.updated ? ` · changed ${ago(rm.updated)} ago` : ''}</span></div>
        <div className="horizons">{rm.sections.slice(0, 6).map((sec) => (
          <div key={sec.order} className="glass horizon" style={sec.state === 'in progress' ? { borderColor: `${hue}88` } : undefined}>
            <div className="small" style={{ fontWeight: 600 }}>{sec.title}</div>
            <div className="tiny" style={{ color: sec.state === 'in progress' ? hue : 'var(--muted)', marginBottom: 6 }}>{sec.state}{sec.items.length ? ` · ${sec.items.filter((i) => i.state !== 'done').length} of ${sec.items.length} open` : ''}</div>
            {sec.items.slice(0, 7).map((i) => <div key={i.key} className="item" title={[i.status, i.owner, i.due].filter(Boolean).join(' · ')}><span style={{ color: i.state === 'done' ? 'var(--done)' : i.state === 'blocked' ? 'var(--red)' : i.state === 'in progress' ? 'var(--wait)' : 'var(--muted)' }}>{i.state === 'done' ? '✓' : i.state === 'blocked' ? '!' : i.state === 'in progress' ? '▸' : '·'}</span><span>{i.id ? `${i.id} ` : ''}{i.title}</span></div>)}
            {sec.items.length > 7 && <div className="tiny dim">+{sec.items.length - 7} more</div>}
          </div>))}</div>
      </>}
      <div className="section-h"><h2>Tasks</h2></div>
      <TasksView ctx={ctx} project={s.name} />
      <div className="section-h"><h2>Repos</h2></div>
      <div className="glass scroll"><table><thead><tr><th>Repo</th><th>Stage</th><th>Branch</th><th>Local</th><th>Commits (30d)</th><th>Last commit</th><th>Tag</th></tr></thead><tbody>
        {s.repos.map((r) => <tr key={r.name}><td>{r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>{r.name}</a> : r.name}</td><td className="muted">{r.step ?? '—'}</td><td className="muted">{r.branch ?? '—'}</td><td style={{ color: r.dirty || r.ahead ? 'var(--wait)' : 'var(--dim)' }}>{r.dirty ? `${r.dirty} uncommitted` : ''}{r.dirty && r.ahead ? ' · ' : ''}{r.ahead ? `${r.ahead} unpushed` : ''}{!r.dirty && !r.ahead ? 'clean' : ''}</td><td>{r.commits} ({r.commits30d})</td><td className="muted" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.lastCommit ? `${ago(r.lastCommit.date)} · ${r.lastCommit.subject}` : '—'}</td><td className="muted">{r.tag?.tag ?? '—'}</td></tr>)}
      </tbody></table></div>
    </div>
  );
};

// ---- Inventory ----
const CATS: [InventoryCategory, string][] = [['service', 'Tools'], ['apikey', 'API keys'], ['api', 'APIs called'], ['hosting', 'Hosting'], ['domain', 'Domains'], ['email', 'E-mails'], ['signin', 'Sign-in'], ['job', 'Jobs'], ['default', 'Defaults']];
interface Row { project: string; repo: string; f: InventoryFact; svc: string; flag: string | null }
const serviceOf = (f: InventoryFact) => {
  const v = f.category === 'apikey' || f.category === 'api' ? f.value : f.label;
  const m = /^([A-Z][\w.]*(?:\s[A-Z][\w.]*)?)/.exec(v.replace(/^Unknown.*/, 'Unknown'));
  return m ? m[1].replace(/\s(Worker|route|binding|static|app|Hosting|local|Edge|Compose).*$/i, '') : f.category;
};
export const InventoryView: React.FC<{ ctx: AppCtx; onDoc: (kind: 'access-register' | 'rotation', arg: string) => void }> = ({ ctx, onDoc }) => {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<'all' | InventoryCategory>('all');
  const [group, setGroup] = useState<'project' | 'service'>('project');
  const changes = usePoll<{ report: { repos: { project: string; repo: string; added: InventoryFact[]; removed: InventoryFact[] }[]; firstRun: boolean } }>(`/api/inventory/changes?days=7${ctx.scope ? `&project=${encodeURIComponent(ctx.scope)}` : ''}`, 60000);
  const inv = ctx.inventory;
  const rows: Row[] = useMemo(() => {
    if (!inv) return [];
    const out: Row[] = [];
    for (const g of inv.groups) for (const id of g.repos) {
      const r = inv.projects.find((p) => p.id === id); if (!r) continue;
      for (const f of r.facts) if (f.category !== 'env' && f.category !== 'register') out.push({ project: g.name, repo: r.name, f, svc: serviceOf(f), flag: /^Unknown/.test(f.value) ? 'unknown key' : /•••/.test(f.value) ? 'personal address' : /tests only/i.test(f.value) ? 'tests only' : null });
    }
    return out;
  }, [inv]);
  const all = rows.filter((r) => !ctx.scope || r.project === ctx.scope);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = all.filter((r) => (cat === 'all' || r.f.category === cat) && words.every((w) => `${r.project} ${r.repo} ${r.f.label} ${r.f.value} ${r.svc} ${r.f.evidence.join(' ')}`.toLowerCase().includes(w)));
  const count = (c: InventoryCategory) => all.filter((r) => r.f.category === c).length;
  const attention = all.filter((r) => r.flag);
  const keyRepos = new Map<string, Set<string>>();
  for (const r of all) if (r.f.category === 'apikey') { const s = keyRepos.get(r.f.label) ?? new Set(); s.add(r.repo); keyRepos.set(r.f.label, s); }
  const shared = [...keyRepos].filter(([, s]) => s.size > 2);
  const factRow = (r: Row, showProject: boolean, i: number) => (
    <div className="fact" key={`${r.repo}:${r.f.label}:${r.f.value}:${i}`}>
      <span className={`cat-dot c-${r.f.category}`} title={CATS.find((c) => c[0] === r.f.category)?.[1]} />
      <div style={{ minWidth: 0 }}><div className="fact-label">{r.f.label}{r.flag && <span className="pill p-wait" style={{ marginLeft: 6 }}>{r.flag}</span>}</div><div className="tiny muted">{r.f.value}{showProject ? <> · <span style={{ color: hueOf(r.project) }}>{r.project}</span></> : null}</div></div>
      <span className="code dim fact-ev" title={r.f.evidence.join(', ')}>{r.repo}/{r.f.evidence[0] ?? ''}</span>
      {r.f.category === 'apikey' ? <button type="button" className="ghost" onClick={() => onDoc('rotation', r.f.label)}>Rotation</button> : <span />}
    </div>
  );
  const groups = group === 'service'
    ? [...new Set(shown.map((r) => r.svc))].sort((a, b) => shown.filter((r) => r.svc === b).length - shown.filter((r) => r.svc === a).length).map((k) => ({ key: k, rows: shown.filter((r) => r.svc === k) }))
    : [...new Set(shown.map((r) => r.project))].map((k) => ({ key: k, rows: shown.filter((r) => r.project === k) }));
  return (
    <div className="view-in">
      <div className="head"><h1>Inventory</h1><span className="s">{ctx.scope ?? 'every project'} · tools, keys by name, APIs, hosting, addresses, sign-in, jobs · secret values are never read{inv?.scanning ? ' · scanning…' : ''}</span></div>
      <div className="tiles">
        <div className="glass tile"><small>API keys (names)</small><b>{count('apikey')}</b></div>
        <div className="glass tile"><small>Outside APIs</small><b>{count('api')}</b></div>
        <div className="glass tile"><small>Hosting and domains</small><b>{count('hosting') + count('domain')}</b></div>
        <div className="glass tile"><small>E-mail addresses</small><b>{count('email')}</b></div>
        <div className="glass tile warn"><small>Needs a look</small><b>{attention.length + shared.length}</b></div>
      </div>
      <div className="invbar">
        <div className="search"><span className="dim">{Icon.search}</span><label htmlFor="invq" className="sr">Search the inventory</label><input id="invq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: resend, gemini, noreply, cron…" autoComplete="off" /></div>
        <div className="seg" role="group" aria-label="Group by"><button type="button" aria-pressed={group === 'project'} onClick={() => setGroup('project')}>By project</button><button type="button" aria-pressed={group === 'service'} onClick={() => setGroup('service')}>By service</button></div>
      </div>
      <div className="chiprow"><button type="button" className="fchip" aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All <span>{all.length}</span></button>{CATS.filter(([c]) => count(c)).map(([c, l]) => <button key={c} type="button" className="fchip" aria-pressed={cat === c} onClick={() => setCat(c)}><i className={`cat-dot c-${c}`} />{l} <span>{count(c)}</span></button>)}</div>
      <div className="invgrid">
        <div>
          {!inv && <div className="skel" />}
          {groups.slice(0, 40).map(({ key, rows: gr }) => {
            const repos = [...new Set(gr.map((r) => r.repo))];
            return (
              <section key={key} className="glass invcard">
                <div className="invhead"><Avatar name={group === 'service' ? key : key} /><div><div className="pname" style={{ fontSize: 15 }}>{key}</div>
                  <div className="tiny muted">{group === 'service' ? `used by ${[...new Set(gr.map((r) => r.project))].join(', ')}` : `${repos.length} repo${repos.length === 1 ? '' : 's'} · ${gr.length} facts`}</div></div>
                  {group === 'project' && <button type="button" className="ghost" style={{ marginLeft: 'auto' }} onClick={() => onDoc('access-register', key)}>Access Register</button>}</div>
                {group === 'project' ? repos.map((rp) => <React.Fragment key={rp}><div className="tiny dim repo-sub">{rp}</div>{gr.filter((r) => r.repo === rp).slice(0, 60).map((r, i) => factRow(r, false, i))}</React.Fragment>)
                  : gr.slice(0, 40).map((r, i) => factRow(r, true, i))}
              </section>
            );
          })}
          {inv && !shown.length && <div className="glass empty">Nothing matches “{q}”.</div>}
        </div>
        <aside>
          <section className="glass box"><div className="label">Needs a look</div>
            {attention.slice(0, 12).map((r, i) => <div key={i} className="side-row"><span className="pill p-wait">{r.flag}</span><div className="small">{r.f.label} <span className="dim">· {r.project}</span></div></div>)}
            {shared.slice(0, 8).map(([k, s]) => <div key={k} className="side-row"><span className="pill p-idle">in {s.size} repos</span><div className="small">{k} <span className="dim">· rotate together</span></div></div>)}
            {!attention.length && !shared.length && <p className="small dim">Nothing stands out.</p>}
          </section>
          <section className="glass box"><div className="label">Changes this week</div>
            {changes?.report.firstRun && <p className="small dim">The first snapshot was saved recently; changes show from the second day.</p>}
            {(changes?.report.repos ?? []).slice(0, 10).map((c) => <div key={c.project + c.repo} className="side-row"><span className="plus">{c.added.length ? '+' : '−'}</span><div className="small">{c.repo}: {c.added.length} added, {c.removed.length} removed<div className="tiny dim">{c.project}</div></div></div>)}
            {changes && !changes.report.firstRun && !changes.report.repos.length && <p className="small dim">No changes.</p>}
          </section>
          <section className="glass box"><div className="label">Documents</div>
            <button type="button" className="doc" onClick={() => onDoc('access-register', ctx.scope ?? (ctx.status[0]?.name ?? ''))}>Access and Account Register{ctx.scope ? '' : ` (${ctx.status[0]?.name ?? 'a project'})`}</button>
            <button type="button" className="doc" onClick={() => onDoc('rotation', 'RESEND_API_KEY')}>Key rotation checklist (RESEND_API_KEY)</button>
          </section>
        </aside>
      </div>
    </div>
  );
};
