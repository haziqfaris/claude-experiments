import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Database, Gauge, Network, Orbit } from 'lucide-react';
import { DashProject, hueOf, KIND_LABEL, MAIN_HUE } from '../projects';

export type View = 'soul' | 'status' | 'relay';

interface NavBarProps {
  scope: string | null;
  view: View;
  projects: DashProject[];
  link: 'linking' | 'online' | 'lost';
  linkLabel: string;
  metrics: { label: string; value: string; title?: string }[];
  badges: { status?: string; relay?: string };
  inventoryOpen: boolean;
  onNavigate: (scope: string | null, view: View) => void;
  onInventory: () => void;
}

/** One bar for everything: which soul (all projects or one), which screen, and the numbers that matter. */
const NavBar: React.FC<NavBarProps> = ({ scope, view, projects, link, linkLabel, metrics, badges, inventoryOpen, onNavigate, onInventory }) => {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const hue = scope ? hueOf(scope) : MAIN_HUE;
  const kinds = [...new Set(projects.map(p => p.kind))];
  const tab = (id: View | 'inventory', label: string, icon: React.ReactNode, badge?: string) => {
    const active = id === 'inventory' ? inventoryOpen : view === id && !inventoryOpen;
    return (
      <button key={id} type="button" aria-current={active ? 'page' : undefined}
        onClick={() => (id === 'inventory' ? onInventory() : onNavigate(scope, id))}
        className={`relative flex items-center gap-1.5 h-14 px-3 text-[11px] font-mono uppercase tracking-widest transition-colors ${active ? 'text-white' : 'text-gray-400 hover:text-white'}`}>
        {icon}{label}
        {badge && <span className="text-[9px] rounded px-1 py-px bg-white/10 text-gray-300 normal-case tracking-normal">{badge}</span>}
        {active && <span className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full" style={{ background: hue, boxShadow: `0 0 8px ${hue}` }} />}
      </button>
    );
  };

  return (
    <nav className="absolute top-0 inset-x-0 z-50 h-14 flex items-center gap-2 px-4 border-b border-reka-cyan/15" style={{ background: 'rgba(4, 8, 17, 0.92)', backdropFilter: 'blur(10px)' }} aria-label="Main">
      <button type="button" onClick={() => onNavigate(null, 'soul')} className="flex items-baseline gap-1.5 pr-3 border-r border-reka-cyan/15 h-8" title="Main soul">
        <span className="text-lg font-bold tracking-widest text-white neon-text">REKA</span>
        <span className="text-[10px] font-mono text-reka-cyan/70">v2.7</span>
      </button>

      {/* Which soul: every project, or one */}
      <div className="relative" ref={menu}>
        <button type="button" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}
          className="flex items-center gap-2 h-8 pl-2.5 pr-2 rounded border text-xs font-mono hover:bg-white/5 max-w-[240px]"
          style={{ borderColor: `${hue}55` }}>
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hue, boxShadow: `0 0 6px ${hue}` }} />
          <span className="truncate text-white">{scope ?? 'All projects'}</span>
          <ChevronDown size={13} className="text-gray-400 shrink-0" />
        </button>
        {open && (
          <div role="listbox" className="absolute left-0 top-10 w-[280px] max-h-[70vh] overflow-y-auto scrollbar-hide rounded-lg border border-reka-cyan/20 p-1.5 shadow-2xl" style={{ background: 'rgba(4, 8, 17, 0.98)' }}>
            <button type="button" role="option" aria-selected={!scope} onClick={() => { onNavigate(null, view); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono text-left hover:bg-white/5">
              <span className="w-2 h-2 rounded-full" style={{ background: MAIN_HUE }} /><span className="text-white">All projects</span>
              <span className="ml-auto text-[10px] text-gray-500">main soul</span>{!scope && <Check size={12} className="text-reka-cyan" />}
            </button>
            {kinds.map(k => (
              <div key={k} className="mt-1">
                <div className="px-2 py-1 text-[9px] font-mono uppercase tracking-[0.2em] text-reka-cyan/50">{KIND_LABEL[k] ?? k}</div>
                {projects.filter(p => p.kind === k).map(p => (
                  <button key={p.name} type="button" role="option" aria-selected={scope === p.name} onClick={() => { onNavigate(p.name, view); setOpen(false); }}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-mono text-left hover:bg-white/5">
                    <span className={`w-2 h-2 rounded-full ${p.status === 'active' ? 'animate-pulse' : ''}`} style={{ background: p.status === 'idle' ? '#4b5563' : hueOf(p.name) }} />
                    <span className="truncate text-gray-200">{p.name}</span>
                    {p.liveSessions > 0 && <span className="ml-auto text-[10px]" style={{ color: hueOf(p.name) }}>{p.liveSessions} live</span>}
                    {scope === p.name && <Check size={12} className="text-reka-cyan ml-auto" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Which screen; each keeps the chosen soul */}
      <div className="flex items-center ml-2">
        {tab('soul', 'Soul', <Orbit size={14} />)}
        {tab('status', 'Status', <Gauge size={14} />, badges.status)}
        {tab('relay', 'Relay', <Network size={14} />, badges.relay)}
        {tab('inventory', 'Inventory', <Database size={14} />)}
      </div>

      <div className="ml-auto hidden lg:flex items-center gap-4">
        {metrics.map(m => (
          <div key={m.label} className="flex flex-col items-end leading-tight" title={m.title}>
            <span className="text-[9px] font-mono uppercase tracking-widest text-reka-cyan/50">{m.label}</span>
            <span className="text-sm font-mono text-white">{m.value}</span>
          </div>
        ))}
      </div>
      <span className={`ml-3 hidden md:inline-flex items-center gap-1 text-[10px] font-mono ${link === 'online' ? 'text-reka-teal' : 'text-reka-gold'}`} title="Link to the hub">
        <span className={`w-1.5 h-1.5 rounded-full ${link === 'online' ? 'bg-reka-teal animate-pulse' : 'bg-reka-gold'}`} />{linkLabel}
      </span>
    </nav>
  );
};

export default NavBar;
