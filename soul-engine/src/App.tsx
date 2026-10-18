// Soul Engine v4: Today is the soul as a full page with only a HUD; Chats, Tasks, Projects and Inventory share a
// sidebar and a breadcrumb; a chat or task opens in a side panel; Ctrl+K jumps anywhere.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SoulCore from './components/SoulCore';
import LockScreen from './components/LockScreen';
import { SoulMood } from './types';
import { querySoulEngine, sendToChat, useChats, useFeed, useFlow, useInventory, useNewBuild, useSnapshot, useStatus, useTasks } from './services/soulService';
import { hueOf, MAIN_HUE, seedOf } from './projects';
import { fmtCost, fmtTokens } from './format';
import { LockPrefs, readLocked, readPrefs, writeLocked, writePrefs } from './lock';
import { ChatsView, InventoryView, ProjectsView, TasksView, TodayHUD, VIEWS, type AppCtx, type View } from './v4/views';
import { ChatPanel, DocModal, Palette, SendDialog, TaskPanel } from './v4/panels';
import { Avatar, chatName, Icon } from './v4/ui';
import { LockMenu } from './v4/lockmenu';
import './v4/v4.css';

// Routes: "#/" Today, "#/chats", "#/tasks", "#/projects", "#/inventory"; inside a project "#/p/<project>/<view>".
function parseHash(): { scope: string | null; view: View } {
  const h = window.location.hash.replace(/^#\/?/, '');
  const legacy: Record<string, View> = { status: 'projects', relay: 'chats', soul: 'today', '': 'today' };
  const asView = (v: string | undefined): View => (VIEWS.some(([id]) => id === v) ? (v as View) : legacy[v ?? ''] ?? 'today');
  const p = /^p\/([^/]+)(?:\/([a-z]+))?\/?$/.exec(h);
  if (p) return { scope: decodeURIComponent(p[1]), view: p[2] ? asView(p[2]) : 'projects' };
  const r = /^(status|relay)\/(.+)$/.exec(h);
  if (r) return { scope: decodeURIComponent(r[2]), view: asView(r[1]) };
  return { scope: null, view: asView(h.split('/')[0]) };
}
const hashFor = (scope: string | null, view: View) => (scope ? `#/p/${encodeURIComponent(scope)}/${view}` : view === 'today' ? '#/' : `#/${view}`);

type Drawer = { type: 'chat' | 'task'; id: string; list?: string[] } | null;
type Send = { chatId: string; title: string; text: string } | null;

const App: React.FC = () => {
  const { snapshot, link } = useSnapshot();
  const inventory = useInventory();
  const chats = useChats() ?? [];
  const feed = useFeed() ?? [];
  const tasks = useTasks() ?? [];
  const { status } = useStatus(60000);
  const flow = useFlow(20000);
  const newBuild = useNewBuild();

  const [{ scope, view }, setRoute] = useState(parseHash);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [palette, setPalette] = useState(false);
  const [send, setSend] = useState<Send>(null);
  const [doc, setDoc] = useState<{ title: string; markdown: string } | null>(null);
  const [toast, setToast] = useState('');
  const [topoMode, setTopoMode] = useState<'diagram' | 'board'>('diagram');
  const [answer, setAnswer] = useState({ answer: '', meta: '', busy: false });
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const on = () => { setRoute(parseHash()); setDrawer(null); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((s: string | null, v: View) => { const h = hashFor(s, v); if (window.location.hash !== h) window.location.hash = h; else setRoute({ scope: s, view: v }); setDrawer(null); window.scrollTo(0, 0); }, []);
  const go = useCallback((v: View) => navigate(scope, v), [navigate, scope]);
  const setScope = useCallback((s: string | null) => navigate(s, view), [navigate, view]);
  const flash = (t: string) => { setToast(t); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 4200); };

  // ---- Away mode ----
  const [locked, setLocked] = useState(readLocked);
  const [lockPrefs, setLockPrefs] = useState<LockPrefs>(readPrefs);
  const lock = useCallback(() => { writeLocked(true); setLocked(true); setPalette(false); }, []);
  const unlock = useCallback(() => { writeLocked(false); setLocked(false); }, []);
  const savePrefs = useCallback((p: LockPrefs) => { writePrefs(p); setLockPrefs(p); }, []);
  useEffect(() => {
    if (locked || !lockPrefs.autoMin) return;
    let t: ReturnType<typeof setTimeout>;
    const arm = () => { clearTimeout(t); t = setTimeout(lock, lockPrefs.autoMin * 60_000); };
    const evs = ['pointermove', 'pointerdown', 'keydown', 'wheel'];
    evs.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, arm)); };
  }, [locked, lockPrefs.autoMin, lock]);
  useEffect(() => {
    if (!newBuild) return;
    const reload = () => { if (readLocked() || document.hidden) location.reload(); };
    reload();
    document.addEventListener('visibilitychange', reload);
    return () => document.removeEventListener('visibilitychange', reload);
  }, [newBuild]);

  const statusMap = useMemo(() => new Map((status ?? []).map((s) => [s.name, s])), [status]);
  const ctx: AppCtx = {
    chats, feed, tasks, status: status ?? [], inventory, snapshot, scope, setScope, go,
    statusOf: (n) => statusMap.get(n),
    openChat: (id, list) => { const c = chats.find((x) => x.id === id); if (c && scope && c.project !== scope) navigate(c.project, view); setDrawer({ type: 'chat', id, list }); },
    openTask: (id) => setDrawer({ type: 'task', id }),
    askRoadmap: (chatId) => {
      const c = chats.find((x) => x.id === chatId); if (!c) return;
      setSend({ chatId, title: `Ask “${chatName(c)}” to write the ${c.project} roadmap`, text: `/soul-roadmap\n\nPlease draft docs/ROADMAP.md for ${c.project} in the REKA format, from its plans, build plans and readiness notes. Show me the draft before writing the file, then commit it.` });
    },
  };

  // ---- Keyboard ----
  const drawerList = drawer?.type === 'chat' ? (drawer.list ?? chats.filter((c) => !scope || c.project === scope).map((c) => c.id)) : [];
  const drawerIdx = drawer?.type === 'chat' ? drawerList.indexOf(drawer.id) : -1;
  const step = (d: number) => { if (drawer?.type !== 'chat') return; const id = drawerList[drawerIdx + d]; if (id) setDrawer({ ...drawer, id }); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (locked) return;
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); lock(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      const typing = (e.target as HTMLElement)?.closest('input, textarea');
      if (e.key === 'Escape' && drawer && !send && !palette) setDrawer(null);
      if (!typing && drawer?.type === 'chat' && !send && !palette) { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // ---- Ask the soul (offline unless SOUL_ASK_API=on) ----
  const onAsk = async (q: string) => {
    setAnswer({ answer: '', meta: '', busy: true });
    let text = '', meta = '';
    try {
      await querySoulEngine({ question: q, focusId: null, history: [], scope }, (e) => {
        if (e.type === 'meta') meta = `${e.offline ? 'offline answer' : e.model}${e.projects.length ? ` · ${e.projects.join(', ')}` : ''}`;
        else if (e.type === 'delta') { text += e.text; setAnswer({ answer: text, meta, busy: true }); }
        else if (e.type === 'error') { text += `\n${e.message}`; }
      });
    } catch { text = 'The hub is not answering.'; }
    setAnswer({ answer: text || 'No answer.', meta, busy: false });
  };

  const openDoc = async (kind: 'access-register' | 'rotation', arg: string) => {
    if (!arg) return;
    try {
      const r = await fetch(kind === 'access-register' ? `/api/docs/access-register?project=${encodeURIComponent(arg)}` : `/api/docs/rotation?key=${encodeURIComponent(arg)}`);
      const d = (await r.json()) as { title?: string; markdown?: string; error?: string };
      setDoc({ title: d.title ?? arg, markdown: d.markdown ?? d.error ?? 'Nothing found.' });
    } catch { flash('The hub is not answering.'); }
  };

  // ---- Badges: only what asks you to act ----
  const inScope = (p: string) => !scope || scope === p;
  const badges: Partial<Record<View, [number, string]>> = {
    chats: [chats.filter((c) => inScope(c.project) && c.state === 'waiting').length, 'wait'],
    tasks: [tasks.filter((t) => inScope(t.project) && t.status === 'blocked').length, 'wait'],
    projects: [(status ?? []).filter((s) => inScope(s.name) && s.live.some((l) => !l.ok && !l.staging && l.source !== 'platform address')).length, 'red'],
  };

  // The soul reads the room: busy while it answers, its own hue while chats work, calm otherwise.
  const working = chats.filter((c) => inScope(c.project) && c.state === 'working').length;
  const mood = answer.busy ? SoulMood.ANALYZING : working > 0 ? SoulMood.CONNECTED : SoulMood.IDLE;
  const hue = scope ? hueOf(scope) : MAIN_HUE;
  const soul = <SoulCore mood={mood} intensity={answer.busy ? 0.8 : Math.min(0.7, 0.25 + working * 0.1)} hue={hue} seed={scope ? seedOf(scope) : 0} />;

  const immersive = view === 'today';
  useEffect(() => { document.body.classList.toggle('immersive', immersive); }, [immersive]);
  const viewLabel = VIEWS.find(([id]) => id === view)?.[1] ?? '';
  const drawerChat = drawer?.type === 'chat' ? chats.find((c) => c.id === drawer.id) : undefined;
  const drawerTask = drawer?.type === 'task' ? tasks.find((t) => t.id === drawer.id) : undefined;
  const t = snapshot?.totals;
  const projectsInNav = (status ?? []).map((s) => s.name);
  const sendChat = send ? chats.find((c) => c.id === send.chatId) : undefined;
  const linkLabel = link === 'online' ? 'Live' : link === 'linking' ? 'Linking…' : 'Hub not answering';

  const navItem = (id: View, label: string, cls: string) => { const [n, k] = badges[id] ?? [0, '']; return <button key={id} type="button" className={cls} aria-current={view === id ? 'page' : undefined} onClick={() => go(id)}>{Icon[id]}<span>{label}</span>{n > 0 && <span className={`nb ${k}`}>{n}</span>}</button>; };

  return (
    <>
      <div className="shell">
        <aside className="side" aria-label="Navigation">
          <div className="brand"><b>REKA</b><span>Soul Engine</span></div>
          <button type="button" className="searchbtn" onClick={() => setPalette(true)}>{Icon.search}Search or jump to<kbd>Ctrl K</kbd></button>
          <nav aria-label="Places">{VIEWS.map(([id, l]) => navItem(id, l, 'navitem'))}</nav>
          <div className="side-k">Projects</div>
          <div>
            <button type="button" className="projitem" aria-current={!scope ? 'true' : undefined} onClick={() => setScope(null)}><span className="dot" style={{ background: 'var(--accent)' }} />All projects</button>
            {projectsInNav.map((n) => { const cs = chats.filter((c) => c.project === n); return (
              <button key={n} type="button" className="projitem" aria-current={scope === n ? 'true' : undefined} onClick={() => setScope(n)}>
                <Avatar name={n} size="sm" /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
                {cs.some((c) => c.state === 'waiting') ? <i className="wait" title="waiting for you" /> : cs.some((c) => c.state === 'working') ? <i className="live" title="working" /> : null}
              </button>); })}
          </div>
          <div className="side-foot">
            <div className="sidemetrics"><span>Today <b>{t ? fmtTokens(t.tokensToday) : '—'}</b> tokens</span><span><b>{fmtCost(t?.costToday)}</b></span></div>
            <div className="sidemetrics"><span>{linkLabel}</span>{newBuild && <button type="button" className="update-btn" onClick={() => location.reload()}>Updated · Reload</button>}</div>
            <LockMenu prefs={lockPrefs} onPrefs={savePrefs} onLock={lock} />
          </div>
        </aside>
        <div className="content">
          <header className="top">
            <nav className="crumbs" aria-label="You are here">
              {scope ? <button type="button" onClick={() => setScope(null)}>All projects</button> : <span className="here">All projects</span>}
              {scope && <><span className="sep">›</span>{view === 'projects' && !drawer ? <span className="here">{scope}</span> : <button type="button" onClick={() => navigate(scope, 'projects')}>{scope}</button>}</>}
              {!(scope && view === 'projects') && <><span className="sep">›</span>{drawer ? <button type="button" onClick={() => setDrawer(null)}>{viewLabel}</button> : <span className="here">{viewLabel}</span>}</>}
              {drawer && <><span className="sep">›</span><span className="here">{drawerChat ? chatName(drawerChat) : drawerTask?.title ?? ''}</span></>}
            </nav>
            <div className="top-right"><button type="button" className="askbtn" onClick={() => go('today')}>{Icon.spark}<span>Ask the soul</span></button></div>
          </header>
          <main>
            {view === 'today' && <TodayHUD ctx={ctx} soul={soul} badges={badges} ask={{ ...answer, onAsk }} onSearch={() => setPalette(true)} onLock={lock} update={newBuild} />}
            {view === 'chats' && <ChatsView ctx={ctx} topoMode={topoMode} setTopoMode={setTopoMode} />}
            {view === 'tasks' && <TasksView ctx={ctx} />}
            {view === 'projects' && <ProjectsView ctx={ctx} />}
            {view === 'inventory' && <InventoryView ctx={ctx} onDoc={openDoc} />}
          </main>
        </div>
      </div>

      <nav className="bottomnav" aria-label="Places">{VIEWS.map(([id, l]) => navItem(id, l, ''))}</nav>
      {drawer && <div className="drawer-scrim" onClick={() => setDrawer(null)} />}
      <aside className={`drawer ${drawer ? 'open' : ''}`} aria-hidden={!drawer} aria-label="Details">
        {drawerChat && <ChatPanel c={drawerChat} ctx={ctx} topoMode={topoMode} setTopoMode={setTopoMode} onClose={() => setDrawer(null)}
          onPrev={drawerIdx > 0 ? () => step(-1) : undefined} onNext={drawerIdx >= 0 && drawerIdx < drawerList.length - 1 ? () => step(1) : undefined}
          pos={drawerIdx >= 0 ? `${drawerIdx + 1} of ${drawerList.length}` : undefined} />}
        {drawerTask && <TaskPanel t={drawerTask} ctx={ctx} onClose={() => setDrawer(null)} />}
      </aside>
      {palette && <Palette ctx={ctx} onClose={() => setPalette(false)} onLock={lock} />}
      {send && sendChat && <SendDialog chat={sendChat} title={send.title} text={send.text} onCancel={() => setSend(null)}
        onSend={async (txt) => { const ok = await sendToChat(send.chatId, txt); setSend(null); flash(ok ? `Queued for “${chatName(sendChat)}”. It arrives in that chat through the soul-relay plugin.` : 'The hub did not take the message.'); }} />}
      {doc && <DocModal title={doc.title} markdown={doc.markdown} onClose={() => setDoc(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      {locked && <LockScreen snapshot={snapshot} flow={flow} status={status} pinHash={lockPrefs.pinHash} hello={lockPrefs.hello} onUnlock={unlock} />}
    </>
  );
};

export default App;
