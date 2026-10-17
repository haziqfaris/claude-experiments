import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Database, MessageSquare, RefreshCw, Search, X } from 'lucide-react';
import { Inventory, InventoryCategory, InventoryFact } from '../types';
import { ago } from '../format';

interface InventoryPanelProps {
  open: boolean;
  onClose: () => void;
  onAsk: (question: string) => void;
}

const CATS: { id: InventoryCategory; label: string; tone: string }[] = [
  { id: 'service', label: 'Tools', tone: 'text-reka-cyan border-reka-cyan/40' },
  { id: 'apikey', label: 'API keys', tone: 'text-reka-gold border-reka-gold/40' },
  { id: 'api', label: 'APIs called', tone: 'text-[#ff8cff] border-reka-magenta/40' },
  { id: 'hosting', label: 'Hosting', tone: 'text-reka-teal border-reka-teal/40' },
  { id: 'domain', label: 'Domains', tone: 'text-reka-teal border-reka-teal/40' },
  { id: 'email', label: 'E-mails', tone: 'text-reka-gold border-reka-gold/40' },
  { id: 'signin', label: 'Sign-in', tone: 'text-reka-cyan border-reka-cyan/40' },
  { id: 'job', label: 'Jobs and CI', tone: 'text-gray-300 border-gray-500/40' },
  { id: 'default', label: 'Defaults', tone: 'text-gray-300 border-gray-500/40' },
  { id: 'register', label: 'Access Register', tone: 'text-reka-teal border-reka-teal/40' },
  { id: 'env', label: 'Env names', tone: 'text-gray-400 border-gray-600/40' },
];
const TONE = Object.fromEntries(CATS.map(c => [c.id, c])) as Record<InventoryCategory, (typeof CATS)[number]>;

function matches(project: string, f: InventoryFact, words: string[]): boolean {
  if (!words.length) return true;
  const hay = `${project} ${TONE[f.category].label} ${f.label} ${f.value} ${f.evidence.join(' ')}`.toLowerCase();
  return words.every(w => hay.includes(w));
}

const InventoryPanel: React.FC<InventoryPanelProps> = ({ open, onClose, onAsk }) => {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<InventoryCategory | 'all'>('all');
  const [project, setProject] = useState('');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/inventory');
        if (res.ok && !cancelled) setInv((await res.json()) as Inventory);
      } catch { /* hub restarting */ }
    };
    load();
    const t = setInterval(load, 8000);
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { cancelled = true; clearInterval(t); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const groups = useMemo(() => {
    if (!inv) return [];
    return inv.projects
      .filter(p => !project || p.id === project)
      .map(p => ({ p, facts: p.facts.filter(f => (cat === 'all' ? f.category !== 'env' || words.length > 0 : f.category === cat) && matches(p.name, f, words)) }))
      .filter(g => g.facts.length);
  }, [inv, project, cat, q]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of inv?.projects ?? []) if (!project || p.id === project) for (const f of p.facts) if (matches(p.name, f, words)) c[f.category] = (c[f.category] ?? 0) + 1;
    return c;
  }, [inv, project, q]);
  const total = groups.reduce((n, g) => n + g.facts.length, 0);

  const copy = async () => {
    const md = groups.map(g => [`## ${g.p.name}${g.p.repo ? ` (${g.p.repo})` : ''}`, ...g.facts.map(f => `- ${TONE[f.category].label} · ${f.label}: ${f.value}${f.evidence[0] ? ` (${f.evidence[0]})` : ''}`)].join('\n')).join('\n\n');
    try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard refused */ }
  };

  if (!open) return null;
  return (
    <div className="panel-in fixed inset-x-4 top-28 bottom-6 z-[60] mx-auto max-w-5xl flex flex-col gap-3 glass-panel rounded-lg p-4" style={{ background: 'rgba(4, 8, 17, 0.97)' }} role="dialog" aria-label="Project inventory">
      <div className="flex flex-wrap items-center gap-3 border-b border-reka-cyan/20 pb-2">
        <Database size={14} className="text-reka-cyan" />
        <span className="text-xs font-mono tracking-widest text-reka-cyan uppercase">Inventory // Infra, keys and tools</span>
        <span className="text-[10px] font-mono text-gray-400">
          {inv ? `${inv.projects.length} projects · scanned ${inv.scannedAt ? ago(inv.scannedAt) : '—'}${inv.scanning ? ' · scanning…' : ''}` : 'linking…'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => fetch('/api/inventory/rescan', { method: 'POST' }).then(() => setInv(v => (v ? { ...v, scanning: true } : v)))} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 py-1 hover:bg-reka-cyan/10"><RefreshCw size={11} className={inv?.scanning ? 'animate-spin' : ''} /> Rescan</button>
          <button type="button" onClick={copy} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 py-1 hover:bg-reka-cyan/10"><Copy size={11} /> {copied ? 'Copied' : 'Copy as Markdown'}</button>
          <button type="button" onClick={onClose} aria-label="Close inventory" className="text-gray-400 hover:text-white p-1"><X size={16} /></button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-reka-cyan/60" />
          <label className="sr-only" htmlFor="inv-q">Search the inventory</label>
          <input id="inv-q" ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search: resend, gemini, noreply, antarax.ai, cron…" autoComplete="off"
            className="w-full bg-reka-dark/60 border border-reka-cyan/30 rounded pl-9 pr-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-reka-cyan placeholder-gray-500" />
        </div>
        <label className="sr-only" htmlFor="inv-project">Project</label>
        <select id="inv-project" value={project} onChange={e => setProject(e.target.value)} className="bg-reka-dark/70 border border-reka-cyan/30 rounded text-[11px] font-mono text-reka-cyan px-2 py-2 max-w-[200px] focus:outline-none">
          <option value="">ALL PROJECTS</option>
          {(inv?.projects ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" disabled={!q.trim()} onClick={() => { onAsk(`From the inventory: ${q.trim()}${project ? ` (project ${inv?.projects.find(p => p.id === project)?.name})` : ''}`); onClose(); }}
          className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-widest text-reka-magenta border border-reka-magenta/40 bg-reka-magenta/10 rounded px-3 py-2 hover:bg-reka-magenta/20 disabled:opacity-40"><MessageSquare size={12} /> Ask the core</button>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
        <button type="button" onClick={() => setCat('all')} aria-pressed={cat === 'all'} className={`text-[10px] font-mono uppercase tracking-widest rounded px-2 py-1 border ${cat === 'all' ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-gray-400 border-gray-600/40'}`}>All</button>
        {CATS.map(c => (
          <button key={c.id} type="button" onClick={() => setCat(c.id)} aria-pressed={cat === c.id}
            className={`text-[10px] font-mono uppercase tracking-widest rounded px-2 py-1 border ${cat === c.id ? 'bg-reka-cyan/20 text-white border-reka-cyan' : c.tone}`}>
            {c.label} <span className="opacity-60">{counts[c.id] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide pr-1 select-text">
        {!inv || (inv.scanning && !inv.projects.length) ? (
          <div className="text-xs font-mono text-reka-gold animate-pulse p-4">{'>'} Reading every project's files for tools, keys, hosting and addresses…</div>
        ) : !total ? (
          <div className="text-xs font-mono text-gray-400 p-4">Nothing matches. Try a service (stripe), a key (SERVICE_ROLE), a domain (antarax.ai) or an address (noreply).</div>
        ) : (
          groups.map(({ p, facts }) => (
            <section key={p.id} className="mb-4">
              <div className="flex flex-wrap items-baseline gap-2 sticky top-0 bg-[rgba(4,8,17,0.97)] py-1 z-10">
                <h3 className="text-sm font-bold text-white neon-text tracking-wider">{p.name}</h3>
                {p.repo && <a href={p.repo} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-reka-cyan/70 hover:text-reka-cyan truncate">{p.repo.replace(/^https:\/\//, '')}</a>}
                <span className="text-[10px] font-mono text-gray-500">{facts.length} fact{facts.length === 1 ? '' : 's'}{p.branch ? ` · ${p.branch}` : ''}</span>
                {p.alsoAt && <span className="text-[10px] font-mono text-gray-500" title={p.alsoAt.join('\n')}>· also checked out in {p.alsoAt.length} other folder{p.alsoAt.length === 1 ? '' : 's'}</span>}
              </div>
              <div className="grid gap-1">
                {facts.map((f, i) => (
                  <div key={i} className="grid grid-cols-[92px_minmax(0,180px)_minmax(0,1fr)] gap-2 items-baseline text-[11px] font-mono border-b border-reka-cyan/5 py-1">
                    <span className={`uppercase tracking-widest text-[9px] border rounded px-1.5 py-0.5 justify-self-start ${TONE[f.category].tone}`}>{TONE[f.category].label}</span>
                    <span className="text-gray-400 truncate" title={f.label}>{f.label}</span>
                    <span className="min-w-0">
                      <span className="text-white break-all">{f.value}</span>
                      {f.masked && <span className="text-gray-500"> · masked</span>}
                      {f.evidence.length > 0 && <span className="block text-gray-500 truncate" title={f.evidence.join('\n')}>{f.evidence.join(' · ')}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      <div className="text-[10px] font-mono text-gray-500">Read from each repo's files on this machine. Never a password or key value: keys are listed by name with the API they call. Personal and client addresses are masked.</div>
    </div>
  );
};

export default InventoryPanel;
