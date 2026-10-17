import React from 'react';
import { ChevronRight, KeyRound, Network, Server } from 'lucide-react';
import { Snapshot } from '../types';
import { DashProject, KIND_LABEL, hueOf } from '../projects';
import { ago, fmtCost, fmtTokens } from '../format';

interface ProjectsDashboardProps {
  projects: DashProject[];
  snapshot: Snapshot | null;
  onOpen: (name: string) => void;
}

const DOT = { active: 'animate-pulse', recent: '', idle: 'opacity-40' } as const;

/** Main soul, left: every project as a card, grouped by kind. Opening one loads its soul. */
const ProjectsDashboard: React.FC<ProjectsDashboardProps> = ({ projects, snapshot, onOpen }) => {
  const kinds = [...new Set(projects.map(p => p.kind))];
  return (
    <aside className="panel-in absolute left-6 top-20 bottom-6 w-[300px] z-40 hidden xl:flex flex-col gap-3 glass-panel rounded-lg p-4" aria-label="Projects">
      <div className="flex items-center justify-between border-b border-reka-cyan/20 pb-2">
        <span className="text-xs font-mono tracking-widest text-reka-cyan uppercase">Souls // Projects</span>
        <span className="text-[10px] font-mono text-gray-400">{projects.filter(p => p.kind !== 'activity').length} projects</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-3">
        {!projects.length && <p className="text-xs font-mono text-gray-400">Reading projects…</p>}
        {kinds.map(k => (
          <div key={k} className="flex flex-col gap-1.5">
            <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-reka-cyan/50">{KIND_LABEL[k] ?? k}</span>
            {projects.filter(p => p.kind === k).map(p => {
              const hue = hueOf(p.name);
              return (
                <button key={p.name} type="button" onClick={() => onOpen(p.name)}
                  className="group text-left rounded px-3 py-2 border border-reka-cyan/10 bg-reka-dark/40 hover:bg-reka-cyan/5 transition-colors"
                  style={{ borderLeft: `3px solid ${hue}` }}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[p.status]}`} style={{ background: p.status === 'idle' ? '#4b5563' : hue, boxShadow: p.status === 'idle' ? 'none' : `0 0 8px ${hue}` }} />
                    <span className="text-sm font-bold text-white truncate">{p.name}</span>
                    <span className="ml-auto text-[10px] font-mono text-gray-400">{p.lastActivity ? ago(p.lastActivity) : '—'}</span>
                    <ChevronRight size={12} className="text-gray-500 group-hover:text-white" />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-mono text-gray-400 mt-1">
                    <span>{p.repos.length}{p.missing.length ? `+${p.missing.length}` : ''} repo{p.repos.length + p.missing.length === 1 ? '' : 's'}</span>
                    {p.liveSessions > 0 && <span style={{ color: hue }}>{p.liveSessions} live</span>}
                    <span>{fmtTokens(p.tokensToday)} · {fmtCost(p.costToday)}</span>
                  </div>
                  {p.repos.length > 0 && (
                    <div className="flex gap-3 text-[10px] font-mono text-gray-500 mt-1">
                      <span className="inline-flex items-center gap-1" title="API keys (names)"><KeyRound size={10} />{p.counts.keys}</span>
                      <span className="inline-flex items-center gap-1" title="Outside APIs called"><Network size={10} />{p.counts.apis}</span>
                      <span className="inline-flex items-center gap-1" title="Hosting facts"><Server size={10} />{p.counts.hosting}</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {snapshot && (
        <div className="border-t border-reka-cyan/20 pt-2 flex flex-col gap-1">
          <div className="flex justify-between text-[10px] font-mono tracking-widest text-reka-teal/80 uppercase">
            <span>Relay // cheaper models</span>
            <span>{snapshot.relay.countToday} today</span>
          </div>
          <div className="text-base font-mono text-reka-teal">saved ≈ {fmtCost(snapshot.relay.savedToday)}</div>
        </div>
      )}
    </aside>
  );
};

export default ProjectsDashboard;
