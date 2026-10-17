import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import SoulCore from './components/SoulCore';
import DataOrbits from './components/DataOrbits';
import Terminal from './components/Terminal';
import ProjectsDashboard from './components/ProjectsDashboard';
import { ActivityPanel, ProjectSessionsPanel, ProjectSidePanel } from './components/ProjectPanels';
import InventoryPanel from './components/InventoryPanel';
import RelayView from './components/RelayView';
import StatusView from './components/StatusView';
import { SoulMood, Message, OrbitNode, ChatTurn } from './types';
import { querySoulEngine, useFlow, useInventory, useProjectDetail, useSnapshot, useStatus } from './services/soulService';
import { buildProjects, hueOf, MAIN_HUE, seedOf } from './projects';
import { fmtCost, fmtTokens } from './format';
import { Activity, ArrowLeftRight, Coins, Database, Flame, Gauge, Network, Radio } from 'lucide-react';

/** "#/" is the main soul; "#/p/<project>" is that project's soul; "#/relay" (or "#/relay/<project>") is Relay. */
const readScope = (): string | null => {
  const m = /^#\/(?:p|relay)\/(.+)$/.exec(window.location.hash);
  return m ? decodeURIComponent(m[1]) : null;
};
const readRelay = () => /^#\/relay(\/|$)/.test(window.location.hash);
const readStatus = () => /^#\/status$/.test(window.location.hash);

type InvView = { mode: 'inventory' | 'changes'; register: boolean } | null;

const App: React.FC = () => {
  const { snapshot, link } = useSnapshot();
  const inventory = useInventory();
  const [scope, setScope] = useState<string | null>(readScope);
  const [relay, setRelay] = useState(readRelay);
  const [statusView, setStatusView] = useState(readStatus);
  const [focusId, setFocusId] = useState<string | null>(null);
  // One conversation per soul: '' is the main soul.
  const [threads, setThreads] = useState<Record<string, Message[]>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [afterglow, setAfterglow] = useState(false);
  const [invView, setInvView] = useState<InvView>(null);
  const [coreSpend, setCoreSpend] = useState(0);
  const [askMode, setAskMode] = useState<'api' | 'subscription'>('subscription');
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then((c: { ask?: 'api' | 'subscription' }) => setAskMode(c.ask === 'api' ? 'api' : 'subscription')).catch(() => {});
  }, []);
  const glowTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const onHash = () => { setScope(readScope()); setRelay(readRelay()); setStatusView(readStatus()); setInvView(null); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const openSoul = useCallback((name: string | null) => {
    window.location.hash = name ? `#/p/${encodeURIComponent(name)}` : '#/';
  }, []);
  const openRelay = useCallback((name: string | null) => {
    window.location.hash = name ? `#/relay/${encodeURIComponent(name)}` : '#/relay';
  }, []);
  const flow = useFlow(relay ? 4000 : 20000);
  const { status, refresh: refreshStatus } = useStatus(statusView ? 60000 : 300000);
  const board = relay || statusView;

  const key = scope ?? '';
  const messages = threads[key] ?? [];
  const dash = useMemo(() => buildProjects(snapshot, inventory), [snapshot, inventory]);
  const current = scope ? dash.find(p => p.name === scope) ?? null : null;
  const hue = scope ? hueOf(scope) : MAIN_HUE;
  const seed = scope ? seedOf(scope) : 0;

  const snapProjects = snapshot?.projects ?? [];
  const totals = snapshot?.totals;
  const detailId = scope ? current?.activity[0]?.id ?? null : null;
  const detail = useProjectDetail(detailId);

  // The soul reads the room: magenta while it analyzes, gold while it speaks, white just after,
  // its own hue while any of its sessions is live, calm when all is quiet.
  const live = scope ? current?.liveSessions ?? 0 : totals?.liveSessions ?? 0;
  const mood = isStreaming ? SoulMood.PROCESSING : isProcessing ? SoulMood.ANALYZING : afterglow ? SoulMood.HARMONIC : live > 0 ? SoulMood.CONNECTED : SoulMood.IDLE;
  // Burn is tracked across all projects only; a project soul glows with its live sessions instead.
  const burn = scope ? live * 60_000 : totals?.burnPerMin ?? 0;
  const intensity = isProcessing ? 0.8 : Math.round((0.2 + Math.min(0.5, burn / 400_000)) * 20) / 20;

  // Main soul: its projects orbit it, most recent first. A project soul: its repos.
  const nodes: OrbitNode[] = useMemo(() => {
    const ring = <T,>(items: T[], f: (x: T, i: number) => Omit<OrbitNode, 'angle' | 'radius' | 'speed'>) =>
      items.slice(0, 8).map((x, i) => ({ ...f(x, i), angle: (i * 360) / Math.min(8, items.length) + i * 17, radius: 1.2 + (i % 4) * 0.3, speed: 0.2 - (i % 4) * 0.04 }));
    if (current) {
      return ring(current.repos, r => {
        const act = current.activity.find(a => [r.path, ...(r.alsoAt ?? [])].some(p => p.toLowerCase() === a.path.toLowerCase()));
        return { id: r.id, type: act?.status === 'active' ? 'sensor' : act ? 'data' : 'interface', label: r.name, value: act ? fmtTokens(act.tokensToday) : `${r.facts.length} facts` };
      });
    }
    if (scope) return [];
    const ranked = dash.filter(p => p.kind !== 'activity' || p.lastActivity).sort((a, b) => b.lastActivity - a.lastActivity);
    return ring(ranked, p => ({ id: p.name, type: p.status === 'active' ? 'sensor' : p.status === 'recent' ? 'data' : 'interface', label: p.name, value: fmtTokens(p.tokensToday) }));
  }, [dash, current, scope]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const thread = key;
      const askScope = scope;
      const setMessages = (f: (prev: Message[]) => Message[]) => setThreads(t => ({ ...t, [thread]: f(t[thread] ?? []) }));
      // "/find <text>" searches the inventory locally: no Claude call, nothing leaves the machine.
      const find = /^\/find\s+(.+)/i.exec(text.trim());
      if (find) {
        setMessages(prev => [...prev, { role: 'user', content: text, timestamp: Date.now() }]);
        let reply = '';
        try {
          const res = await fetch(`/api/inventory?q=${encodeURIComponent(find[1])}${askScope ? `&project=${encodeURIComponent(askScope)}` : ''}`);
          const data = (await res.json()) as { hits: { project: string; fact: { label: string; value: string; evidence: string[] } }[] };
          reply = data.hits.length
            ? data.hits.slice(0, 40).map(h => `• ${h.project} · ${h.fact.label}: ${h.fact.value}${h.fact.evidence[0] ? `  (${h.fact.evidence[0]})` : ''}`).join('\n') + (data.hits.length > 40 ? `\n…and ${data.hits.length - 40} more. Open INVENTORY to see all.` : '')
            : `No inventory fact${askScope ? ` in ${askScope}` : ''} matches "${find[1]}".`;
        } catch {
          reply = 'Resonance lost. The hub is unreachable.';
        }
        setMessages(prev => [...prev, { role: 'system', content: reply, timestamp: Date.now(), meta: `↳ inventory search · local${askScope ? ` · ${askScope} only` : ''}` }]);
        return;
      }
      const history: ChatTurn[] = (threads[thread] ?? []).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));
      setMessages(prev => [...prev, { role: 'user', content: text, timestamp: Date.now() }]);
      setIsProcessing(true);
      setAfterglow(false);
      clearTimeout(glowTimer.current);

      let started = false;
      const append = (chunk: string, meta?: string) =>
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (started && last?.role === 'system') {
            next[next.length - 1] = { ...last, content: last.content + chunk, meta: meta ?? last.meta };
          } else {
            started = true;
            next.push({ role: 'system', content: chunk, timestamp: Date.now(), meta });
          }
          return next;
        });

      let meta = '';
      const steps: string[] = [];
      const setSteps = () => setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (started && last?.role === 'system') next[next.length - 1] = { ...last, tools: [...steps], meta };
        else { started = true; next.push({ role: 'system', content: '', timestamp: Date.now(), meta, tools: [...steps] }); }
        return next;
      });
      try {
        await querySoulEngine({ question: text, focusId: askScope ? null : focusId, history, scope: askScope }, e => {
          if (e.type === 'tool') {
            steps.push(e.label);
            setSteps();
          } else if (e.type === 'done' && e.usage) {
            const u = e.usage;
            const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
            meta = `${meta} · ${u.calls ?? 1} call${(u.calls ?? 1) === 1 ? '' : 's'} · ${k(u.input)} in / ${k(u.output)} out${u.cost != null ? ` · ~$${u.cost.toFixed(3)}` : ''}`;
            if (u.cost) setCoreSpend(s => s + (u.cost ?? 0));
            setSteps();
          } else if (e.type === 'meta') {
            const about = askScope ? `soul of ${askScope}` : e.projects.length ? `echoes from ${e.projects.join(', ')}` : 'echoes from all projects';
            meta = `↳ ${about} · ${e.offline ? 'offline' : e.model}`;
          } else if (e.type === 'delta') {
            setIsStreaming(true);
            append(e.text, meta);
          } else if (e.type === 'error') {
            append(`${started ? '\n' : ''}Entropy detected in the signal. ${e.message}`, meta);
          }
        });
      } catch {
        append('Resonance lost. The hub is unreachable. Is `npm run dev` running?');
      }

      setIsProcessing(false);
      setIsStreaming(false);
      setAfterglow(true);
      glowTimer.current = setTimeout(() => setAfterglow(false), 5000);
    },
    [threads, key, scope, focusId],
  );

  const linkLabel = link === 'online' ? (snapshot?.source === 'demo' ? 'DEMO FEED' : 'LIVE FEED') : link === 'linking' ? 'LINKING…' : 'SIGNAL LOST';
  const m = scope
    ? { tokens: current ? fmtTokens(current.tokensToday) : '—', cost: fmtCost(current?.costToday), live: current ? `${current.liveSessions}/${current.sessionCount}` : '—', flux: '—' }
    : { tokens: totals ? fmtTokens(totals.tokensToday) : '—', cost: fmtCost(totals?.costToday), live: totals ? `${totals.liveSessions}/${totals.sessions}` : '—', flux: totals ? fmtTokens(totals.burnPerMin) : '—' };

  return (
    <div className="relative w-screen h-screen bg-reka-dark overflow-hidden font-sans select-none">

      {/* Background grid, tinted with the soul's hue */}
      <div className="absolute inset-0 z-0 opacity-20 transition-all duration-700"
           style={{ backgroundImage: `radial-gradient(circle at 50% 50%, ${hue} 1px, transparent 1px)`, backgroundSize: '40px 40px' }} />
      <div className="absolute inset-0 bg-gradient-to-b from-reka-void via-transparent to-reka-void z-0 pointer-events-none" />

      {/* The soul: the main REKA soul, or the project's own */}
      {!board && <>
        <SoulCore key={key} mood={mood} intensity={intensity} hue={hue} seed={seed} />
        <DataOrbits nodes={nodes} hue={scope ? hue : undefined} selectedId={scope ? null : focusId}
          onSelect={id => (scope ? setInvView({ mode: 'inventory', register: false }) : openSoul(id))} />
      </>}

      {/* Top HUD */}
      <div className="absolute top-0 left-0 w-full p-6 flex flex-wrap justify-between items-start gap-4 z-40 pointer-events-none">
        <div className="glass-panel p-4 rounded-br-2xl border-l-4 pointer-events-auto" style={{ borderLeftColor: hue }}>
          <h1 className="text-2xl font-bold tracking-widest text-white neon-text">
            {scope || board ? <button type="button" onClick={() => openSoul(null)} className="hover:opacity-80" title="Back to the main soul">REKA</button> : 'REKA'}
            {scope && <span className="text-lg" style={{ color: hue }}> / {scope}</span>}
            <span className="text-reka-cyan text-sm font-mono align-top opacity-80"> v2.6.0</span>
          </h1>
          <div className="text-xs font-mono mt-1 flex items-center gap-2" style={{ color: `${hue}99` }}>
            {statusView ? 'STATUS // EVERY PROJECT' : relay ? 'RELAY // CHATS AND MODELS' : scope ? 'PROJECT SOUL' : 'MAIN SOUL // ALL PROJECTS'}
            <span className={`inline-flex items-center gap-1 ${link === 'online' ? 'text-reka-teal' : 'text-reka-gold'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${link === 'online' ? 'bg-reka-teal animate-pulse' : 'bg-reka-gold'}`} />
              {linkLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 justify-end">
          <MetricCard label="TOKENS TODAY" value={m.tokens} icon={<Activity size={14}/>} />
          <MetricCard label="EST. COST" value={m.cost} icon={<Coins size={14}/>} />
          <MetricCard label="LIVE" value={m.live} icon={<Radio size={14}/>} className="hidden sm:flex" />
          {!scope && <MetricCard label="FLUX/MIN" value={m.flux} icon={<Flame size={14}/>} className="hidden md:flex" />}
          <button type="button" onClick={() => (statusView ? openSoul(null) : (window.location.hash = '#/status'))} aria-pressed={statusView}
            className={`glass-panel px-4 py-2 rounded flex flex-col items-end min-w-[100px] pointer-events-auto hover:border-reka-cyan/60 focus:outline-none focus:border-reka-cyan ${statusView ? 'border-reka-gold/60' : ''}`}
            aria-label={statusView ? 'Back to the soul' : 'Open Status: stage, tasks left and live for every project'}>
            <div className="flex items-center gap-2 text-reka-cyan/70 text-[10px] font-bold tracking-wider mb-1"><Gauge size={14}/> STATUS</div>
            <div className="text-xl font-mono text-white neon-text">{statusView ? 'BACK' : status ? `${status.filter(s => s.live.some(l => l.ok && !l.staging)).length} LIVE` : 'OPEN'}</div>
          </button>
          <button type="button" onClick={() => (relay ? (scope ? openSoul(scope) : openSoul(null)) : openRelay(scope))} aria-pressed={relay}
            className={`glass-panel px-4 py-2 rounded flex flex-col items-end min-w-[100px] pointer-events-auto hover:border-reka-cyan/60 focus:outline-none focus:border-reka-cyan ${relay ? 'border-reka-gold/60' : ''}`}
            aria-label={relay ? 'Back to the soul' : 'Open Relay: what each chat is doing and where its work goes'}>
            <div className="flex items-center gap-2 text-reka-cyan/70 text-[10px] font-bold tracking-wider mb-1"><Network size={14}/> RELAY</div>
            <div className="text-xl font-mono text-white neon-text">{relay ? 'BACK' : flow ? `${flow.totals.running} RUN` : 'OPEN'}</div>
          </button>
          <button type="button" onClick={() => setInvView({ mode: 'inventory', register: false })} className="glass-panel px-4 py-2 rounded flex flex-col items-end min-w-[100px] pointer-events-auto hover:border-reka-cyan/60 focus:outline-none focus:border-reka-cyan" aria-label={scope ? `Open the inventory of ${scope}` : 'Open the inventory of all projects'}>
            <div className="flex items-center gap-2 text-reka-cyan/70 text-[10px] font-bold tracking-wider mb-1"><Database size={14}/> INVENTORY</div>
            <div className="text-xl font-mono text-white neon-text">{scope ? 'PROJECT' : 'ALL'}</div>
          </button>
          {!scope && <MetricCard label="SAVED" value={snapshot ? fmtCost(snapshot.relay.savedToday) : '—'} icon={<ArrowLeftRight size={14}/>} className="hidden lg:flex" />}
        </div>
      </div>

      {statusView ? (
        <StatusView status={status} onOpen={openSoul} onBack={() => openSoul(null)} onRefresh={refreshStatus} />
      ) : relay ? (
        <RelayView flow={flow} projects={dash} project={scope} onBack={() => openSoul(scope)} />
      ) : scope ? (
        current ? (
          <>
            <ProjectSidePanel project={current} onBack={() => openSoul(null)}
              onInventory={() => setInvView({ mode: 'inventory', register: false })}
              onChanges={() => setInvView({ mode: 'changes', register: false })}
              onRegister={() => setInvView({ mode: 'inventory', register: true })}
              status={status?.find(s => s.name === current.name) ?? null} />
            <ProjectSessionsPanel project={current} detail={detail} />
          </>
        ) : (
          <div className="absolute left-6 top-32 z-40 glass-panel rounded-lg p-4 text-xs font-mono text-gray-400">
            {inventory ? <>No project named “{scope}”. <button type="button" className="text-reka-cyan underline" onClick={() => openSoul(null)}>Back to the main soul</button></> : 'Loading the project…'}
          </div>
        )
      ) : (
        <>
          <ProjectsDashboard projects={dash} snapshot={snapshot} onOpen={openSoul} />
          <ActivityPanel projects={dash} onOpen={openSoul} />
        </>
      )}

      <InventoryPanel open={invView != null} scope={scope} initialMode={invView?.mode} openRegister={invView?.register}
        onClose={() => setInvView(null)} onAsk={q => handleSendMessage(q)} />

      {/* Bottom interface: talks to the soul on screen */}
      {!board && <Terminal
        messages={messages}
        onSendMessage={handleSendMessage}
        isProcessing={isProcessing}
        isStreaming={isStreaming}
        projects={snapProjects}
        focusId={focusId}
        onFocus={setFocusId}
        coreSpend={coreSpend}
        scope={scope}
        hue={hue}
        askMode={askMode}
      />}

    </div>
  );
};

// Simple helper component for HUD metrics
const MetricCard: React.FC<{ label: string, value: string, icon: React.ReactNode, className?: string }> = ({ label, value, icon, className = 'flex' }) => (
    <div className={`glass-panel px-4 py-2 rounded flex-col items-end min-w-[100px] ${className}`}>
        <div className="flex items-center gap-2 text-reka-cyan/70 text-[10px] font-bold tracking-wider mb-1">
            {icon} {label}
        </div>
        <div className="text-xl font-mono text-white neon-text">{value}</div>
    </div>
);

export default App;
