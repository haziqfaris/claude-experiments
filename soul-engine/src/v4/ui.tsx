// Small shared pieces for v4: icons, avatars, status chips, progress, and the live splits diagram and board.
import React from 'react';
import type { ChatItem, FlowAgent, ProjectStatus } from '../types';
import { hueOf } from '../projects';
import { ago } from '../format';

export const LADDER = ['not live', 'up, not the app', 'preview', 'internal testing', 'pilot / UAT', 'ready to use', 'in use'];
export const LADDER_C = ['#6b7280', '#ff6b6b', '#c792ff', '#ffb347', '#ffe14d', '#7cff6b', '#4dffe1'];
export const STAGES = ['Spot', 'Shape', 'Agree', 'Pin down', 'Prove', 'Translate', 'Build', 'Deliver', 'Grow'];
export const MODEL_C: Record<string, string> = { opus: '#c4b5fd', sonnet: '#93c5fd', haiku: '#5eead4' };

const svg = (d: React.ReactNode, size = 19) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
export const Icon = {
  today: svg(<><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="8.5" strokeDasharray="3 3" /></>),
  chats: svg(<path d="M4 5h16v11H9l-5 4z" />),
  tasks: svg(<><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8.5 12.5l2.5 2.5 4.5-5" /></>),
  projects: svg(<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />),
  inventory: svg(<><path d="M4 8l8-4 8 4-8 4z" /><path d="M4 8v8l8 4 8-4V8" /><path d="M12 12v8" /></>),
  search: svg(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>, 17),
  lock: svg(<><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>, 16),
  close: svg(<path d="M6 6l12 12M18 6L6 18" />, 18),
  prev: svg(<path d="M15 6l-6 6 6 6" />, 18),
  next: svg(<path d="M9 6l6 6-6 6" />, 18),
  spark: <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor" aria-hidden="true"><path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" /></svg>,
};

export const Avatar: React.FC<{ name: string; size?: 'sm' | 'md' | 'lg' }> = ({ name, size = 'md' }) => (
  <span className={`avatar ${size === 'sm' ? 'sm' : ''}`} style={{ ['--hue' as string]: hueOf(name), ...(size === 'lg' ? { width: 52, height: 52, fontSize: 20 } : {}) }}>{(name.trim()[0] ?? '?').toUpperCase()}</span>
);

export const Health: React.FC<{ s: ProjectStatus | null | undefined }> = ({ s }) => {
  if (!s) return null;
  const c = LADDER_C[s.readiness.rank];
  return <span className="health" style={{ ['--h' as string]: c }}>{s.stage ? `${s.stage.step} ${s.stage.name} · ` : ''}{s.readiness.level}</span>;
};

export const StatePill: React.FC<{ state: ChatItem['state'] }> = ({ state }) =>
  state === 'working' ? <span className="pill p-work">working</span> : state === 'waiting' ? <span className="pill p-wait">waiting for you</span> : <span className="pill p-idle">idle</span>;

export const Progress: React.FC<{ done: number; total: number; hue: string }> = ({ done, total, hue }) => (
  <div className="bar">{total > 0 && <i style={{ width: `${Math.round((done / total) * 100)}%`, background: hue }} />}</div>
);

export const StageTrack: React.FC<{ s: ProjectStatus }> = ({ s }) => {
  const hue = hueOf(s.name), cur = s.stage ? Number(s.stage.step) : 0;
  return (
    <div>
      <div className="track">{STAGES.map((n, i) => <span key={n} title={`0${i + 1} ${n}`} style={{ background: i + 1 < cur ? `${hue}88` : i + 1 === cur ? hue : undefined }} />)}</div>
      <div className="small" style={{ marginTop: 6 }}>{s.stage ? <><span style={{ color: hue }}>{s.stage.step} {s.stage.name}</span> <span className="dim">· {s.stage.source === 'set' ? 'set by you' : 'estimated'}</span></> : <span className="dim">stage unknown</span>}</div>
    </div>
  );
};

export const ReadinessTrack: React.FC<{ s: ProjectStatus }> = ({ s }) => {
  const c = LADDER_C[s.readiness.rank];
  return (
    <div>
      <div className="track">{LADDER.map((l, i) => <span key={l} style={{ background: i <= s.readiness.rank ? `${c}${i === s.readiness.rank ? '' : '77'}` : undefined }} />)}</div>
      <div className="small" style={{ marginTop: 6 }}><span style={{ color: c }}>{s.readiness.level}</span> <span className="dim">· {s.readiness.source === 'verdict' ? 'your verdict' : s.readiness.source === 'set' ? 'set by you' : s.readiness.source === 'live check' ? 'live check' : 'from stage'}</span></div>
      {s.readiness.verdict && <div className="tiny muted">“{s.readiness.verdict.text}”</div>}
    </div>
  );
};

export const modelOf = (m: string | null | undefined): 'opus' | 'sonnet' | 'haiku' => (m && /haiku/i.test(m) ? 'haiku' : m && /sonnet/i.test(m) ? 'sonnet' : 'opus');
export const chatName = (c: ChatItem) => c.name ?? c.title;
export const since = (ts: number) => (Date.now() - ts < 90_000 ? 'active now' : `${ago(ts)} ago`);

/** Splits worth showing: started in the last day, newest first. */
export const recentSplits = (c: ChatItem) => c.agents.filter((a) => Date.now() - a.startedAt < 86_400_000).slice(0, 8);
const splitState = (a: FlowAgent) => (a.status === 'running' ? 'running' : a.status === 'returned' ? 'returned' : 'stopped');

/** The main chat in the middle, each split around it: lines flow out while running and back when merged. */
export const Topology: React.FC<{ chat: ChatItem; big?: boolean }> = ({ chat, big }) => {
  const kids = recentSplits(chat), hue = hueOf(chat.project);
  const W = big ? 760 : 380, H = big ? 360 : 230, cx = W / 2, cy = H / 2, R = big ? 150 : 92, n = Math.max(1, kids.length);
  const nodeR = big ? 30 : 20, mainR = big ? 40 : 27, lim = big ? 120 : 62, max = big ? 30 : 18;
  const pos = kids.map((_, i) => { const a = -Math.PI / 2 + (Math.PI * 2 * (i + 0.5)) / n; return [cx + Math.cos(a) * R * (big ? 1.9 : 1.3), cy + Math.sin(a) * R * (big ? 0.85 : 0.8)]; });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="topo" role="img" aria-label={`${chatName(chat)} split its work ${kids.length} ways`}>
      {kids.map((k, i) => {
        const [x, y] = pos[i], st = splitState(k), col = st === 'returned' ? 'var(--done)' : st === 'stopped' ? 'var(--dim)' : MODEL_C[modelOf(k.model)];
        return <path key={k.id + 'e'} d={`M${cx},${cy} Q${(cx + x) / 2},${(cy + y) / 2 - (big ? 30 : 16)} ${x},${y}`} className={`edge ${st === 'running' ? 'run' : st === 'returned' ? 'back' : 'queued'}`} style={{ ['--c' as string]: col }} />;
      })}
      <circle cx={cx} cy={cy} r={mainR + 10} style={{ fill: hue, opacity: 0.08 }} />
      <circle cx={cx} cy={cy} r={mainR} style={{ fill: `color-mix(in srgb, ${hue} 22%, #0e1626)`, stroke: hue, strokeWidth: 2 }} />
      <text x={cx} y={cy - 2} textAnchor="middle" className="tmain">{modelOf(chat.model)}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" className="tsub" style={{ fill: hue }}>main chat</text>
      {kids.map((k, i) => {
        const [x, y] = pos[i], m = modelOf(k.model), col = MODEL_C[m], st = splitState(k);
        const lx = Math.min(Math.max(x, lim), W - lim), ly = y + nodeR + (big ? 18 : 13);
        const label = k.label.length > max ? k.label.slice(0, max - 1) + '…' : k.label;
        return (
          <g key={k.id} className={`tnode ${st === 'running' ? 'running' : st === 'returned' ? 'returned' : 'queued'}`}>
            <circle cx={x} cy={y} r={nodeR} style={{ fill: `color-mix(in srgb, ${col} 16%, #0e1626)`, stroke: st === 'returned' ? 'var(--done)' : col }} />
            <text x={x} y={y + 4} textAnchor="middle" className="tmodel" style={{ fill: col }}>{m}</text>
            {st === 'running' && <circle cx={x} cy={y} r={nodeR + 6} className="ring" style={{ stroke: col }} />}
            <text x={lx} y={ly} textAnchor="middle" className="tlabel">{label}</text>
            {big && <text x={lx} y={ly + 15} textAnchor="middle" className="tsub">{k.agentType ?? k.kind} · {st === 'returned' ? 'merged ↩' : st}</text>}
          </g>
        );
      })}
    </svg>
  );
};

const COLS: [string, string, string][] = [['running', 'Running', 'var(--work)'], ['returned', 'Merged back', 'var(--done)'], ['stopped', 'Stopped', 'var(--dim)']];
export const SplitBoard: React.FC<{ chats: ChatItem[]; onOpen: (id: string) => void }> = ({ chats, onOpen }) => (
  <div className="sboard">
    <div className="srow shead"><span />{COLS.map(([k, l, c]) => <span key={k} className="label" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><i className="dot" style={{ background: c }} />{l}</span>)}</div>
    {chats.map((c) => (
      <div className="srow" key={c.id}>
        <button type="button" className="slane" onClick={() => onOpen(c.id)}><Avatar name={c.project} size="sm" /><span style={{ minWidth: 0 }}><span className="small" style={{ fontWeight: 500, display: 'block' }}>{chatName(c)}</span><span className="tiny muted">{c.project} · {modelOf(c.model)} main chat</span></span></button>
        {COLS.map(([k]) => {
          const ks = recentSplits(c).filter((a) => splitState(a) === k);
          return (
            <div className="scell" key={k}>
              {ks.length ? ks.map((a) => (
                <div key={a.id} className={`scard ${k === 'stopped' ? 'queued' : k}`} style={{ ['--m' as string]: MODEL_C[modelOf(a.model)] }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span className="model" style={{ ['--m' as string]: MODEL_C[modelOf(a.model)] }}>{modelOf(a.model)}</span><span className="tiny muted">{a.agentType ?? a.kind}{a.background ? ' · background' : ''}</span></div>
                  <div className="small" style={{ fontWeight: 500, marginTop: 4 }}>{a.label}</div>
                  <div className="tiny dim">{k === 'returned' ? `merged ↩ · ${a.cost != null ? '$' + a.cost.toFixed(2) : ''}` : k === 'running' ? `running · ${ago(a.startedAt)}` : a.status}</div>
                </div>
              )) : <span className="tiny dim">—</span>}
            </div>
          );
        })}
      </div>
    ))}
  </div>
);
