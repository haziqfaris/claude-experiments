import React from 'react';
import { GitBranch } from 'lucide-react';
import { ProjectDetail } from '../types';
import { ago, fmtCost, fmtTokens, shortModel } from '../format';

interface FocusPanelProps {
  detail: ProjectDetail | null;
  pinned: boolean;
}

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] font-mono tracking-widest text-reka-cyan/60 uppercase">{label}</span>
    <span className="text-base font-mono text-white neon-text">{value}</span>
  </div>
);

const FocusPanel: React.FC<FocusPanelProps> = ({ detail, pinned }) => {
  if (!detail) return null;
  const { project: p, sessions, git } = detail;
  const files = sessions.flatMap(s => s.files).sort((a, b) => b.ts - a.ts).slice(0, 5);

  return (
    <aside
      key={p.id}
      className="panel-in absolute right-6 top-32 bottom-6 w-[272px] z-40 hidden xl:flex flex-col gap-4 glass-panel rounded-lg p-4 overflow-y-auto scrollbar-hide"
      aria-label={`Focus: ${p.name}`}
    >
      <div className="border-b border-reka-cyan/20 pb-2">
        <div className="text-[10px] font-mono tracking-widest text-reka-magenta uppercase">
          {pinned ? 'Focus // Locked' : 'Focus // Most recent'}
        </div>
        <h2 className="text-lg font-bold text-white neon-text tracking-wider truncate mt-1">{p.name}</h2>
        <div className="text-[11px] font-mono text-gray-400 truncate" title={p.path}>{p.path}</div>
        <div className="flex items-center gap-2 text-[11px] font-mono text-reka-cyan/80 mt-1">
          <GitBranch size={12} className="shrink-0" />
          <span className="truncate min-w-0">{git?.branch ?? p.branch ?? '—'}</span>
          {git && <span className={`shrink-0 whitespace-nowrap ${git.dirty.length ? 'text-reka-gold' : 'text-reka-teal'}`}>· {git.dirty.length} changed</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Tokens today" value={fmtTokens(p.tokensToday)} />
        <Stat label="Cost today" value={fmtCost(p.costToday)} />
        <Stat label="Sessions" value={`${p.liveSessions}/${p.sessionCount}`} />
        <Stat label="All-time" value={fmtCost(p.costTotal)} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-mono tracking-widest text-reka-cyan/60 uppercase">Sessions</span>
        {sessions.slice(0, 4).map(s => {
          const pct = Math.round(s.contextPct ?? 0);
          return (
            <div key={s.id} className="rounded border border-reka-cyan/10 bg-reka-dark/40 px-2 py-2">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-reka-gold tracking-widest">{shortModel(s.model)}</span>
                <span className={s.status === 'active' ? 'text-reka-teal' : 'text-gray-400'}>
                  {s.status === 'active' ? 'ACTIVE' : ago(s.lastActivity)}
                </span>
              </div>
              <div className="text-xs text-gray-200 font-mono truncate mt-1" title={s.title}>{s.title}</div>
              <div className="mt-2 h-1 bg-reka-cyan/10 rounded overflow-hidden" title={`Context ${pct}%`}>
                <div
                  className={`h-full transition-all duration-1000 ${pct >= 80 ? 'bg-reka-magenta' : 'bg-reka-cyan'}`}
                  style={{ width: `${pct}%`, boxShadow: '0 0 8px currentColor' }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-gray-400 mt-1">
                <span>ctx {pct}%</span>
                <span>{fmtTokens(s.tokensToday)} today</span>
              </div>
            </div>
          );
        })}
      </div>

      {files.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono tracking-widest text-reka-cyan/60 uppercase">Recent files</span>
          {files.map(f => (
            <span key={f.path} className="text-[11px] font-mono text-gray-300 truncate" title={f.path}>
              {f.path.startsWith(p.path) ? f.path.slice(p.path.length + 1) : f.path}
            </span>
          ))}
        </div>
      )}

      {git && git.commits.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono tracking-widest text-reka-cyan/60 uppercase">Commits</span>
          {git.commits.slice(0, 4).map(c => (
            <span key={c.hash} className="text-[11px] font-mono text-gray-300 truncate" title={c.subject}>
              <span className="text-reka-gold">{c.hash}</span> {c.subject}
            </span>
          ))}
        </div>
      )}
    </aside>
  );
};

export default FocusPanel;
