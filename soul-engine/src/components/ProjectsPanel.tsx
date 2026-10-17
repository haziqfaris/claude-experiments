import React from 'react';
import { ActivityStatus, Snapshot } from '../types';
import { ago, fmtCost, fmtTokens } from '../format';

interface ProjectsPanelProps {
  snapshot: Snapshot;
  focusId: string | null;
  onFocus: (id: string | null) => void;
}

const DOT: Record<ActivityStatus, string> = {
  active: 'bg-reka-teal shadow-[0_0_8px_#00ff9d] animate-pulse',
  recent: 'bg-reka-gold shadow-[0_0_6px_#ffd700]',
  idle: 'bg-gray-600',
};

/** Token burn over the last 30 minutes, drawn as a glowing line. */
const Burn: React.FC<{ values: number[] }> = ({ values }) => {
  const max = Math.max(1, ...values) * 1.15;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${40 - (v / max) * 40}`);
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-12" role="img" aria-label="Tokens per minute, last 30 minutes">
      <defs>
        <linearGradient id="burn-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#00f2ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#00f2ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,40 ${pts.join(' ')} 100,40`} fill="url(#burn-fill)" />
      <polyline points={pts.join(' ')} fill="none" stroke="#00f2ff" strokeWidth="1" vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 3px #00f2ff)' }} />
    </svg>
  );
};

const ProjectsPanel: React.FC<ProjectsPanelProps> = ({ snapshot, focusId, onFocus }) => (
  <aside className="panel-in absolute left-6 top-32 bottom-6 w-[272px] z-40 hidden xl:flex flex-col gap-3 glass-panel rounded-lg p-4" aria-label="Projects">
    <div className="flex items-center justify-between border-b border-reka-cyan/20 pb-2">
      <span className="text-xs font-mono tracking-widest text-reka-cyan uppercase">Echoes // Projects</span>
      <span className={`text-[10px] font-mono tracking-widest px-2 py-0.5 rounded border ${
        snapshot.source === 'demo' ? 'text-reka-gold border-reka-gold/40' : 'text-reka-teal border-reka-teal/40'
      }`}>
        {snapshot.source === 'demo' ? 'DEMO' : 'LIVE'}
      </span>
    </div>

    <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-2">
      {snapshot.projects.length === 0 && (
        <p className="text-xs font-mono text-gray-400">No Claude Code sessions found yet.</p>
      )}
      {snapshot.projects.map((p, i) => {
        const selected = p.id === focusId;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onFocus(selected ? null : p.id)}
            aria-pressed={selected}
            style={{ animationDelay: `${0.1 + i * 0.05}s` }}
            className={`panel-in text-left rounded px-3 py-2 border transition-colors ${
              selected
                ? 'border-reka-magenta/60 bg-reka-magenta/10'
                : 'border-reka-cyan/10 bg-reka-dark/40 hover:border-reka-cyan/40 hover:bg-reka-cyan/5'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[p.status]}`} />
              <span className="text-sm font-bold text-white truncate">{p.name}</span>
              <span className="ml-auto text-[10px] font-mono text-gray-400">{ago(p.lastActivity)}</span>
            </div>
            <div className="flex justify-between text-[11px] font-mono text-reka-cyan/70 mt-1">
              <span className="truncate max-w-[120px]">{p.branch ?? '—'}</span>
              <span>{fmtTokens(p.tokensToday)} · {fmtCost(p.costToday)}</span>
            </div>
          </button>
        );
      })}
    </div>

    <div className="border-t border-reka-cyan/20 pt-2 flex flex-col gap-1">
      <div className="flex justify-between text-[10px] font-mono tracking-widest text-reka-teal/80 uppercase">
        <span>Relay // cheaper models</span>
        <span>{snapshot.relay.countToday} today</span>
      </div>
      <div className="text-lg font-mono text-reka-teal" style={{ textShadow: '0 0 8px rgba(0,255,157,0.6)' }}>
        saved ≈ {fmtCost(snapshot.relay.savedToday)}
      </div>
      {snapshot.relay.recent.slice(0, 3).map(d => (
        <div key={`${d.at}-${d.task}`} className="text-[11px] font-mono text-gray-300 truncate" title={`${d.model} · ${d.route} · ${d.task}`}>
          <span className="text-reka-gold">→ {d.target}</span> {d.task}
        </div>
      ))}
      {snapshot.relay.recent.length === 0 && (
        <p className="text-[11px] font-mono text-gray-400">Nothing delegated yet. Load the soul-relay mod to start.</p>
      )}
    </div>

    <div className="border-t border-reka-cyan/20 pt-2">
      <div className="flex justify-between text-[10px] font-mono tracking-widest text-reka-cyan/70 uppercase">
        <span>Token flux · 30m</span>
        <span>{fmtTokens(snapshot.totals.burnPerMin)}/min</span>
      </div>
      <Burn values={snapshot.burn} />
    </div>
  </aside>
);

export default ProjectsPanel;
