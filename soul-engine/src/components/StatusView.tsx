import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronRight, Globe, RefreshCw, Tag } from 'lucide-react';
import { ProjectStatus } from '../types';
import { hueOf, KIND_LABEL } from '../projects';
import { ago } from '../format';

const STEPS = [
  ['01', 'Spot'], ['02', 'Shape'], ['03', 'Agree'], ['04', 'Pin down'], ['05', 'Prove'],
  ['06', 'Translate'], ['07', 'Build'], ['08', 'Deliver'], ['09', 'Grow'],
] as const;

/** Nine Build Flow steps; the ones passed are filled, the current one glows. */
const StageTrack: React.FC<{ s: ProjectStatus; hue: string }> = ({ s, hue }) => {
  const cur = s.stage ? Number(s.stage.step) : 0;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex gap-[3px]" role="img" aria-label={s.stage ? `Step ${s.stage.step} ${s.stage.name} of 09` : 'Stage unknown'}>
        {STEPS.map(([n]) => {
          const k = Number(n);
          return <span key={n} className="h-2 flex-1 rounded-sm" title={`${n} ${STEPS[k - 1][1]}`}
            style={{ background: k < cur ? `${hue}88` : k === cur ? hue : 'rgba(255,255,255,0.08)', boxShadow: k === cur ? `0 0 8px ${hue}` : undefined }} />;
        })}
      </div>
      <div className="text-[11px] font-mono truncate" title={s.stage?.evidence.join(' · ')}>
        {s.stage ? <><span style={{ color: hue }}>{s.stage.step} {s.stage.name}</span><span className="text-gray-500"> · {s.stage.source === 'set' ? 'set by you' : 'estimated'}{s.stage.nextGate ? ` · next gate ${s.stage.nextGate}` : ''}</span></>
          : <span className="text-gray-500">stage unknown</span>}
      </div>
    </div>
  );
};

const Progress: React.FC<{ s: ProjectStatus; hue: string }> = ({ s, hue }) => {
  const { done, total } = s.tasks;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const phasesDone = s.phases.filter(p => p.done === p.total).length;
  const current = s.phases.find(p => p.done < p.total);
  if (!total) return <span className="text-[11px] font-mono text-gray-500">no task list found</span>;
  return (
    <div className="flex flex-col gap-1 min-w-0" title={s.tasks.files.join('\n')}>
      <div className="h-1.5 bg-white/5 rounded overflow-hidden"><div className="h-full" style={{ width: `${pct}%`, background: hue }} /></div>
      <div className="text-[11px] font-mono text-gray-300">
        {total - done} of {total} tasks left
        {s.phases.length > 0 && <span className="text-gray-500"> · {s.phases.length - phasesDone} of {s.phases.length} phases left</span>}
      </div>
      {current && <div className="text-[10px] font-mono text-gray-500 truncate">now: {current.name} ({current.done}/{current.total})</div>}
    </div>
  );
};

const Live: React.FC<{ s: ProjectStatus }> = ({ s }) => {
  const prod = s.live.filter(l => !l.staging);
  const up = prod.filter(l => l.ok);
  if (!s.live.length) return <span className="text-[11px] font-mono text-gray-500">no live address found</span>;
  const first = up[0] ?? prod[0] ?? s.live[0];
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-1.5">
        {s.live.map(l => (
          <span key={l.url} title={`${l.url} · ${l.source}${l.staging ? ' · staging' : ''} · ${l.status ?? 'no answer'}${l.ms ? ` · ${l.ms} ms` : ''}`}
            className="w-2 h-2 rounded-full" style={{ background: l.ok ? (l.staging ? '#4dffe199' : '#4dffe1') : l.source === 'platform address' ? '#6b7280' : '#ff6b6b' }} />
        ))}
        <span className={`text-[11px] font-mono ${up.length ? 'text-reka-teal' : 'text-[#ff8c8c]'}`}>{up.length ? 'Live' : prod.length ? 'Not answering' : 'Staging only'}</span>
      </div>
      <a href={first.url.startsWith('http') ? first.url : `https://${first.url}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
        className="text-[10px] font-mono text-reka-cyan/70 hover:text-reka-cyan truncate inline-flex items-center gap-1"><Globe size={10} />{first.url}</a>
    </div>
  );
};

const KINDS = ['all', 'product', 'platform', 'client', 'internal', 'web', 'other'];

const StatusView: React.FC<{ status: ProjectStatus[] | null; onOpen: (name: string) => void; onBack: () => void; onRefresh: () => void }> = ({ status, onOpen, onBack, onRefresh }) => {
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState<'stage' | 'activity' | 'left'>('stage');
  const list = useMemo(() => {
    const l = (status ?? []).filter(s => kind === 'all' || s.kind === kind);
    const left = (s: ProjectStatus) => s.tasks.total - s.tasks.done;
    return [...l].sort((a, b) =>
      sort === 'stage' ? Number(b.stage?.step ?? 0) - Number(a.stage?.step ?? 0) || a.name.localeCompare(b.name)
        : sort === 'left' ? left(b) - left(a)
          : (b.lastCommit?.date ?? 0) - (a.lastCommit?.date ?? 0));
  }, [status, kind, sort]);
  const all = status ?? [];
  const live = all.filter(s => s.live.some(l => l.ok && !l.staging)).length;
  const down = all.filter(s => s.live.some(l => !l.ok && !l.staging && l.source !== 'platform address')).length;
  const byStep = STEPS.map(([n, name]) => ({ n, name, count: all.filter(s => s.stage?.step === n).length })).filter(x => x.count);

  return (
    <div className="panel-in absolute inset-x-6 top-32 bottom-6 z-40 flex flex-col gap-3 glass-panel rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-3 border-b border-reka-cyan/20 pb-2">
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-gray-400 hover:text-white"><ArrowLeft size={11} /> Main soul</button>
        <span className="text-xs font-mono tracking-widest text-reka-cyan uppercase">Status // every project</span>
        <span className="text-[10px] font-mono text-gray-400">{all.length} projects · {live} live · {down ? <span className="text-[#ff8c8c]">{down} not answering</span> : 'none down'}</span>
        <div className="flex flex-wrap gap-1.5 ml-auto">
          {byStep.map(x => <span key={x.n} className="text-[10px] font-mono text-gray-400 border border-reka-cyan/15 rounded px-1.5 py-0.5">{x.n} {x.name} · {x.count}</span>)}
          <button type="button" onClick={onRefresh} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 py-0.5 hover:bg-reka-cyan/10"><RefreshCw size={11} /> Recheck</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {KINDS.map(k => (
          <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
            className={`text-[10px] font-mono uppercase tracking-widest rounded px-2 py-1 border ${kind === k ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-gray-400 border-gray-600/40'}`}>{k === 'all' ? 'All' : KIND_LABEL[k] ?? k}</button>
        ))}
        <span className="ml-auto text-[10px] font-mono text-gray-500">Sort</span>
        {(['stage', 'left', 'activity'] as const).map(k => (
          <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k}
            className={`text-[10px] font-mono uppercase tracking-widest rounded px-2 py-1 border ${sort === k ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-gray-400 border-gray-600/40'}`}>{k === 'left' ? 'most left' : k}</button>
        ))}
      </div>
      <div className="hidden lg:grid grid-cols-[180px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_120px_minmax(0,1.4fr)_16px] gap-4 px-3 text-[10px] font-mono uppercase tracking-widest text-reka-cyan/50">
        <span>Project</span><span>Stage (Build Flow)</span><span>Left</span><span>Live</span><span>Published</span><span>Next</span><span />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-1.5">
        {!status && <p className="text-xs font-mono text-reka-gold animate-pulse p-2">{'>'} Reading repos and checking live addresses…</p>}
        {list.map(s => {
          const hue = hueOf(s.name);
          return (
            <button key={s.name} type="button" onClick={() => onOpen(s.name)}
              className="group text-left grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_120px_minmax(0,1.4fr)_16px] gap-x-4 gap-y-2 items-center rounded px-3 py-2.5 border border-reka-cyan/10 bg-reka-dark/40 hover:bg-reka-cyan/5"
              style={{ borderLeft: `3px solid ${hue}` }}>
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">{s.name}</div>
                <div className="text-[10px] font-mono text-gray-500 truncate">
                  {KIND_LABEL[s.kind] ?? s.kind} · {s.lastCommit ? `commit ${ago(s.lastCommit.date)}` : 'no commits'}{s.commits30d ? ` · ${s.commits30d} in 30d` : ''}
                </div>
              </div>
              <StageTrack s={s} hue={hue} />
              <Progress s={s} hue={hue} />
              <Live s={s} />
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
      <p className="text-[10px] font-mono text-gray-500">
        Stages come from each repo's documents and history (spec, build plan, test, release and delivery packs, tags, commits); steps 01 to 03 happen before a repo exists.
        Set a stage, live addresses or a note per project in projects.local.json: {'"status": { "stage": "07", "live": ["app.example.com"], "note": "UAT with client" }'}.
      </p>
    </div>
  );
};

export default StatusView;
