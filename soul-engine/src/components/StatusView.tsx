import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, FileText, GitCommit, Globe, RefreshCw, Tag } from 'lucide-react';
import { ProjectStatus, Readiness, RoadmapChanges, RoadmapItemState, RoadmapSection } from '../types';
import { hueOf, KIND_LABEL } from '../projects';
import { ago } from '../format';

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

const ChangesTab: React.FC = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<RoadmapChanges | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/roadmap/changes?days=${days}`).then(r => r.json()).then(d => { if (!cancelled) setData(d as RoadmapChanges); }).catch(() => {});
    return () => { cancelled = true; };
  }, [days]);
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
const GRID = 'lg:grid-cols-[170px_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_110px_minmax(0,1.3fr)_16px]';

const StatusView: React.FC<{ status: ProjectStatus[] | null; onOpen: (name: string) => void; onBack: () => void; onRefresh: () => void }> = ({ status, onOpen, onBack, onRefresh }) => {
  const [tab, setTab] = useState<'status' | 'roadmaps' | 'changes'>('status');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState<'stage' | 'readiness' | 'activity'>('readiness');
  const list = useMemo(() => {
    const l = (status ?? []).filter(s => kind === 'all' || s.kind === kind);
    return [...l].sort((a, b) =>
      sort === 'stage' ? Number(b.stage?.step ?? 0) - Number(a.stage?.step ?? 0) || a.name.localeCompare(b.name)
        : sort === 'readiness' ? b.readiness.rank - a.readiness.rank || Number(b.stage?.step ?? 0) - Number(a.stage?.step ?? 0)
          : (b.lastCommit?.date ?? 0) - (a.lastCommit?.date ?? 0));
  }, [status, kind, sort]);
  const all = status ?? [];
  const byLevel = LADDER.map((l, i) => ({ l, i, count: all.filter(s => s.readiness.rank === i).length })).filter(x => x.count);
  const tabBtn = (id: typeof tab, label: string) => (
    <button type="button" onClick={() => setTab(id)} aria-pressed={tab === id}
      className={`text-[11px] font-mono uppercase tracking-widest px-3 py-1 rounded border ${tab === id ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-gray-400 border-gray-600/40 hover:text-white'}`}>{label}</button>
  );

  return (
    <div className="panel-in absolute inset-x-6 top-32 bottom-6 z-40 flex flex-col gap-3 glass-panel rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-reka-cyan/20 pb-2">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-gray-400 hover:text-white"><ArrowLeft size={11} /> Main soul</button>
        <span className="text-xs font-mono tracking-widest text-reka-cyan uppercase">Status // every project</span>
        <div className="flex gap-1.5">{tabBtn('status', 'Status')}{tabBtn('roadmaps', 'Roadmaps')}{tabBtn('changes', 'Roadmap changes')}</div>
        <div className="flex flex-wrap gap-1.5 ml-auto items-center">
          {byLevel.map(x => <span key={x.l} className="text-[10px] font-mono border rounded px-1.5 py-0.5" style={{ color: LADDER_COLOR[x.i], borderColor: `${LADDER_COLOR[x.i]}44` }}>{x.l} · {x.count}</span>)}
          <button type="button" onClick={onRefresh} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 py-0.5 hover:bg-reka-cyan/10"><RefreshCw size={11} /> Recheck</button>
        </div>
      </div>
      {tab !== 'changes' && (
        <div className="flex flex-wrap items-center gap-1.5">
          {KINDS.map(k => (
            <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
              className={`text-[10px] font-mono uppercase tracking-widest rounded px-2 py-1 border ${kind === k ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-gray-400 border-gray-600/40'}`}>{k === 'all' ? 'All' : KIND_LABEL[k] ?? k}</button>
          ))}
          {tab === 'status' && <>
            <span className="ml-auto text-[10px] font-mono text-gray-500">Sort</span>
            {(['readiness', 'stage', 'activity'] as const).map(k => (
              <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k}
                className={`text-[10px] font-mono uppercase tracking-widest rounded px-2 py-1 border ${sort === k ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-gray-400 border-gray-600/40'}`}>{k}</button>
            ))}
          </>}
        </div>
      )}
      {!status && <p className="text-xs font-mono text-reka-gold animate-pulse p-2">{'>'} Reading repos, roadmaps and checking live addresses…</p>}

      {tab === 'status' && status && <>
        <div className={`hidden lg:grid ${GRID} gap-4 px-3 text-[10px] font-mono uppercase tracking-widest text-reka-cyan/50`}>
          <span>Project</span><span>Stage (Build Flow)</span><span>Readiness</span><span>Left</span><span>Published</span><span>Next</span><span />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-1.5">
          {list.map(s => {
            const hue = hueOf(s.name);
            return (
              <button key={s.name} type="button" onClick={() => onOpen(s.name)}
                className={`group text-left grid grid-cols-1 ${GRID} gap-x-4 gap-y-2 items-center rounded px-3 py-2.5 border border-reka-cyan/10 bg-reka-dark/40 hover:bg-reka-cyan/5`}
                style={{ borderLeft: `3px solid ${hue}` }}>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white truncate">{s.name}</div>
                  <div className="text-[10px] font-mono text-gray-500 truncate">{KIND_LABEL[s.kind] ?? s.kind} · {s.lastCommit ? `commit ${ago(s.lastCommit.date)}` : 'no commits'}{s.commits30d ? ` · ${s.commits30d} in 30d` : ''}</div>
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
                <ChevronRight size={14} className="hidden lg:block text-gray-600 group-hover:text-white" />
              </button>
            );
          })}
        </div>
      </>}
      {tab === 'roadmaps' && status && <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"><RoadmapsTab list={list} onOpen={onOpen} /></div>}
      {tab === 'changes' && <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"><ChangesTab /></div>}

      <p className="text-[10px] font-mono text-gray-500">
        Readiness: your own verdicts first (readiness files), else the Build Flow stage; capped by the live check, which looks at what each address shows (the app, a sign-in page, a placeholder or an error).
        Set what the repos can't show in projects.local.json: {'"status": { "stage": "08", "readiness": "pilot", "roadmap": "repo/docs/ROADMAP.md", "note": "UAT with client" }'}.
      </p>
    </div>
  );
};

export default StatusView;
