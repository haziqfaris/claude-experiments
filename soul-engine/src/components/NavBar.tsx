import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Database, Gauge, Lock, Maximize2, Minimize2, Network, Orbit } from 'lucide-react';
import { DashProject, hueOf, KIND_LABEL, MAIN_HUE } from '../projects';
import { hashPin, helloAvailable, LockPrefs, registerHello } from '../lock';

const HelloSetting: React.FC<{ prefs: LockPrefs; onPrefs: (p: LockPrefs) => void }> = ({ prefs, onPrefs }) => {
  const [avail, setAvail] = useState<'yes' | 'needs-localhost' | 'no' | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { helloAvailable().then(setAvail); }, []);
  const here = `http://localhost:${location.port}${location.pathname}${location.hash}`;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono uppercase tracking-widest text-reka-cyan/60">Windows Hello {prefs.hello ? '(on)' : ''}</span>
      {avail === 'needs-localhost' && <span className="text-[10px] font-mono text-gray-400">Needs the app at localhost. <a href={here} className="text-reka-cyan underline">Open it there</a> and install it from that address.</span>}
      {avail === 'no' && <span className="text-[10px] font-mono text-gray-400">Windows Hello is not set up on this PC (Settings, Accounts, Sign-in options).</span>}
      {avail === 'yes' && !prefs.hello && (
        <button type="button" className="self-start text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 py-1 hover:bg-reka-cyan/10"
          onClick={async () => { try { onPrefs({ ...prefs, hello: await registerHello() }); setMsg('Windows Hello unlocks it now'); } catch { setMsg('Windows Hello was cancelled'); } }}>
          Use Windows Hello to unlock
        </button>
      )}
      {prefs.hello && <button type="button" onClick={() => { onPrefs({ ...prefs, hello: null }); setMsg('Windows Hello off'); }} className="self-start text-[10px] font-mono text-gray-500 hover:text-white">Turn off Windows Hello</button>}
      {msg && <span className="text-[10px] font-mono text-reka-teal">{msg}</span>}
    </div>
  );
};

/** Lock now, plus when to lock by itself and whether a PIN wakes it. */
const LockMenu: React.FC<{ prefs: LockPrefs; onPrefs: (p: LockPrefs) => void; onLock: () => void }> = ({ prefs, onPrefs, onLock }) => {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [saved, setSaved] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative flex items-center" ref={box}>
      <button type="button" onClick={onLock} title="Lock (Ctrl+Shift+L): only the soul shows" aria-label="Lock the dashboard"
        className="flex items-center gap-1.5 h-8 pl-2.5 pr-1.5 rounded-l border border-reka-cyan/25 text-[11px] font-mono uppercase tracking-widest text-gray-300 hover:text-white hover:bg-white/5">
        <Lock size={13} /> Lock
      </button>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Lock settings"
        className="h-8 px-1 rounded-r border border-l-0 border-reka-cyan/25 text-gray-400 hover:text-white hover:bg-white/5"><ChevronDown size={13} /></button>
      {open && (
        <div className="absolute right-0 top-10 w-[250px] rounded-lg border border-reka-cyan/20 p-3 flex flex-col gap-3 shadow-2xl" style={{ background: 'rgba(4, 8, 17, 0.98)' }}>
          <label className="flex flex-col gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan/60">
            Lock by itself after
            <select value={prefs.autoMin} onChange={e => onPrefs({ ...prefs, autoMin: Number(e.target.value) })}
              className="bg-reka-dark border border-reka-cyan/30 rounded text-xs font-mono text-white px-2 py-1 normal-case tracking-normal">
              {[0, 5, 10, 15, 30, 60].map(m => <option key={m} value={m}>{m ? `${m} idle minutes` : 'never'}</option>)}
            </select>
          </label>
          <HelloSetting prefs={prefs} onPrefs={onPrefs} />
          <form className="flex flex-col gap-1" onSubmit={async e => {
            e.preventDefault();
            if (pin.length < 4) { setSaved('at least 4 characters'); return; }
            onPrefs({ ...prefs, pinHash: await hashPin(pin) }); setPin(''); setSaved('PIN saved');
          }}>
            <span className="text-[10px] font-mono uppercase tracking-widest text-reka-cyan/60">PIN {prefs.hello ? 'if Windows Hello fails' : 'to unlock'} {prefs.pinHash ? '(set)' : prefs.hello ? '(none)' : '(none: any key wakes it)'}</span>
            <div className="flex gap-1.5">
              <input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={e => { setPin(e.target.value); setSaved(''); }} placeholder={prefs.pinHash ? 'new PIN' : 'set a PIN'}
                className="flex-1 min-w-0 bg-reka-dark border border-reka-cyan/30 rounded text-xs font-mono text-white px-2 py-1 focus:outline-none focus:border-reka-cyan" />
              <button type="submit" className="text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 hover:bg-reka-cyan/10">Save</button>
            </div>
            {prefs.pinHash && <button type="button" onClick={() => { onPrefs({ ...prefs, pinHash: null }); setSaved('PIN removed'); }} className="self-start text-[10px] font-mono text-gray-500 hover:text-white">Remove PIN</button>}
            {saved && <span className="text-[10px] font-mono text-reka-teal">{saved}</span>}
          </form>
          <p className="text-[10px] font-mono text-gray-500 leading-relaxed">A privacy screen for this window, not account security. For that, lock Windows (Win+L).</p>
        </div>
      )}
    </div>
  );
};

const FullscreenButton: React.FC = () => {
  const [full, setFull] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  return (
    <button type="button" title={full ? 'Leave full screen (Esc)' : 'Full screen (F11)'} aria-label={full ? 'Leave full screen' : 'Full screen'}
      onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}
      className="h-8 w-8 flex items-center justify-center rounded border border-reka-cyan/25 text-gray-300 hover:text-white hover:bg-white/5">
      {full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );
};

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
  lockPrefs: LockPrefs;
  onLockPrefs: (p: LockPrefs) => void;
  onLock: () => void;
  /** A newer build is ready. */
  update?: boolean;
}

/** One bar for everything: which soul (all projects or one), which screen, and the numbers that matter. */
const NavBar: React.FC<NavBarProps> = ({ scope, view, projects, link, linkLabel, metrics, badges, inventoryOpen, onNavigate, onInventory, lockPrefs, onLockPrefs, onLock, update }) => {
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
      <div className="ml-3 flex items-center gap-1.5">
        {update && (
          <button type="button" onClick={() => location.reload()} title="A newer version of the dashboard is ready"
            className="h-8 px-2.5 rounded border border-reka-gold/50 bg-reka-gold/10 text-[11px] font-mono uppercase tracking-widest text-reka-gold hover:bg-reka-gold/20 animate-pulse">
            Updated · Reload
          </button>
        )}
        <FullscreenButton />
        <LockMenu prefs={lockPrefs} onPrefs={onLockPrefs} onLock={onLock} />
      </div>
    </nav>
  );
};

export default NavBar;
