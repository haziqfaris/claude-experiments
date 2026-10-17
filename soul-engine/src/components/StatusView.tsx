import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, FileText, GitCommit, Globe, RefreshCw, Tag } from 'lucide-react';
import { FlowGraph, ProjectStatus, Readiness, RoadmapChanges, RoadmapItemState, RoadmapSection } from '../types';
import { DashProject, hueOf, KIND_LABEL } from '../projects';
import { ago, fmtCost, fmtTokens } from '../format';

const STEPS = [
  ['01', 'Spot'], ['02', 'Shape'], ['03', 'Agree'], ['04', 'Pin down'], ['05', 'Prove'],
  ['06', 'Translate'], ['07', 'Build'], ['08', 'Deliver'], ['09', 'Grow'],
] as const;
const LADDER: Readiness['level'][] = ['not live', 'up, not the app', 'preview', 'internal testing', 'pilot / UAT', 'ready to use', 'in use'];
const LADDER_COLOR = ['#6b7280', '#ff6b6b', '#c792ff', '#ffb347', '#ffe14d', '#7cff6b', '#4dffe1'];
const STATE: Record<RoadmapItemState, { mark: string; color: string }> = {
  done: { mark: '✓', color: '#4dffe1' },
  'in progress': { mark: '▸', color: '#ffe14d' },
  blocked: { mark: '!', color: '#ff6b6b' },
  planned: { mark: '·', color: '#9ca3af' },
};
const PAGE: Record<string, string> = { app: 'the app', 'sign-in': 'sign-in page', placeholder: 'placeholder page', error: 'error page', none: 'no answer' };

const StageTrack: React.FC<{ s: ProjectStatus; hue: string }> = ({ s, hue }) => {
  const cur = s.stage ? Number(s.stage.step) : 0;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex gap-[3px]" role="img" aria-label={s.stage ? `Step ${s.stage.step} ${s.stage.name} of 09` : 'Stage unknown'}>
        {STEPS.map(([n, name]) => {
          const k = Number(n);
          return <span key={n} className="h-2 flex-1 rounded-sm" title={`${n} ${name}`}
            style={{ background: k < cur ? `${hue}88` : k === cur ? hue : 'rgba(255,255,255,0.08)', boxShadow: k === cur ? `0 0 8px ${hue}` : undefined }} />;
        })}
      </div>
      <div className="text-[11px] font-mono truncate" title={s.stage?.evidence.join(' · ')}>
        {s.stage ? <><span style={{ color: hue }}>{s.stage.step} {s.stage.name}</span><span className="text-gray-500"> · {s.stage.source === 'set' ? 'set by you' : 'estimated'}{s.stage.nextGate ? ` · gate ${s.stage.nextGate}` : ''}</span></>
          : <span className="text-gray-500">stage unknown</span>}
      </div>
    </div>
  );
};

/** Seven rungs from "not live" to "in use", with the evidence behind the rung. */
const ReadinessCell: React.FC<{ s: ProjectStatus }> = ({ s }) => {
  const r = s.readiness;
  const color = LADDER_COLOR[r.rank];
  const prod = s.live.filter(l => !l.staging);
  const shown = prod.find(l => l.ok && l.page.kind === 'app') ?? prod.find(l => l.ok) ?? prod[0] ?? s.live[0];
  const tip = [
    `${r.level} · ${r.why}`,
    r.verdict ? `Verdict: "${r.verdict.text}" (${r.verdict.file})` : null,
    r.wouldBe ? `Would be "${r.wouldBe}" once a live address shows the app` : null,
    ...s.live.map(l => `${l.url} · ${l.staging ? 'staging · ' : ''}${l.status ?? 'no answer'} · ${PAGE[l.page.kind]}${l.page.title ? ` "${l.page.title}"` : ''}`),
  ].filter(Boolean).join('\n');
  return (
    <div className="flex flex-col gap-1 min-w-0" title={tip}>
      <div className="flex gap-[3px]" role="img" aria-label={`Readiness: ${r.level}`}>
        {LADDER.map((l, i) => <span key={l} className="h-2 flex-1 rounded-sm" style={{ background: i <= r.rank ? `${color}${i === r.rank ? '' : '77'}` : 'rgba(255,255,255,0.08)' }} />)}
      </div>
      <div className="text-[11px] font-mono truncate">
        <span style={{ color }}>{r.level}</span>
        <span className="text-gray-500"> · {r.source === 'verdict' ? 'your verdict' : r.source === 'set' ? 'set by you' : r.source === 'live check' ? 'live check' : 'from stage'}</span>
      </div>
      {r.verdict && <div className="text-[10px] font-mono text-gray-400 truncate">“{r.verdict.text}”</div>}
      {r.wouldBe && <div className="text-[10px] font-mono text-gray-500 truncate">would be {r.wouldBe} once live</div>}
      {shown && (
        <div className="flex items-center gap-1 min-w-0">
          {s.live.map(l => <span key={l.url} className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: !l.ok ? (l.source === 'platform address' ? '#6b7280' : '#ff6b6b') : l.page.kind === 'app' ? '#4dffe1' : l.page.kind === 'sign-in' ? '#ffe14d' : '#ff9f6b' }} />)}
          <a href={shown.url.startsWith('http') ? shown.url : `https://${shown.url}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
            className="text-[10px] font-mono text-reka-cyan/70 hover:text-reka-cyan truncate inline-flex items-center gap-1"><Globe size={10} />{shown.url}</a>
          <span className="text-[10px] font-mono text-gray-500 shrink-0">· {PAGE[shown.page.kind]}</span>
        </div>
      )}
    </div>
  );
};

const LeftCell: React.FC<{ s: ProjectStatus; hue: string }> = ({ s, hue }) => {
  const rm = s.roadmap?.kind === 'roadmap' ? s.roadmap : null;
  const done = rm ? rm.counts.done : s.tasks.done;
  const total = rm ? rm.counts.done + rm.counts.inProgress + rm.counts.blocked + rm.counts.planned : s.tasks.total;
  if (!total) return <span className="text-[11px] font-mono text-gray-500">no roadmap or task list</span>;
  const now = rm?.sections.find(x => x.state !== 'done' && x.items.some(i => i.state !== 'done'));
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="h-1.5 bg-white/5 rounded overflow-hidden"><div className="h-full" style={{ width: `${Math.round((done / total) * 100)}%`, background: hue }} /></div>
      <div className="text-[11px] font-mono text-gray-300">{total - done} of {total} {rm ? 'roadmap items' : 'tasks'} left{rm && rm.counts.blocked ? <span className="text-[#ff8c8c]"> · {rm.counts.blocked} blocked</span> : null}</div>
      {now && <div className="text-[10px] font-mono text-gray-500 truncate">now: {now.title}</div>}
      {!rm && s.phases.length > 0 && <div className="text-[10px] font-mono text-gray-500">{s.phases.filter(p => p.done < p.total).length} of {s.phases.length} phases left</div>}
    </div>
  );
};

const SectionColumn: React.FC<{ sec: RoadmapSection; hue: string }> = ({ sec, hue }) => {
  const open = sec.items.filter(i => i.state !== 'done').length;
  return (
    <div className="w-[240px] shrink-0 rounded border bg-reka-dark/40 p-2 flex flex-col gap-1"
      style={{ borderColor: sec.state === 'in progress' ? `${hue}88` : sec.state === 'done' ? '#4dffe133' : 'rgba(255,255,255,0.08)' }}>
      <div className="text-[11px] font-mono font-bold text-white line-clamp-2" title={sec.title}>{sec.title}</div>
      <div className="text-[10px] font-mono text-gray-500">
        {sec.state === 'done' ? 'done' : sec.state === 'in progress' ? <span style={{ color: hue }}>in progress</span> : 'planned'}
        {sec.items.length ? ` · ${open} of ${sec.items.length} open` : ''}{sec.gate ? ` · ${sec.gate}` : ''}
      </div>
      {sec.items.slice(0, 8).map(i => (
        <div key={i.key} className="flex gap-1.5 text-[10px] font-mono" title={[i.title, i.status, i.owner, i.due].filter(Boolean).join(' · ')}>
          <span style={{ color: STATE[i.state].color }}>{STATE[i.state].mark}</span>
          <span className={`line-clamp-2 ${i.state === 'done' ? 'text-gray-500' : 'text-gray-300'}`}>{i.id ? <span className="text-gray-500">{i.id} </span> : null}{i.title}</span>
        </div>
      ))}
      {sec.items.length > 8 && <div className="text-[10px] font-mono text-gray-500">+{sec.items.length - 8} more</div>}
    </div>
  );
};

const RoadmapsTab: React.FC<{ list: ProjectStatus[]; onOpen: (n: string) => void }> = ({ list, onOpen }) => {
  const withRm = list.filter(s => s.roadmap);
  const without = list.filter(s => !s.roadmap || s.roadmap.kind === 'plan');
  return (
    <div className="flex flex-col gap-3">
      {withRm.map(s => {
        const hue = hueOf(s.name);
        const rm = s.roadmap!;
        return (
          <div key={s.name} className="rounded border border-reka-cyan/10 bg-reka-dark/30 p-3" style={{ borderLeft: `3px solid ${hue}` }}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
              <button type="button" onClick={() => onOpen(s.name)} className="text-sm font-bold text-white hover:underline">{s.name}</button>
              <span className="text-[10px] font-mono text-gray-400 inline-flex items-center gap-1"><FileText size={10} />{rm.repo}/{rm.file}</span>
              {rm.kind === 'plan' && <span className="text-[10px] font-mono text-reka-gold/80">a build plan, no ROADMAP.md yet</span>}
              <span className="text-[10px] font-mono text-gray-500">{rm.counts.done} done · {rm.counts.inProgress} in progress · {rm.counts.blocked} blocked · {rm.counts.planned} planned</span>
              <span className="ml-auto text-[10px] font-mono text-gray-500">{rm.updated ? `changed ${ago(rm.updated)}` : 'not committed'} · {rm.history.length}{rm.history.length >= 20 ? '+' : ''} change{rm.history.length === 1 ? '' : 's'}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
              {rm.sections.length ? rm.sections.map(sec => <SectionColumn key={sec.order} sec={sec} hue={hue} />) : <p className="text-[11px] font-mono text-gray-500">No horizons found in this file.</p>}
            </div>
          </div>
        );
      })}
      {without.length > 0 && (
        <div className="rounded border border-dashed border-reka-gold/25 p-3">
          <div className="text-[11px] font-mono text-reka-gold/90 mb-1">No ROADMAP.md yet ({without.length})</div>
          <div className="text-[11px] font-mono text-gray-400">{without.map(s => s.name).join(' · ')}</div>
          <div className="text-[10px] font-mono text-gray-500 mt-1">Each project writes its own: in a Claude Code chat in that project, type /soul-roadmap and Claude drafts docs/ROADMAP.md from its plans in the REKA format.</div>
        </div>
      )}
    </div>
  );
};

const ChangesTab: React.FC<{ project?: string | null }> = ({ project }) => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<RoadmapChanges | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/roadmap/changes?days=${days}${project ? `&project=${encodeURIComponent(project)}` : ''}`).then(r => r.json()).then(d => { if (!cancelled) setData(d as RoadmapChanges); }).catch(() => {});
    return () => { cancelled = true; };
  }, [days, project]);
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-mono text-gray-400">Changes to each project's roadmap over the last</span>
        {[7, 30, 90].map(d => <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d} className={`text-[10px] font-mono uppercase tracking-widest rounded px-2 py-1 border ${days === d ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-gray-400 border-gray-600/40'}`}>{d} days</button>)}
      </div>
      {!data && <p className="text-xs font-mono text-reka-gold animate-pulse">{'>'} Comparing roadmaps…</p>}
      {data?.firstRun && <p className="text-[11px] font-mono text-gray-500">The first roadmap snapshot was saved today. Commits to the roadmap files are listed now; item changes (added, finished, moved, re-dated) show from tomorrow on.</p>}
      {data && !data.projects.length && <p className="text-xs font-mono text-gray-400">No roadmap changed in the last {days} days.</p>}
      {data?.projects.map(p => (
        <div key={p.project} className="rounded border border-reka-cyan/10 bg-reka-dark/30 px-3 py-2" style={{ borderLeft: `3px solid ${hueOf(p.project)}` }}>
          <div className="text-sm font-mono text-white">{p.project} <span className="text-[10px] text-gray-500">{p.file}{p.gone ? ' · roadmap file no longer found' : ''}</span></div>
          {p.commits.map(c => <div key={c.hash} className="text-[11px] font-mono text-gray-300 flex gap-2"><GitCommit size={11} className="mt-0.5 text-gray-500 shrink-0" /><span className="text-gray-500 shrink-0">{day(c.ts)}</span><span className="text-reka-gold shrink-0">{c.hash}</span><span className="truncate">{c.subject}</span></div>)}
          {p.added.map((a, i) => <div key={`a${i}`} className="text-[11px] font-mono text-reka-teal">+ {a.title} <span className="text-gray-500">({a.section})</span></div>)}
          {p.removed.map((a, i) => <div key={`r${i}`} className="text-[11px] font-mono text-[#ff8c8c]">− {a.title} <span className="text-gray-500">(was in {a.section})</span></div>)}
          {p.changed.map((c, i) => <div key={`c${i}`} className="text-[11px] font-mono text-gray-300">{c.what === 'state' ? '◆' : c.what === 'moved' ? '⇄' : '◷'} {c.title}: <span className="text-gray-500">{c.from}</span> → <span className="text-white">{c.to}</span></div>)}
        </div>
      ))}
    </div>
  );
};

const KINDS = ['all', 'product', 'platform', 'client', 'internal', 'web', 'other'];
const GRID = 'lg:grid-cols-[18px_170px_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_110px_minmax(0,1.3fr)]';
const H = 'text-[10px] font-mono uppercase tracking-widest text-reka-cyan/60 mb-1';

const shortModel = (m: string | null) => (m ? (/claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(m)?.slice(1, 4).filter(Boolean).join(' ') ?? m) : '—');

/** The expanded row: repos, chats, readiness evidence and the roadmap's current horizon. */
const Detail: React.FC<{ s: ProjectStatus; dp: DashProject | null; flow: FlowGraph | null; hue: string }> = ({ s, dp, flow, hue }) => {
  const sessions = dp?.sessions ?? [];
  const handoffs = (id: string) => flow?.chats.find(c => c.id === id)?.agents ?? [];
  const now = s.roadmap?.sections.find(x => x.state !== 'done' && x.items.some(i => i.state !== 'done'));
  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 px-4 pb-3 pt-1 border-t border-reka-cyan/10 cursor-default" onClick={e => e.stopPropagation()}>
      <div className="min-w-0">
        <div className={H}>Repos · {s.repos.length}</div>
        {s.repos.map(r => (
          <div key={r.name} className="rounded border border-reka-cyan/10 bg-reka-dark/50 px-2 py-1.5 mb-1.5">
            <div className="flex items-center gap-2 text-xs font-mono text-white"><span className="truncate">{r.name}</span>{r.step && <span className="ml-auto text-[10px]" style={{ color: hue }}>{r.step}</span>}</div>
            <div className="text-[10px] font-mono text-gray-400">
              {r.branch ?? '—'}{r.dirty ? <span className="text-reka-gold"> · {r.dirty} uncommitted</span> : ''}{r.ahead ? <span className="text-reka-gold"> · {r.ahead} unpushed</span> : ''}
              {' · '}{r.commits} commits, {r.commits30d} in 30d{r.tasks.total ? ` · tasks ${r.tasks.done}/${r.tasks.total}` : ''}
            </div>
            {r.lastCommit && <div className="text-[10px] font-mono text-gray-500 truncate" title={r.lastCommit.subject}>{ago(r.lastCommit.date)}: {r.lastCommit.subject}</div>}
            {r.tag && <div className="text-[10px] font-mono text-gray-500">tag {r.tag.tag} · {ago(r.tag.date)}</div>}
          </div>
        ))}
        {!s.repos.length && <p className="text-[11px] font-mono text-gray-500">No repo cloned here.</p>}
      </div>

      <div className="min-w-0">
        <div className={H}>Chats · {sessions.length} in 30 days{dp?.liveSessions ? ` · ${dp.liveSessions} live` : ''}</div>
        {sessions.slice(0, 6).map(c => {
          const hs = handoffs(c.id);
          return (
            <div key={c.id} className="rounded border border-reka-cyan/10 bg-reka-dark/50 px-2 py-1.5 mb-1.5">
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-reka-gold">{shortModel(c.model)}</span>
                <span className={c.status === 'active' ? '' : 'text-gray-500'} style={c.status === 'active' ? { color: hue } : undefined}>{c.status === 'active' ? 'live' : ago(c.lastActivity)}</span>
                <span className="ml-auto text-gray-400">ctx {Math.round(c.contextPct ?? 0)}%</span>
              </div>
              <div className="text-[11px] font-mono text-gray-200 truncate" title={c.title}>{c.title}</div>
              <div className="text-[10px] font-mono text-gray-500">{fmtTokens(c.tokensToday)} today · {fmtCost(c.costToday)} today · {fmtCost(c.costTotal)} all{hs.length ? ` · ${hs.length} hand-offs` : ''}</div>
            </div>
          );
        })}
        {sessions.length > 6 && <div className="text-[10px] font-mono text-gray-500">+{sessions.length - 6} more (Group by: Chat)</div>}
        {!sessions.length && <p className="text-[11px] font-mono text-gray-500">No Claude Code chats in this project in 30 days.</p>}
      </div>

      <div className="min-w-0">
        <div className={H}>Readiness evidence</div>
        <div className="text-[11px] font-mono" style={{ color: LADDER_COLOR[s.readiness.rank] }}>{s.readiness.level}</div>
        <div className="text-[10px] font-mono text-gray-400 mb-1">{s.readiness.why}</div>
        {s.readiness.verdict && (
          <div className="rounded border border-reka-gold/20 bg-reka-dark/50 px-2 py-1.5 mb-1.5">
            <div className="text-[11px] font-mono text-gray-200">“{s.readiness.verdict.text}”</div>
            <div className="text-[10px] font-mono text-gray-500 truncate">{s.readiness.verdict.file}{s.readiness.verdict.date ? ` · ${ago(s.readiness.verdict.date)}` : ''}</div>
          </div>
        )}
        {s.live.map(l => (
          <div key={l.url} className="flex items-center gap-1.5 text-[10px] font-mono mb-0.5" title={l.page.title ?? ''}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: !l.ok ? (l.source === 'platform address' ? '#6b7280' : '#ff6b6b') : l.page.kind === 'app' ? '#4dffe1' : l.page.kind === 'sign-in' ? '#ffe14d' : '#ff9f6b' }} />
            <a href={l.url.startsWith('http') ? l.url : `https://${l.url}`} target="_blank" rel="noreferrer" className="text-reka-cyan/80 hover:text-reka-cyan truncate">{l.url}</a>
            <span className="text-gray-500 shrink-0">{l.staging ? 'staging · ' : ''}{l.status ?? '—'} · {PAGE[l.page.kind]}{l.ms ? ` · ${l.ms}ms` : ''}</span>
          </div>
        ))}
        {!s.live.length && <p className="text-[11px] font-mono text-gray-500">No deployed address found. Add one in projects.local.json ("live").</p>}
        {s.stage && <div className="text-[10px] font-mono text-gray-500 mt-1">Stage evidence: {s.stage.evidence.join(' · ')}</div>}
      </div>

      <div className="min-w-0">
        <div className={H}>Roadmap{s.roadmap ? ` · ${s.roadmap.kind === 'plan' ? 'build plan' : 'ROADMAP'}` : ''}</div>
        {!s.roadmap && <p className="text-[11px] font-mono text-gray-500">No roadmap yet. In this project's Claude Code chat, type /soul-roadmap.</p>}
        {s.roadmap && (
          <>
            <div className="text-[10px] font-mono text-gray-400 truncate">{s.roadmap.repo}/{s.roadmap.file}{s.roadmap.updated ? ` · changed ${ago(s.roadmap.updated)}` : ''}</div>
            <div className="text-[10px] font-mono text-gray-500 mb-1">{s.roadmap.counts.done} done · {s.roadmap.counts.inProgress} in progress · {s.roadmap.counts.blocked} blocked · {s.roadmap.counts.planned} planned</div>
            {now && <>
              <div className="text-[11px] font-mono mb-0.5" style={{ color: hue }}>{now.title}</div>
              {now.items.filter(i => i.state !== 'done').slice(0, 6).map(i => (
                <div key={i.key} className="flex gap-1.5 text-[10px] font-mono" title={[i.status, i.owner, i.due].filter(Boolean).join(' · ')}>
                  <span style={{ color: STATE[i.state].color }}>{STATE[i.state].mark}</span>
                  <span className="text-gray-300 truncate">{i.id ? `${i.id} ` : ''}{i.title}</span>
                </div>
              ))}
            </>}
            {s.roadmap.history.slice(0, 3).map(h => <div key={h.hash} className="text-[10px] font-mono text-gray-500 truncate mt-0.5"><span className="text-reka-gold">{h.hash}</span> {ago(h.ts)}: {h.subject}</div>)}
          </>
        )}
      </div>
    </div>
  );
};

type Group = 'project' | 'repo' | 'chat';

const StatusView: React.FC<{
  status: ProjectStatus[] | null;
  project: string | null;
  projects: DashProject[];
  flow: FlowGraph | null;
  onOpen: (name: string) => void;
  onFilter: (name: string | null) => void;
  onRefresh: () => void;
}> = ({ status, project, projects, flow, onOpen, onFilter, onRefresh }) => {
  const [tab, setTab] = useState<'status' | 'roadmaps' | 'changes'>('status');
  const [group, setGroup] = useState<Group>('project');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState<'stage' | 'readiness' | 'activity'>('readiness');
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => { setOpen(new Set(project ? [project] : [])); }, [project]);
  const toggle = (n: string) => setOpen(o => { const x = new Set(o); if (x.has(n)) x.delete(n); else x.add(n); return x; });

  const list = useMemo(() => {
    const l = (status ?? []).filter(s => (!project || s.name === project) && (kind === 'all' || s.kind === kind));
    return [...l].sort((a, b) =>
      sort === 'stage' ? Number(b.stage?.step ?? 0) - Number(a.stage?.step ?? 0) || a.name.localeCompare(b.name)
        : sort === 'readiness' ? b.readiness.rank - a.readiness.rank || Number(b.stage?.step ?? 0) - Number(a.stage?.step ?? 0)
          : (b.lastCommit?.date ?? 0) - (a.lastCommit?.date ?? 0));
  }, [status, kind, sort, project]);
  const dpOf = (n: string) => projects.find(p => p.name === n) ?? null;
  const all = (status ?? []).filter(s => !project || s.name === project);
  const byLevel = LADDER.map((l, i) => ({ l, i, count: all.filter(s => s.readiness.rank === i).length })).filter(x => x.count);
  const chip = (on: boolean) => `text-[10px] font-mono uppercase tracking-widest rounded px-2 py-1 border ${on ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-gray-400 border-gray-600/40 hover:text-white'}`;

  // Chats across projects (or the chosen one), newest first.
  const chats = useMemo(() => projects
    .filter(p => (!project || p.name === project) && (kind === 'all' || p.kind === kind))
    .flatMap(p => p.sessions.map(c => ({ p, c })))
    .sort((a, b) => b.c.lastActivity - a.c.lastActivity), [projects, project, kind]);

  return (
    <div className="panel-in absolute inset-x-6 top-20 bottom-6 z-40 flex flex-col gap-3 glass-panel rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-2 border-b border-reka-cyan/20 pb-2">
        {(['status', 'roadmaps', 'changes'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t}
            className={`text-[11px] font-mono uppercase tracking-widest px-3 py-1 rounded border ${tab === t ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-gray-400 border-gray-600/40 hover:text-white'}`}>
            {t === 'status' ? 'Status' : t === 'roadmaps' ? 'Roadmaps' : 'Roadmap changes'}
          </button>
        ))}
        {project && <button type="button" onClick={() => onFilter(null)} className="text-[10px] font-mono text-gray-400 hover:text-white border border-gray-600/40 rounded px-2 py-1">{project} only · show all</button>}
        <div className="flex flex-wrap gap-1.5 ml-auto items-center">
          {byLevel.map(x => <span key={x.l} className="text-[10px] font-mono border rounded px-1.5 py-0.5" style={{ color: LADDER_COLOR[x.i], borderColor: `${LADDER_COLOR[x.i]}44` }}>{x.l} · {x.count}</span>)}
          <button type="button" onClick={onRefresh} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 py-0.5 hover:bg-reka-cyan/10"><RefreshCw size={11} /> Recheck</button>
        </div>
      </div>

      {tab !== 'changes' && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!project && KINDS.map(k => <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={chip(kind === k)}>{k === 'all' ? 'All' : KIND_LABEL[k] ?? k}</button>)}
          {tab === 'status' && <>
            <span className="ml-auto text-[10px] font-mono text-gray-500">Group by</span>
            {(['project', 'repo', 'chat'] as const).map(g => <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g} className={chip(group === g)}>{g}</button>)}
            {group === 'project' && <>
              <span className="text-[10px] font-mono text-gray-500 ml-2">Sort</span>
              {(['readiness', 'stage', 'activity'] as const).map(k => <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k} className={chip(sort === k)}>{k}</button>)}
              <button type="button" onClick={() => setOpen(o => (o.size ? new Set() : new Set(list.map(s => s.name))))} className={chip(false)}>{open.size ? 'Collapse all' : 'Expand all'}</button>
            </>}
          </>}
        </div>
      )}
      {!status && <p className="text-xs font-mono text-reka-gold animate-pulse p-2">{'>'} Reading repos, roadmaps and checking live addresses…</p>}

      {tab === 'status' && status && group === 'project' && <>
        <div className={`hidden lg:grid ${GRID} gap-4 px-3 text-[10px] font-mono uppercase tracking-widest text-reka-cyan/50`}>
          <span /><span>Project</span><span>Stage (Build Flow)</span><span>Readiness</span><span>Left</span><span>Published</span><span>Next</span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-1.5">
          {list.map(s => {
            const hue = hueOf(s.name);
            const isOpen = open.has(s.name);
            return (
              <div key={s.name} className={`rounded border bg-reka-dark/40 ${isOpen ? 'border-reka-cyan/30' : 'border-reka-cyan/10'}`} style={{ borderLeft: `3px solid ${hue}` }}>
                <div role="button" tabIndex={0} aria-expanded={isOpen} onClick={() => toggle(s.name)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(s.name); } }}
                  className={`group text-left grid grid-cols-1 ${GRID} gap-x-4 gap-y-2 items-center px-3 py-2.5 cursor-pointer hover:bg-reka-cyan/5`}>
                  <ChevronRight size={14} className={`hidden lg:block text-gray-500 transition-transform ${isOpen ? 'rotate-90 text-white' : ''}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-white truncate">{s.name}</span>
                      <button type="button" onClick={e => { e.stopPropagation(); onOpen(s.name); }} className="text-[9px] font-mono uppercase tracking-widest text-gray-500 hover:text-white border border-gray-600/40 rounded px-1">soul</button>
                    </div>
                    <div className="text-[10px] font-mono text-gray-500 truncate">{KIND_LABEL[s.kind] ?? s.kind} · {s.repos.length} repo{s.repos.length === 1 ? '' : 's'} · {dpOf(s.name)?.sessions.length ?? 0} chats · {s.lastCommit ? `commit ${ago(s.lastCommit.date)}` : 'no commits'}</div>
                  </div>
                  <StageTrack s={s} hue={hue} />
                  <ReadinessCell s={s} />
                  <LeftCell s={s} hue={hue} />
                  <div className="text-[11px] font-mono min-w-0">
                    {s.published ? <span className="inline-flex items-center gap-1 text-gray-300" title={`${s.published.repo} · ${new Date(s.published.date).toISOString().slice(0, 10)}`}><Tag size={10} />{s.published.tag}<span className="text-gray-500">· {ago(s.published.date)}</span></span>
                      : <span className="text-gray-500">no release tag</span>}
                  </div>
                  <div className="text-[11px] font-mono text-gray-300 min-w-0">
                    <div className="line-clamp-2">{s.next}</div>
                    {s.note && <div className="text-[10px] text-reka-gold/80 truncate">{s.note}</div>}
                  </div>
                </div>
                {isOpen && <Detail s={s} dp={dpOf(s.name)} flow={flow} hue={hue} />}
              </div>
            );
          })}
        </div>
      </>}

      {tab === 'status' && status && group === 'repo' && (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          <table className="w-full text-[11px] font-mono">
            <thead className="text-[10px] uppercase tracking-widest text-reka-cyan/50 text-left">
              <tr><th className="py-1 px-2">Project</th><th>Repo</th><th>Stage</th><th>Branch</th><th>Local</th><th>Commits (30d)</th><th>Last commit</th><th>Tag</th><th>Tasks</th></tr>
            </thead>
            <tbody>
              {list.flatMap(s => s.repos.map(r => (
                <tr key={`${s.name}/${r.name}`} className="border-t border-reka-cyan/10 hover:bg-reka-cyan/5 cursor-pointer" onClick={() => { setGroup('project'); setOpen(new Set([s.name])); }}>
                  <td className="py-1.5 px-2" style={{ color: hueOf(s.name) }}>{s.name}</td>
                  <td className="text-white">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="hover:underline">{r.name}</a> : r.name}</td>
                  <td className="text-gray-300">{r.step ?? '—'}</td>
                  <td className="text-gray-400">{r.branch ?? '—'}</td>
                  <td className={r.dirty || r.ahead ? 'text-reka-gold' : 'text-gray-500'}>{r.dirty ? `${r.dirty} uncommitted` : ''}{r.dirty && r.ahead ? ' · ' : ''}{r.ahead ? `${r.ahead} unpushed` : ''}{!r.dirty && !r.ahead ? 'clean' : ''}</td>
                  <td className="text-gray-300">{r.commits} ({r.commits30d})</td>
                  <td className="text-gray-400 max-w-[320px] truncate" title={r.lastCommit?.subject}>{r.lastCommit ? `${ago(r.lastCommit.date)} · ${r.lastCommit.subject}` : '—'}</td>
                  <td className="text-gray-400">{r.tag?.tag ?? '—'}</td>
                  <td className="text-gray-400">{r.tasks.total ? `${r.tasks.done}/${r.tasks.total}` : '—'}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'status' && group === 'chat' && (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
          <table className="w-full text-[11px] font-mono">
            <thead className="text-[10px] uppercase tracking-widest text-reka-cyan/50 text-left">
              <tr><th className="py-1 px-2">Project</th><th>Chat</th><th>Model</th><th>State</th><th>Context</th><th>Tokens today</th><th>Cost today</th><th>Cost all</th><th>Hand-offs</th></tr>
            </thead>
            <tbody>
              {chats.map(({ p, c }) => {
                const hs = flow?.chats.find(x => x.id === c.id)?.agents ?? [];
                const pct = Math.round(c.contextPct ?? 0);
                return (
                  <tr key={c.id} className="border-t border-reka-cyan/10 hover:bg-reka-cyan/5">
                    <td className="py-1.5 px-2 whitespace-nowrap" style={{ color: hueOf(p.name) }}>{p.name}</td>
                    <td className="text-gray-200 max-w-[380px] truncate" title={c.title}>{c.title}</td>
                    <td className="text-reka-gold whitespace-nowrap">{shortModel(c.model)}</td>
                    <td className="whitespace-nowrap" style={c.status === 'active' ? { color: hueOf(p.name) } : undefined}>{c.status === 'active' ? 'live' : <span className="text-gray-500">{ago(c.lastActivity)}</span>}</td>
                    <td className={pct >= 80 ? 'text-[#ff8cff]' : 'text-gray-400'}>{pct}%</td>
                    <td className="text-gray-300">{fmtTokens(c.tokensToday)}</td>
                    <td className="text-gray-300">{fmtCost(c.costToday)}</td>
                    <td className="text-gray-400">{fmtCost(c.costTotal)}</td>
                    <td className="text-gray-400">{hs.length ? `${hs.length}${hs.some(a => a.status === 'running') ? ` · ${hs.filter(a => a.status === 'running').length} running` : ''}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!chats.length && <p className="text-xs font-mono text-gray-400 p-2">No chats in the last 30 days.</p>}
        </div>
      )}

      {tab === 'roadmaps' && status && <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"><RoadmapsTab list={list} onOpen={onOpen} /></div>}
      {tab === 'changes' && <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"><ChangesTab project={project} /></div>}

      <p className="text-[10px] font-mono text-gray-500">
        Click a row to expand it. Readiness: your own verdicts first (readiness files), else the Build Flow stage; capped by the live check, which reads what each address shows.
        Set what the repos can't show in projects.local.json: {'"status": { "stage": "08", "readiness": "pilot", "roadmap": "repo/docs/ROADMAP.md", "note": "UAT with client" }'}.
      </p>
    </div>
  );
};

export default StatusView;
