import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Copy, Database, Download, FileText, FolderGit2, History, KeyRound, MessageSquare, RefreshCw, Search, X } from 'lucide-react';
import { Inventory, InventoryCategory, InventoryFact, InventoryGroup, ProjectInventory } from '../types';
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
interface Doc { title: string; file: string; markdown: string; ask: string }
interface Change { project: string; repo: string; status: 'new' | 'gone' | 'changed'; added: InventoryFact[]; removed: InventoryFact[] }
interface Changes { report: { from: number | null; to: number; repos: Change[]; firstRun: boolean }; markdown: string }

const DocModal: React.FC<{ doc: Doc; onClose: () => void; onAsk: (q: string) => void }> = ({ doc, onClose, onAsk }) => {
  const [copied, setCopied] = useState(false);
  const download = () => {
    const url = URL.createObjectURL(new Blob([doc.markdown], { type: 'text/markdown' }));
    const a = document.createElement('a'); a.href = url; a.download = doc.file; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div className="absolute inset-0 z-20 flex flex-col gap-2 rounded-lg p-4" style={{ background: 'rgba(4, 8, 17, 0.99)' }} role="dialog" aria-label={doc.title}>
      <div className="flex flex-wrap items-center gap-2 border-b border-reka-cyan/20 pb-2">
        <FileText size={14} className="text-reka-gold" />
        <span className="text-xs font-mono tracking-widest text-reka-gold uppercase">{doc.title}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(doc.markdown); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* refused */ } }} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 py-1 hover:bg-reka-cyan/10"><Copy size={11} /> {copied ? 'Copied' : 'Copy'}</button>
          <button type="button" onClick={download} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 py-1 hover:bg-reka-cyan/10"><Download size={11} /> {doc.file}</button>
          <button type="button" onClick={() => onAsk(doc.ask)} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-magenta border border-reka-magenta/40 bg-reka-magenta/10 rounded px-2 py-1 hover:bg-reka-magenta/20"><MessageSquare size={11} /> Ask the core to check it</button>
          <button type="button" onClick={onClose} aria-label="Close document" className="text-gray-400 hover:text-white p-1"><X size={16} /></button>
        </div>
      </div>
      <pre className="flex-1 overflow-auto scrollbar-hide whitespace-pre-wrap break-words text-[11px] font-mono text-gray-200 select-text">{doc.markdown}</pre>
      <div className="text-[10px] font-mono text-gray-500">A draft from the inventory, with no AI. Rows marked [CONFIRM] need a person. Never add secret values to it.</div>
    </div>
  );
};

const ChangesView: React.FC<{ onAsk: (q: string) => void }> = ({ onAsk }) => {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Changes | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/inventory/changes?days=${days}`).then(r => r.json()).then(d => { if (!cancelled) setData(d as Changes); }).catch(() => {});
    return () => { cancelled = true; };
  }, [days]);
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-mono text-gray-400">Changes in keys, APIs, services, hosting, domains, addresses, sign-in and jobs over the last</span>
        {[7, 30, 90].map(d => <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d} className={`text-[10px] font-mono uppercase tracking-widest rounded px-2 py-1 border ${days === d ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-gray-400 border-gray-600/40'}`}>{d} days</button>)}
        <button type="button" onClick={() => onAsk(`Summarize what changed in the last ${days} days across my projects (use change_report) and flag anything risky: new keys, new outside APIs, personal addresses, hosting changes.`)} className="ml-auto flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-magenta border border-reka-magenta/40 bg-reka-magenta/10 rounded px-2 py-1 hover:bg-reka-magenta/20"><MessageSquare size={11} /> Ask the core to review</button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-hide select-text">
        {!data ? <div className="text-xs font-mono text-reka-gold animate-pulse p-2">{'>'} Comparing snapshots…</div>
          : data.report.firstRun ? <div className="text-xs font-mono text-gray-400 p-2">The first snapshot was saved today ({day(data.report.to)}). A snapshot is saved every day the hub runs; changes show from the second day on.</div>
          : !data.report.repos.length ? <div className="text-xs font-mono text-gray-400 p-2">Nothing changed since {day(data.report.from!)}.</div>
          : (
            <>
              <div className="text-[10px] font-mono text-gray-500 mb-2">{day(data.report.from!)} → {day(data.report.to)} · {data.report.repos.length} repo{data.report.repos.length === 1 ? '' : 's'} changed</div>
              {data.report.repos.map(c => (
                <div key={c.project + c.repo} className="mb-3 rounded border border-reka-cyan/10 bg-reka-dark/30 px-3 py-2">
                  <div className="text-sm font-mono text-white">{c.project === c.repo ? c.repo : `${c.project} / ${c.repo}`} <span className="text-[10px] text-gray-500">{c.status === 'new' ? 'new on this machine' : c.status === 'gone' ? 'no longer on this machine' : ''}</span></div>
                  {c.added.map((f, i) => <div key={'a' + i} className="text-[11px] font-mono text-reka-teal">+ {TONE[f.category].label} · {f.label}: {f.value}{f.evidence[0] ? <span className="text-gray-500"> ({f.evidence[0]})</span> : null}</div>)}
                  {c.removed.map((f, i) => <div key={'r' + i} className="text-[11px] font-mono text-[#ff8c8c]">− {TONE[f.category].label} · {f.label}: {f.value}</div>)}
                </div>
              ))}
            </>
          )}
      </div>
    </div>
  );
};

const KIND_LABEL: Record<string, string> = { product: 'Products', platform: 'Platform', client: 'Client work', internal: 'Internal', web: 'Websites', other: 'Other repos' };

function factMatches(group: string, repo: ProjectInventory, f: InventoryFact, words: string[]): boolean {
  if (!words.length) return true;
  const hay = `${group} ${repo.name} ${TONE[f.category].label} ${f.label} ${f.value} ${f.evidence.join(' ')}`.toLowerCase();
  return words.every(w => hay.includes(w));
}

const InventoryPanel: React.FC<InventoryPanelProps> = ({ open, onClose, onAsk }) => {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<InventoryCategory | 'all'>('all');
  const [groupName, setGroupName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [mode, setMode] = useState<'inventory' | 'changes'>('inventory');
  const inputRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<Doc | null>(null);
  docRef.current = doc;
  const openDoc = async (kind: 'access-register' | 'rotation', arg: string) => {
    const url = kind === 'access-register' ? `/api/docs/access-register?project=${encodeURIComponent(arg)}` : `/api/docs/rotation?key=${encodeURIComponent(arg)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const d = (await res.json()) as { title: string; file: string; markdown: string };
      setDoc({ ...d, ask: kind === 'access-register'
        ? `Draft the Access Register for ${arg} with access_register_draft, then check it with your tools: confirm each service is really used, and list what a person must still fill in.`
        : `Build the rotation checklist for ${arg} with rotation_checklist, then confirm with search_code where it is really read, and say what would break while it is rotated.` });
    } catch { /* hub restarting */ }
  };
  const listRef = useRef<HTMLDivElement>(null);

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
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (docRef.current) setDoc(null); else onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => { cancelled = true; clearInterval(t); window.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const byId = useMemo(() => new Map((inv?.projects ?? []).map(p => [p.id, p])), [inv]);

  // project → repo → facts, after search and category filters
  const view = useMemo(() => {
    return (inv?.groups ?? []).map(g => {
      const repos = g.repos.map(id => byId.get(id)).filter((r): r is ProjectInventory => !!r).map(r => ({
        repo: r,
        facts: r.facts.filter(f => (cat === 'all' ? f.category !== 'env' || words.length > 0 : f.category === cat) && factMatches(g.name, r, f, words)),
      }));
      const missing = words.length || cat !== 'all' ? g.missing.filter(m => words.every(w => `${g.name} ${m.name}`.toLowerCase().includes(w)) && cat === 'all') : g.missing;
      const count = repos.reduce((n, r) => n + r.facts.length, 0);
      return { g, repos: words.length || cat !== 'all' ? repos.filter(r => r.facts.length) : repos, missing, count };
    }).filter(v => v.repos.length || v.missing.length);
  }, [inv, byId, cat, q]);
  const shown = groupName ? view.filter(v => v.g.name === groupName) : view;
  const total = shown.reduce((n, v) => n + v.count, 0);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const v of (groupName ? view.filter(x => x.g.name === groupName) : view)) for (const g of (inv?.groups ?? []).filter(x => x.name === v.g.name)) for (const id of g.repos) {
      const r = byId.get(id); if (!r) continue;
      for (const f of r.facts) if (factMatches(g.name, r, f, words)) c[f.category] = (c[f.category] ?? 0) + 1;
    }
    return c;
  }, [view, groupName, inv, byId, q]);

  const copy = async () => {
    const md = shown.map(({ g, repos, missing }) => [
      `# ${g.name}`,
      ...repos.map(({ repo, facts }) => [`## ${repo.name}${repo.repo ? ` (${repo.repo})` : ' (local only)'}`, ...CATS.filter(c => facts.some(f => f.category === c.id)).map(c => [`### ${c.label}`, ...facts.filter(f => f.category === c.id).map(f => `- ${f.label}: ${f.value}${f.evidence[0] ? ` (${f.evidence[0]})` : ''}`)].join('\n'))].join('\n\n')),
      ...(missing.length ? [`Not cloned on this machine: ${missing.map(m => m.name).join(', ')}`] : []),
    ].join('\n\n')).join('\n\n');
    try { await navigator.clipboard.writeText(md); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard refused */ }
  };

  if (!open) return null;
  const kinds = [...new Set(view.map(v => v.g.kind))];
  return (
    <div className="panel-in fixed inset-x-4 top-28 bottom-6 z-[60] mx-auto max-w-6xl flex flex-col gap-3 glass-panel rounded-lg p-4" style={{ background: 'rgba(4, 8, 17, 0.97)' }} role="dialog" aria-label="Project inventory">
      <div className="flex flex-wrap items-center gap-3 border-b border-reka-cyan/20 pb-2">
        <Database size={14} className="text-reka-cyan" />
        <span className="text-xs font-mono tracking-widest text-reka-cyan uppercase">Inventory // Projects and repos</span>
        <span className="text-[10px] font-mono text-gray-400">
          {inv ? `${inv.groups.length} projects · ${inv.projects.length} repos scanned · ${inv.groups.reduce((n, g) => n + g.missing.length, 0)} not cloned · ${inv.scannedAt ? ago(inv.scannedAt) : '—'}${inv.scanning ? ' · scanning…' : ''}` : 'linking…'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => fetch('/api/inventory/rescan', { method: 'POST' }).then(() => setInv(v => (v ? { ...v, scanning: true } : v)))} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 py-1 hover:bg-reka-cyan/10"><RefreshCw size={11} className={inv?.scanning ? 'animate-spin' : ''} /> Rescan</button>
          <button type="button" onClick={() => setMode(m => (m === 'changes' ? 'inventory' : 'changes'))} aria-pressed={mode === 'changes'} className={`flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest border rounded px-2 py-1 ${mode === 'changes' ? 'bg-reka-cyan/20 text-white border-reka-cyan' : 'text-reka-cyan border-reka-cyan/30 hover:bg-reka-cyan/10'}`}><History size={11} /> Changes</button>
          <button type="button" onClick={copy} className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-2 py-1 hover:bg-reka-cyan/10"><Copy size={11} /> {copied ? 'Copied' : 'Copy as Markdown'}</button>
          <button type="button" onClick={onClose} aria-label="Close inventory" className="text-gray-400 hover:text-white p-1"><X size={16} /></button>
        </div>
      </div>

      {doc && <DocModal doc={doc} onClose={() => setDoc(null)} onAsk={q2 => { onAsk(q2); setDoc(null); onClose(); }} />}
      {mode === 'changes' ? <ChangesView onAsk={q2 => { onAsk(q2); onClose(); }} /> : (<>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-reka-cyan/60" />
          <label className="sr-only" htmlFor="inv-q">Search the inventory</label>
          <input id="inv-q" ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search: resend, gemini, noreply, antarax.ai, cron…" autoComplete="off"
            className="w-full bg-reka-dark/60 border border-reka-cyan/30 rounded pl-9 pr-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-reka-cyan placeholder-gray-500" />
        </div>
        <button type="button" disabled={!q.trim()} onClick={() => { onAsk(`From the inventory${groupName ? ` of project ${groupName}` : ''}: ${q.trim()}`); onClose(); }}
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

      <div className="flex-1 min-h-0 flex gap-4">
        {/* projects */}
        <nav className="w-56 shrink-0 overflow-y-auto scrollbar-hide hidden md:flex flex-col gap-3 border-r border-reka-cyan/10 pr-3" aria-label="Projects">
          <button type="button" onClick={() => setGroupName(null)} className={`text-left text-[11px] font-mono uppercase tracking-widest px-2 py-1 rounded ${groupName == null ? 'bg-reka-cyan/15 text-white' : 'text-gray-400 hover:text-white'}`}>All projects</button>
          {kinds.map(k => (
            <div key={k} className="flex flex-col gap-0.5">
              <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-reka-cyan/50 px-2">{KIND_LABEL[k] ?? k}</span>
              {view.filter(v => v.g.kind === k).map(v => (
                <button key={v.g.name} type="button" onClick={() => { setGroupName(v.g.name); listRef.current?.scrollTo({ top: 0 }); }}
                  className={`flex items-baseline justify-between gap-2 text-left text-xs font-mono px-2 py-1 rounded ${groupName === v.g.name ? 'bg-reka-cyan/15 text-white' : 'text-gray-300 hover:text-white hover:bg-reka-cyan/5'}`}>
                  <span className="truncate">{v.g.name}</span>
                  <span className="text-[10px] text-gray-500 shrink-0">{v.repos.length}{v.missing.length ? `+${v.missing.length}` : ''} repo{v.repos.length + v.missing.length === 1 ? '' : 's'}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* repos and facts */}
        <div ref={listRef} className="flex-1 min-w-0 overflow-y-auto scrollbar-hide pr-1 select-text">
          {!inv || (inv.scanning && !inv.projects.length) ? (
            <div className="text-xs font-mono text-reka-gold animate-pulse p-4">{'>'} Reading every repo for tools, keys, hosting and addresses…</div>
          ) : !shown.length ? (
            <div className="text-xs font-mono text-gray-400 p-4">Nothing matches. Try a service (stripe), a key (SERVICE_ROLE), a domain (antarax.ai) or an address (noreply).</div>
          ) : (
            shown.map(({ g, repos, missing, count }) => (
              <section key={g.name} className="mb-6">
                <div className="flex flex-wrap items-baseline gap-3 border-b border-reka-cyan/20 pb-1 mb-2">
                  <h3 className="text-base font-bold text-white neon-text tracking-wider">{g.name}</h3>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-reka-cyan/60">{KIND_LABEL[g.kind] ?? g.kind}</span>
                  <span className="text-[10px] font-mono text-gray-500">{repos.length} repo{repos.length === 1 ? '' : 's'} here · {count} fact{count === 1 ? '' : 's'}{missing.length ? ` · ${missing.length} not cloned` : ''}</span>
                  {g.repos.length > 0 && <button type="button" onClick={() => openDoc('access-register', g.name)} className="ml-auto flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-gold border border-reka-gold/40 rounded px-2 py-0.5 hover:bg-reka-gold/10"><FileText size={11} /> Access Register draft</button>}
                </div>
                {repos.map(({ repo, facts }) => <RepoBlock key={repo.id} repo={repo} facts={facts} onRotate={k => openDoc('rotation', k)} openByDefault={repos.length === 1 || words.length > 0 || cat !== 'all' || groupName != null} />)}
                {missing.length > 0 && (
                  <div className="text-[11px] font-mono text-gray-500 mt-1 pl-1">
                    Not cloned on this machine, so not inventoried:{' '}
                    {missing.map((m, i) => (
                      <span key={m.name}>{i > 0 && ', '}{m.url ? <a href={m.url} target="_blank" rel="noreferrer" className="text-reka-cyan/70 hover:text-reka-cyan">{m.name}</a> : m.name}</span>
                    ))}
                  </div>
                )}
              </section>
            ))
          )}
          {total > 0 && <div className="h-2" />}
        </div>
      </div>
      </>)}
      <div className="text-[10px] font-mono text-gray-500">Read from each repo's files on this machine. Never a password or key value: keys are listed by name with the API they call. Personal and client addresses are masked.</div>
    </div>
  );
};

const RepoBlock: React.FC<{ repo: ProjectInventory; facts: InventoryFact[]; openByDefault: boolean; onRotate: (key: string) => void }> = ({ repo, facts, openByDefault, onRotate }) => {
  const [open, setOpen] = useState(openByDefault);
  useEffect(() => setOpen(openByDefault), [openByDefault]);
  const byCat = CATS.map(c => ({ c, items: facts.filter(f => f.category === c.id) })).filter(x => x.items.length);
  return (
    <div className="mb-2 rounded border border-reka-cyan/10 bg-reka-dark/30">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex flex-wrap items-baseline gap-2 px-3 py-2 text-left hover:bg-reka-cyan/5">
        <ChevronRight size={12} className={`self-center text-reka-cyan transition-transform ${open ? 'rotate-90' : ''}`} />
        <FolderGit2 size={12} className="self-center text-reka-cyan/70" />
        <span className="text-sm font-mono text-white">{repo.name}</span>
        <span className="text-[10px] font-mono text-gray-500 truncate">{repo.repo ? repo.repo.replace(/^https:\/\//, '') : 'local only, not on GitHub'}</span>
        {repo.branch && <span className="text-[10px] font-mono text-reka-gold/80">{repo.branch}</span>}
        <span className="ml-auto flex flex-wrap gap-1">
          {byCat.slice(0, 6).map(({ c, items }) => <span key={c.id} className={`text-[9px] font-mono uppercase tracking-widest border rounded px-1.5 ${c.tone}`}>{c.label} {items.length}</span>)}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          <div className="text-[10px] font-mono text-gray-500 mb-2 truncate" title={[repo.path, ...(repo.alsoAt ?? [])].join('\n')}>
            {repo.path}{repo.alsoAt?.length ? ` · also checked out in ${repo.alsoAt.length} other folder${repo.alsoAt.length === 1 ? '' : 's'}` : ''}
          </div>
          {byCat.map(({ c, items }) => (
            <div key={c.id} className="mb-2">
              <div className={`text-[10px] font-mono uppercase tracking-widest mb-1 ${c.tone.split(' ')[0]}`}>{c.label} · {items.length}</div>
              <div className="grid gap-0.5">
                {items.map((f, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,200px)_minmax(0,1fr)] gap-3 items-baseline text-[11px] font-mono border-b border-reka-cyan/5 py-1">
                    <span className="text-gray-400 truncate" title={f.label}>{f.label === f.value ? (f.category === 'service' ? 'Uses' : '') : f.label}</span>
                    <span className="min-w-0">
                      <span className="text-white break-all">{f.value}</span>
                      {f.masked && <span className="text-gray-500"> · masked</span>}
                      {f.category === 'apikey' && <button type="button" onClick={() => onRotate(f.value)} className="ml-2 inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-reka-gold/80 border border-reka-gold/30 rounded px-1.5 hover:bg-reka-gold/10" title="Everything to update when this key is rotated"><KeyRound size={9} /> rotation checklist</button>}
                      {f.evidence.length > 0 && <span className="block text-gray-500 truncate" title={f.evidence.join('\n')}>{f.evidence.join(' · ')}</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default InventoryPanel;
