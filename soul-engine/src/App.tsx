import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import SoulCore from './components/SoulCore';
import DataOrbits from './components/DataOrbits';
import Terminal from './components/Terminal';
import ProjectsDashboard from './components/ProjectsDashboard';
import { ActivityPanel, ProjectSessionsPanel, ProjectSidePanel } from './components/ProjectPanels';
import InventoryPanel from './components/InventoryPanel';
import RelayView from './components/RelayView';
import StatusView from './components/StatusView';
import NavBar, { View } from './components/NavBar';
import LockScreen from './components/LockScreen';
import { LockPrefs, readLocked, readPrefs, writeLocked, writePrefs } from './lock';
import { SoulMood, Message, OrbitNode, ChatTurn } from './types';
import { querySoulEngine, useFlow, useInventory, useProjectDetail, useSnapshot, useStatus } from './services/soulService';
import { buildProjects, hueOf, MAIN_HUE, seedOf } from './projects';
import { fmtCost, fmtTokens } from './format';

/** Routes: "#/" main soul, "#/status", "#/relay"; inside a project "#/p/<project>", "#/p/<project>/status", "#/p/<project>/relay". */
function parseHash(): { scope: string | null; view: View } {
  const h = window.location.hash;
  const p = /^#\/p\/([^/]+)(?:\/(status|relay))?\/?$/.exec(h);
  if (p) return { scope: decodeURIComponent(p[1]), view: (p[2] as View) ?? 'soul' };
  const v = /^#\/(status|relay)(?:\/(.+))?$/.exec(h); // "#/relay/<project>" is the older form
  if (v) return { scope: v[2] ? decodeURIComponent(v[2]) : null, view: v[1] as View };
  return { scope: null, view: 'soul' };
}
const readScope = () => parseHash().scope;
const readRelay = () => parseHash().view === 'relay';
const readStatus = () => parseHash().view === 'status';
export function hashFor(scope: string | null, view: View): string {
  if (scope) return `#/p/${encodeURIComponent(scope)}${view === 'soul' ? '' : `/${view}`}`;
  return view === 'soul' ? '#/' : `#/${view}`;
}

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

  // Away mode: lock by hand (button or Ctrl+Shift+L) or after idle minutes; it survives a reload.
  const [locked, setLocked] = useState(readLocked);
  const [lockPrefs, setLockPrefs] = useState<LockPrefs>(readPrefs);
  const lock = useCallback(() => { writeLocked(true); setLocked(true); }, []);
  const unlock = useCallback(() => { writeLocked(false); setLocked(false); }, []);
  const savePrefs = useCallback((p: LockPrefs) => { writePrefs(p); setLockPrefs(p); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); lock(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [lock]);
  useEffect(() => {
    if (locked || !lockPrefs.autoMin) return;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => { clearTimeout(t); t = setTimeout(lock, lockPrefs.autoMin * 60_000); };
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'];
    events.forEach(ev => window.addEventListener(ev, arm, { passive: true }));
    arm();
    return () => { clearTimeout(t); events.forEach(ev => window.removeEventListener(ev, arm)); };
  }, [locked, lockPrefs.autoMin, lock]);

  useEffect(() => {
    const onHash = () => { setScope(readScope()); setRelay(readRelay()); setStatusView(readStatus()); setInvView(null); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((name: string | null, v: View) => { window.location.hash = hashFor(name, v); }, []);
  const openSoul = useCallback((name: string | null) => navigate(name, 'soul'), [navigate]);
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

      <NavBar
        scope={scope}
        view={statusView ? 'status' : relay ? 'relay' : 'soul'}
        projects={dash.filter(p => p.kind !== 'activity')}
        link={link}
        linkLabel={linkLabel}
        inventoryOpen={invView != null}
        onNavigate={navigate}
        onInventory={() => setInvView(v => (v ? null : { mode: 'inventory', register: false }))}
        lockPrefs={lockPrefs}
        onLockPrefs={savePrefs}
        onLock={lock}
        badges={{
          status: status ? `${status.filter(s => (!scope || s.name === scope) && s.live.some(l => l.ok && !l.staging)).length} live` : undefined,
          relay: flow && flow.totals.running ? `${flow.totals.running} running` : undefined,
        }}
        metrics={[
          { label: 'Tokens today', value: m.tokens },
          { label: 'Est. cost', value: m.cost },
          { label: 'Live chats', value: m.live },
          ...(scope ? [] : [{ label: 'Flux/min', value: m.flux, title: 'Tokens per minute, last two minutes' }, { label: 'Saved', value: snapshot ? fmtCost(snapshot.relay.savedToday) : '—', title: 'Saved by handing work to cheaper models today' }]),
        ]}
      />

      {statusView ? (
        <StatusView status={status} project={scope} projects={dash} flow={flow} onOpen={name => navigate(name, 'soul')} onFilter={name => navigate(name, 'status')} onRefresh={refreshStatus} />
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
          <div className="absolute left-6 top-20 z-40 glass-panel rounded-lg p-4 text-xs font-mono text-gray-400">
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

      {locked && <LockScreen snapshot={snapshot} flow={flow} status={status} pinHash={lockPrefs.pinHash} hello={lockPrefs.hello} onUnlock={unlock} />}
    </div>
  );
};

export default App;
