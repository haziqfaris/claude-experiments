import React from 'react';
import { ArrowLeft, Database, FileText, FolderGit2, GitBranch, History } from 'lucide-react';
import { ProjectDetail, ProjectStatus } from '../types';
import { DashProject, KIND_LABEL, hueOf } from '../projects';
import { ago, fmtCost, fmtTokens, shortModel } from '../format';

const Stat: React.FC<{ label: string; value: string; hue?: string }> = ({ label, value, hue }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[10px] font-mono tracking-widest text-reka-cyan/60 uppercase">{label}</span>
    <span className="text-base font-mono text-white" style={hue ? { textShadow: `0 0 6px ${hue}` } : undefined}>{value}</span>
  </div>
);

/** Main soul, right: what happened most recently, across projects. */
export const ActivityPanel: React.FC<{ projects: DashProject[]; onOpen: (name: string) => void }> = ({ projects, onOpen }) => {
  const recent = projects.filter(p => p.lastActivity).sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 8);
  return (
    <aside className="panel-in absolute right-6 top-20 bottom-6 w-[280px] z-40 hidden xl:flex flex-col gap-3 glass-panel rounded-lg p-4 overflow-y-auto scrollbar-hide" aria-label="Recent activity">
      <div className="border-b border-reka-cyan/20 pb-2 text-[10px] font-mono tracking-widest text-reka-magenta uppercase">Main soul // Recent resonance</div>
      {recent.map(p => {
        const hue = hueOf(p.name);
        const s = p.sessions[0];
        return (
          <button key={p.name} type="button" onClick={() => onOpen(p.name)} className="text-left rounded border border-reka-cyan/10 bg-reka-dark/40 px-3 py-2 hover:bg-reka-cyan/5" style={{ borderLeft: `3px solid ${hue}` }}>
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-white font-bold truncate">{p.name}</span>
              <span className={p.status === 'active' ? '' : 'text-gray-400'} style={p.status === 'active' ? { color: hue } : undefined}>{p.status === 'active' ? 'ACTIVE' : ago(p.lastActivity)}</span>
            </div>
            {s && <div className="text-[10px] font-mono text-reka-gold/80 mt-0.5">{shortModel(s.model)} · ctx {Math.round(s.contextPct ?? 0)}%</div>}
            {p.lastPrompt && <div className="text-[11px] font-mono text-gray-300 mt-1 line-clamp-2">“{p.lastPrompt}”</div>}
          </button>
        );
      })}
      {!recent.length && <p className="text-xs font-mono text-gray-400">No activity yet.</p>}
    </aside>
  );
};

interface ProjectSideProps {
  project: DashProject;
  onBack: () => void;
  onInventory: () => void;
  onChanges: () => void;
  onRegister: () => void;
  status?: ProjectStatus | null;
}

/** Project soul, left: the project at a glance, its repos, and what you can open. */
export const ProjectSidePanel: React.FC<ProjectSideProps> = ({ project: p, onBack, onInventory, onChanges, onRegister, status }) => {
  const hue = hueOf(p.name);
  const btn = 'flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest rounded px-3 py-2 border hover:bg-white/5';
  return (
    <aside key={p.name} className="panel-in absolute left-6 top-20 bottom-6 w-[300px] z-40 hidden xl:flex flex-col gap-4 glass-panel rounded-lg p-4 overflow-y-auto scrollbar-hide" aria-label={`Project ${p.name}`} style={{ borderColor: `${hue}44` }}>
      <div className="border-b pb-2" style={{ borderColor: `${hue}33` }}>
        <button type="button" onClick={onBack} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-gray-400 hover:text-white"><ArrowLeft size={11} /> Main soul</button>
        <h2 className="text-lg font-bold tracking-wider mt-1" style={{ color: hue, textShadow: `0 0 8px ${hue}88` }}>{p.name}</h2>
        <div className="text-[10px] font-mono uppercase tracking-widest text-gray-400">{KIND_LABEL[p.kind] ?? p.kind}</div>
      </div>
      {status && (
        <div className="flex flex-col gap-1 rounded border px-2.5 py-2" style={{ borderColor: `${hue}33` }}>
          <div className="text-[10px] font-mono tracking-widest text-reka-cyan/60 uppercase">Stage</div>
          <div className="text-xs font-mono" style={{ color: hue }}>
            {status.stage ? `${status.stage.step} ${status.stage.name}` : 'unknown'}
            <span className="text-gray-500">{status.stage ? ` · ${status.stage.source === 'set' ? 'set by you' : 'estimated'}` : ''}</span>
          </div>
          <div className="text-[11px] font-mono text-gray-300">
            {status.tasks.total ? `${status.tasks.total - status.tasks.done} of ${status.tasks.total} tasks left` : 'no task list found'}
            {' · '}
            {status.live.some(l => l.ok && !l.staging) ? <span className="text-reka-teal">live</span> : status.live.length ? <span className="text-[#ff8c8c]">not answering</span> : 'no live address'}
            {status.published ? ` · ${status.published.tag}` : ''}
          </div>
          <div className="text-[10px] font-mono text-gray-400">{status.next}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Tokens today" value={fmtTokens(p.tokensToday)} hue={hue} />
        <Stat label="Cost today" value={fmtCost(p.costToday)} hue={hue} />
        <Stat label="Sessions" value={`${p.liveSessions}/${p.sessionCount}`} hue={hue} />
        <Stat label="All-time" value={fmtCost(p.costTotal)} hue={hue} />
      </div>
      <div className="flex flex-col gap-2">
        <button type="button" onClick={onInventory} className={btn} style={{ borderColor: `${hue}55`, color: hue }}><Database size={13} /> Inventory · {p.counts.keys} keys · {p.counts.apis} APIs</button>
        <button type="button" onClick={onChanges} className={btn} style={{ borderColor: `${hue}33` }}><History size={13} /> Changes</button>
        {p.repos.length > 0 && <button type="button" onClick={onRegister} className={btn} style={{ borderColor: `${hue}33` }}><FileText size={13} /> Access Register draft</button>}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-mono tracking-widest text-reka-cyan/60 uppercase">Repos</span>
        {p.repos.map(r => (
          <div key={r.id} className="rounded border border-reka-cyan/10 bg-reka-dark/40 px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-xs font-mono text-white"><FolderGit2 size={11} style={{ color: hue }} /><span className="truncate">{r.name}</span></div>
            <div className="flex items-center gap-1 text-[10px] font-mono text-gray-400 mt-0.5"><GitBranch size={10} />{r.branch ?? '—'} · {r.facts.length} facts</div>
            {r.repo && <a href={r.repo} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-reka-cyan/60 hover:text-reka-cyan truncate block">{r.repo.replace(/^https:\/\//, '')}</a>}
          </div>
        ))}
        {p.missing.map(m => <div key={m.name} className="text-[10px] font-mono text-gray-500 px-2">{m.name} · not cloned here</div>)}
        {!p.repos.length && !p.missing.length && <p className="text-[11px] font-mono text-gray-400">A folder Claude worked in that is not in projects.local.json.</p>}
      </div>
    </aside>
  );
};

/** Project soul, right: its sessions and what they touched. */
export const ProjectSessionsPanel: React.FC<{ project: DashProject; detail: ProjectDetail | null }> = ({ project: p, detail }) => {
  const hue = hueOf(p.name);
  const files = (detail?.sessions ?? []).flatMap(s => s.files).sort((a, b) => b.ts - a.ts).slice(0, 6);
  return (
    <aside key={p.name} className="panel-in absolute right-6 top-20 bottom-6 w-[280px] z-40 hidden xl:flex flex-col gap-3 glass-panel rounded-lg p-4 overflow-y-auto scrollbar-hide" aria-label={`Sessions in ${p.name}`} style={{ borderColor: `${hue}44` }}>
      <div className="border-b pb-2 text-[10px] font-mono tracking-widest uppercase" style={{ borderColor: `${hue}33`, color: hue }}>Sessions // {p.name}</div>
      {!p.sessions.length && <p className="text-xs font-mono text-gray-400">No Claude Code sessions in this project in the last 30 days.</p>}
      {p.sessions.slice(0, 6).map(s => {
        const pct = Math.round(s.contextPct ?? 0);
        return (
          <div key={s.id} className="rounded border border-reka-cyan/10 bg-reka-dark/40 px-2 py-2">
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-reka-gold tracking-widest">{shortModel(s.model)}</span>
              <span className={s.status === 'active' ? '' : 'text-gray-400'} style={s.status === 'active' ? { color: hue } : undefined}>{s.status === 'active' ? 'ACTIVE' : ago(s.lastActivity)}</span>
            </div>
            <div className="text-xs text-gray-200 font-mono truncate mt-1" title={s.title}>{s.title}</div>
            <div className="mt-2 h-1 bg-reka-cyan/10 rounded overflow-hidden"><div className="h-full" style={{ width: `${pct}%`, background: pct >= 80 ? '#ff00ff' : hue }} /></div>
            <div className="flex justify-between text-[10px] font-mono text-gray-400 mt-1"><span>ctx {pct}%</span><span>{fmtTokens(s.tokensToday)} today</span></div>
          </div>
        );
      })}
      {files.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono tracking-widest text-reka-cyan/60 uppercase">Recent files</span>
          {files.map(f => <span key={f.path} className="text-[11px] font-mono text-gray-300 truncate" title={f.path}>{detail && f.path.startsWith(detail.project.path) ? f.path.slice(detail.project.path.length + 1) : f.path}</span>)}
        </div>
      )}
      {detail?.git && detail.git.commits.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-mono tracking-widest text-reka-cyan/60 uppercase">Commits</span>
          {detail.git.commits.slice(0, 4).map(c => <span key={c.hash} className="text-[11px] font-mono text-gray-300 truncate" title={c.subject}><span className="text-reka-gold">{c.hash}</span> {c.subject}</span>)}
        </div>
      )}
    </aside>
  );
};
