import React, { useState, useCallback, useMemo, useRef } from 'react';
import SoulCore from './components/SoulCore';
import DataOrbits from './components/DataOrbits';
import Terminal from './components/Terminal';
import ProjectsPanel from './components/ProjectsPanel';
import FocusPanel from './components/FocusPanel';
import InventoryPanel from './components/InventoryPanel';
import { SoulMood, Message, OrbitNode, ChatTurn } from './types';
import { querySoulEngine, useProjectDetail, useSnapshot } from './services/soulService';
import { fmtCost, fmtTokens } from './format';
import { Activity, ArrowLeftRight, Coins, Database, Flame, Radio } from 'lucide-react';

const App: React.FC = () => {
  const { snapshot, link } = useSnapshot();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [afterglow, setAfterglow] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [coreSpend, setCoreSpend] = useState(0);
  const glowTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const projects = snapshot?.projects ?? [];
  const totals = snapshot?.totals;
  const shownId = focusId ?? projects[0]?.id ?? null;
  const detail = useProjectDetail(shownId);

  // The soul core reads the room: magenta while it analyzes, gold while it speaks,
  // white just after, teal while any session is live, cyan when all is quiet.
  const mood = isStreaming
    ? SoulMood.PROCESSING
    : isProcessing
      ? SoulMood.ANALYZING
      : afterglow
        ? SoulMood.HARMONIC
        : (totals?.liveSessions ?? 0) > 0
          ? SoulMood.CONNECTED
          : SoulMood.IDLE;
  const burnLevel = Math.min(0.5, (totals?.burnPerMin ?? 0) / 400_000);
  const intensity = isProcessing ? 0.8 : Math.round((0.2 + burnLevel) * 20) / 20;

  // Projects orbit the core; the most recent first.
  const nodes: OrbitNode[] = useMemo(
    () =>
      projects.slice(0, 8).map((p, i) => ({
        id: p.id,
        angle: (i * 360) / Math.min(8, projects.length) + i * 17,
        radius: 1.2 + (i % 4) * 0.3,
        speed: 0.2 - (i % 4) * 0.04,
        type: p.status === 'active' ? 'sensor' : p.status === 'recent' ? 'data' : 'interface',
        label: p.name,
        value: fmtTokens(p.tokensToday),
      })),
    [projects],
  );

  const handleSendMessage = useCallback(
    async (text: string) => {
      // "/find <text>" searches the inventory locally: no Claude call, nothing leaves the machine.
      const find = /^\/find\s+(.+)/i.exec(text.trim());
      if (find) {
        setMessages(prev => [...prev, { role: 'user', content: text, timestamp: Date.now() }]);
        let reply = '';
        try {
          const res = await fetch(`/api/inventory?q=${encodeURIComponent(find[1])}`);
          const data = (await res.json()) as { hits: { project: string; fact: { label: string; value: string; evidence: string[] } }[] };
          reply = data.hits.length
            ? data.hits.slice(0, 40).map(h => `• ${h.project} · ${h.fact.label}: ${h.fact.value}${h.fact.evidence[0] ? `  (${h.fact.evidence[0]})` : ''}`).join('\n') + (data.hits.length > 40 ? `\n…and ${data.hits.length - 40} more. Open INVENTORY to see all.` : '')
            : `No inventory fact matches "${find[1]}".`;
        } catch {
          reply = 'Resonance lost. The hub is unreachable.';
        }
        setMessages(prev => [...prev, { role: 'system', content: reply, timestamp: Date.now(), meta: '↳ inventory search · local' }]);
        return;
      }
      const history: ChatTurn[] = messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }));
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
        await querySoulEngine({ question: text, focusId, history }, e => {
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
            const about = e.projects.length ? `echoes from ${e.projects.join(', ')}` : 'echoes from all projects';
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
    [messages, focusId],
  );

  const linkLabel = link === 'online' ? (snapshot?.source === 'demo' ? 'DEMO FEED' : 'LIVE FEED') : link === 'linking' ? 'LINKING…' : 'SIGNAL LOST';

  return (
    <div className="relative w-screen h-screen bg-reka-dark overflow-hidden font-sans select-none">

      {/* Background Grid/Noise */}
      <div className="absolute inset-0 z-0 opacity-20"
           style={{
               backgroundImage: 'radial-gradient(circle at 50% 50%, #00f2ff 1px, transparent 1px)',
               backgroundSize: '40px 40px'
           }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-reka-void via-transparent to-reka-void z-0 pointer-events-none" />

      {/* Main Visualization Layer */}
      <SoulCore mood={mood} intensity={intensity} />
      <DataOrbits nodes={nodes} selectedId={focusId} onSelect={id => setFocusId(prev => (prev === id ? null : id))} />

      {/* Top HUD */}
      <div className="absolute top-0 left-0 w-full p-6 flex flex-wrap justify-between items-start gap-4 z-40 pointer-events-none">
        <div className="glass-panel p-4 rounded-br-2xl border-l-4 border-reka-cyan">
          <h1 className="text-2xl font-bold tracking-widest text-white neon-text">REKA <span className="text-reka-cyan text-sm font-mono align-top opacity-80">v2.5.0</span></h1>
          <div className="text-xs text-reka-cyan/60 font-mono mt-1 flex items-center gap-2">
            SOUL ENGINE INTERFACE
            <span className={`inline-flex items-center gap-1 ${link === 'online' ? 'text-reka-teal' : 'text-reka-gold'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${link === 'online' ? 'bg-reka-teal animate-pulse' : 'bg-reka-gold'}`} />
              {linkLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 justify-end">
          <MetricCard label="TOKENS TODAY" value={totals ? fmtTokens(totals.tokensToday) : '—'} icon={<Activity size={14}/>} />
          <MetricCard label="EST. COST" value={fmtCost(totals?.costToday)} icon={<Coins size={14}/>} />
          <MetricCard label="LIVE" value={totals ? `${totals.liveSessions}/${totals.sessions}` : '—'} icon={<Radio size={14}/>} className="hidden sm:flex" />
          <MetricCard label="FLUX/MIN" value={totals ? fmtTokens(totals.burnPerMin) : '—'} icon={<Flame size={14}/>} className="hidden md:flex" />
          <button type="button" onClick={() => setInventoryOpen(true)} className="glass-panel px-4 py-2 rounded flex flex-col items-end min-w-[100px] pointer-events-auto hover:border-reka-cyan/60 focus:outline-none focus:border-reka-cyan" aria-label="Open the project inventory">
            <div className="flex items-center gap-2 text-reka-cyan/70 text-[10px] font-bold tracking-wider mb-1"><Database size={14}/> INVENTORY</div>
            <div className="text-xl font-mono text-white neon-text">OPEN</div>
          </button>
          <MetricCard label="SAVED" value={snapshot ? fmtCost(snapshot.relay.savedToday) : '—'} icon={<ArrowLeftRight size={14}/>} className="hidden lg:flex" />
        </div>
      </div>

      {snapshot && <ProjectsPanel snapshot={snapshot} focusId={focusId} onFocus={setFocusId} />}
      <FocusPanel detail={detail} pinned={focusId != null} />
      <InventoryPanel open={inventoryOpen} onClose={() => setInventoryOpen(false)} onAsk={q => handleSendMessage(q)} />

      {/* Bottom Interface */}
      <Terminal
        messages={messages}
        onSendMessage={handleSendMessage}
        isProcessing={isProcessing}
        isStreaming={isStreaming}
        projects={projects}
        focusId={focusId}
        onFocus={setFocusId}
        coreSpend={coreSpend}
      />

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
