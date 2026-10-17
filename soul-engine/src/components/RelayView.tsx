import React, { useMemo, useState } from 'react';
import { Check, Copy, CornerDownLeft, GitBranch, Lightbulb, ListChecks, Workflow } from 'lucide-react';
import { Delegation, FlowAgent, FlowChat, FlowGraph, FlowSuggestion, StepRoute } from '../types';
import { DashProject, hueOf, MAIN_HUE, projectOfPath } from '../projects';
import { ago, fmtCost, fmtTokens } from '../format';

type Family = 'opus' | 'sonnet' | 'haiku';
const FAMILIES: { id: Family; label: string; note: string; color: string }[] = [
  { id: 'opus', label: 'Opus', note: 'judgment · the main chat', color: '#ffb347' },
  { id: 'sonnet', label: 'Sonnet', note: 'builds, tests · second chats', color: '#c792ff' },
  { id: 'haiku', label: 'Haiku', note: 'search, writing · quick hand-offs', color: '#4dffe1' },
];
const COLOR: Record<Family, string> = { opus: '#ffb347', sonnet: '#c792ff', haiku: '#4dffe1' };

function family(model: string | null | undefined, fallback: Family = 'opus'): Family {
  if (!model) return fallback;
  if (/haiku/i.test(model)) return 'haiku';
  if (/sonnet/i.test(model)) return 'sonnet';
  if (/opus|fable/i.test(model)) return 'opus';
  return fallback;
}
const fmtDur = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)}m` : `${(ms / 3_600_000).toFixed(1)}h`);
const projectOf = projectOfPath;

const Pill: React.FC<{ fam: Family; text?: string }> = ({ fam, text }) => (
  <span className="text-[10px] font-mono uppercase tracking-widest rounded px-1.5 py-0.5" style={{ color: COLOR[fam], border: `1px solid ${COLOR[fam]}55`, background: `${COLOR[fam]}12` }}>{text ?? fam}</span>
);

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = 'Copy instruction' }) => {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-widest text-reka-cyan border border-reka-cyan/30 rounded px-1.5 py-0.5 hover:bg-reka-cyan/10">
      {done ? <Check size={10} /> : <Copy size={10} />} {done ? 'Copied' : label}
    </button>
  );
};

/** A hand-off: a sub-agent, a delegate() call or a workflow, and whether it came back. */
const HandoffCard: React.FC<{ a: FlowAgent }> = ({ a }) => {
  const fam = family(a.model, a.kind === 'delegate' ? 'haiku' : 'opus');
  const running = a.status === 'running';
  return (
    <div className={`rounded border bg-reka-dark/50 px-2.5 py-2 ${running ? 'relay-run' : ''}`} style={{ borderColor: `${COLOR[fam]}44` }}>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-400">
        {a.kind === 'workflow' ? <Workflow size={11} /> : <GitBranch size={11} />}
        <span className="truncate">{a.kind === 'delegate' ? 'delegate' : a.agentType ?? a.kind}{a.background ? ' · background' : ''}</span>
        <span className="ml-auto" style={{ color: running ? COLOR[fam] : a.status === 'failed' ? '#ff8c8c' : undefined }}>
          {running ? 'running' : a.status === 'returned' ? 'returned' : a.status}
        </span>
      </div>
      <div className="text-xs font-mono text-white mt-1 line-clamp-2" title={a.task || a.label}>{a.label}</div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-mono text-gray-400 mt-1">
        <span>{fmtTokens(a.tokens)} tok</span>
        {a.cost != null && <span>{fmtCost(a.cost)}</span>}
        {a.toolCalls > 0 && <span>{a.toolCalls} tool calls</span>}
        <span>{fmtDur((a.endedAt ?? Date.now()) - a.startedAt)}</span>
      </div>
      {a.status === 'returned' && (
        <div className="flex items-center gap-1 text-[10px] font-mono mt-1" style={{ color: `${COLOR[fam]}cc` }}>
          <CornerDownLeft size={10} /> back in the main chat {a.endedAt ? ago(a.endedAt) : ''}
        </div>
      )}
    </div>
  );
};

/** A soul-relay delegation reported to the hub (delegate tool, /delegate, worker sessions). */
const DelegationCard: React.FC<{ d: Delegation }> = ({ d }) => {
  const fam = family(d.model, 'haiku');
  return (
    <div className="rounded border bg-reka-dark/50 px-2.5 py-2" style={{ borderColor: `${COLOR[fam]}44` }}>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-400">
        <span>{d.route === 'worker' ? `worker ${d.target}` : d.route === 'subagent' ? 'sub-agent' : 'delegate'}</span>
        <span className="ml-auto">returned</span>
      </div>
      <div className="text-xs font-mono text-white mt-1 line-clamp-2" title={d.task}>{d.task || 'task'}</div>
      <div className="flex gap-3 text-[10px] font-mono text-gray-400 mt-1">
        <span>{fmtCost(d.cost)}</span><span className="text-reka-teal">saved ≈ {fmtCost(d.saved)}</span><span>{ago(d.at)}</span>
      </div>
    </div>
  );
};

/** A plan step the soul suggests running elsewhere. Dashed: nothing has moved. */
const StepCard: React.FC<{ r: StepRoute; i: number }> = ({ r, i }) => (
  <div className="rounded border border-dashed bg-reka-dark/30 px-2.5 py-2" style={{ borderColor: `${COLOR[r.model]}66` }}>
    <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-400">
      <ListChecks size={11} /> plan step {i + 1}
      <span className="ml-auto" style={{ color: COLOR[r.model] }}>{r.where}</span>
    </div>
    <div className="text-xs font-mono text-white mt-1">{r.step}</div>
    <div className="text-[10px] font-mono text-gray-400 mt-0.5">{r.why}</div>
    {r.instruction && <div className="mt-1.5"><CopyButton text={r.instruction} /></div>}
  </div>
);

const SuggestionCard: React.FC<{ s: FlowSuggestion; chat?: FlowChat; project?: string | null; onSelect: () => void }> = ({ s, chat, project, onSelect }) => (
  <div className="rounded border border-reka-gold/25 bg-reka-dark/40 px-3 py-2">
    <button type="button" onClick={onSelect} className="text-left w-full">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-reka-gold/80">
        <Lightbulb size={11} /> {project ?? chat?.folder ?? 'chat'}
        {s.saving ? <span className="ml-auto text-reka-teal normal-case tracking-normal">≈ {fmtCost(s.saving)}</span> : null}
      </div>
      <div className="text-xs font-mono text-white mt-1">{s.title}</div>
      <div className="text-[11px] font-mono text-gray-400 mt-0.5 line-clamp-3">{s.why}</div>
    </button>
    <div className="flex items-center gap-2 mt-1.5">
      <span className="text-[10px] font-mono text-gray-500">→ {s.to}</span>
      <span className="ml-auto"><CopyButton text={s.instruction} /></span>
    </div>
  </div>
);

interface RelayViewProps {
  flow: FlowGraph | null;
  projects: DashProject[];
  /** Show only this project's chats. */
  project: string | null;
  onBack: () => void;
}

const RelayView: React.FC<RelayViewProps> = ({ flow, projects, project, onBack }) => {
  const [picked, setPicked] = useState<string | null>(null);
  const chats = useMemo(() => {
    const all = (flow?.chats ?? []).map(c => ({ c, p: projectOf(projects, c.cwd) }));
    return project ? all.filter(x => x.p?.name === project) : all;
  }, [flow, projects, project]);
  const order = { working: 0, waiting: 1, idle: 2 } as const;
  const sorted = [...chats].sort((a, b) => order[a.c.phase] - order[b.c.phase] || b.c.lastActivity - a.c.lastActivity);
  const sel = sorted.find(x => x.c.id === picked) ?? sorted[0] ?? null;
  const ids = new Set(chats.map(x => x.c.id));
  const suggestions = (flow?.suggestions ?? []).filter(s => ids.has(s.chatId));
  const hue = project ? hueOf(project) : MAIN_HUE;

  const lanes = useMemo(() => {
    const out: Record<Family, React.ReactNode[]> = { opus: [], sonnet: [], haiku: [] };
    if (!sel || !flow) return out;
    const c = sel.c;
    const mine = family(c.model);
    out[mine].push(
      <div key="chat" className={`rounded border px-2.5 py-2 ${c.phase === 'working' ? 'relay-run' : ''}`} style={{ borderColor: `${COLOR[mine]}88`, background: `${COLOR[mine]}10` }}>
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest" style={{ color: COLOR[mine] }}>
          This chat <span className="ml-auto normal-case tracking-normal text-gray-400">{c.phase === 'working' ? 'working' : c.phase === 'waiting' ? 'waiting for you' : `idle · ${ago(c.lastActivity)}`}</span>
        </div>
        {c.doing && <div className="text-xs font-mono text-white mt-1 truncate" title={c.doing.detail}>{c.doing.tool}{c.doing.detail ? ` · ${c.doing.detail}` : ''}</div>}
        {c.todos.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-0.5">
            {c.todos.slice(0, 6).map((t, i) => (
              <span key={i} className={`text-[11px] font-mono truncate ${t.status === 'completed' ? 'text-gray-500 line-through' : t.status === 'in_progress' ? 'text-white' : 'text-gray-400'}`}>
                {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '·'} {t.content}
              </span>
            ))}
          </div>
        )}
      </div>,
    );
    for (const a of c.agents) out[family(a.model, a.kind === 'delegate' ? 'haiku' : mine)].push(<HandoffCard key={a.id} a={a} />);
    for (const d of flow.delegations.filter(x => x.sessionId === c.id)) out[family(d.model, 'haiku')].push(<DelegationCard key={`${d.at}-${d.task}`} d={d} />);
    (flow.planRoutes[c.id] ?? []).forEach((r, i) => { if (r.where !== 'this chat') out[r.model].push(<StepCard key={`step-${i}`} r={r} i={i} />); });
    return out;
  }, [sel, flow]);

  const routes = sel ? flow?.planRoutes[sel.c.id] ?? [] : [];
  const t = flow?.totals;

  return (
    <div className="panel-in absolute inset-x-6 top-20 bottom-6 z-40 flex gap-4">
      {/* Chats */}
      <aside className="w-[280px] shrink-0 hidden lg:flex flex-col gap-2 glass-panel rounded-lg p-3 overflow-y-auto scrollbar-hide" aria-label="Chats">
        <div className="text-xs font-mono tracking-widest uppercase border-b border-reka-cyan/20 pb-2" style={{ color: hue }}>Relay // {project ?? 'all projects'}</div>
        {!flow && <p className="text-xs font-mono text-gray-400">Reading chats…</p>}
        {flow && !sorted.length && <p className="text-xs font-mono text-gray-400">No chats in the last 24 hours{project ? ` in ${project}` : ''}.</p>}
        {sorted.map(({ c, p }) => {
          const ph = p ? hueOf(p.name) : '#9ca3af';
          const run = c.agents.filter(a => a.status === 'running').length;
          return (
            <button key={c.id} type="button" onClick={() => setPicked(c.id)} aria-pressed={sel?.c.id === c.id}
              className={`text-left rounded px-2.5 py-2 border transition-colors ${sel?.c.id === c.id ? 'bg-reka-cyan/10 border-reka-cyan/40' : 'border-reka-cyan/10 bg-reka-dark/40 hover:bg-reka-cyan/5'}`}
              style={{ borderLeft: `3px solid ${ph}` }}>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${c.phase === 'working' ? 'animate-pulse' : ''}`} style={{ background: c.phase === 'idle' ? '#4b5563' : c.phase === 'waiting' ? '#ffd700' : ph }} />
                <span className="text-[11px] font-mono font-bold text-white truncate">{p?.name ?? c.folder}</span>
                <span className="ml-auto"><Pill fam={family(c.model)} /></span>
              </div>
              <div className="text-[11px] font-mono text-gray-300 mt-1 line-clamp-2">{c.title}</div>
              <div className="flex gap-2 text-[10px] font-mono text-gray-500 mt-1">
                <span>{c.phase === 'waiting' ? 'waiting for you' : c.phase === 'working' ? 'working' : ago(c.lastActivity)}</span>
                {c.agents.length > 0 && <span>{run ? `${run} running · ` : ''}{c.agents.length} hand-offs</span>}
                {c.plan && <span>plan · {c.plan.steps.length}</span>}
              </div>
            </button>
          );
        })}
      </aside>

      {/* Flow of the selected chat */}
      <section className="flex-1 min-w-0 flex flex-col gap-3 glass-panel rounded-lg p-3" aria-label="Flow">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {[
            ['Live chats', t ? String(t.liveChats) : '—'],
            ['Running hand-offs', t ? String(t.running) : '—'],
            ['Returned today', t ? String(t.returnedToday) : '—'],
            ['Hand-off cost today', t ? fmtCost(t.handoffCostToday) : '—'],
            ['Could save', t ? `≈ ${fmtCost(t.possibleSaving)}` : '—'],
          ].map(([l, v]) => (
            <div key={l} className="rounded bg-reka-dark/50 border border-reka-cyan/10 px-3 py-1.5">
              <div className="text-[10px] font-mono uppercase tracking-widest text-reka-cyan/60">{l}</div>
              <div className="text-base font-mono text-white">{v}</div>
            </div>
          ))}
        </div>
        {sel && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-reka-cyan/15 pb-2">
            <span className="text-sm font-bold text-white truncate max-w-[60%]" title={sel.c.title}>{sel.c.title}</span>
            <span className="text-[10px] font-mono text-gray-400">{sel.p?.name ?? sel.c.folder} · ctx {Math.round(sel.c.contextPct ?? 0)}% · {fmtCost(sel.c.costToday)} today</span>
            {routes.length > 0 && (
              <span className="ml-auto text-[10px] font-mono text-reka-gold/90">
                plan of {routes.length} · the soul suggests {routes.filter(r => r.model === 'haiku').length} Haiku · {routes.filter(r => r.model === 'sonnet').length} Sonnet · {routes.filter(r => r.model === 'opus').length} stay on Opus
              </span>
            )}
          </div>
        )}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-3 gap-3 overflow-y-auto scrollbar-hide">
          {FAMILIES.map(f => (
            <div key={f.id} className="rounded-lg border bg-reka-dark/30 p-2.5 flex flex-col gap-2 min-h-[200px]" style={{ borderColor: `${f.color}33` }}>
              <div>
                <div className="text-xs font-mono font-bold tracking-widest uppercase" style={{ color: f.color }}>{f.label}</div>
                <div className="text-[10px] font-mono text-gray-500">{f.note}</div>
              </div>
              {lanes[f.id].length ? lanes[f.id] : <p className="text-[11px] font-mono text-gray-600">Nothing on {f.label} in this chat.</p>}
            </div>
          ))}
        </div>
        <p className="text-[10px] font-mono text-gray-500">Solid cards ran or are running. Dashed cards are the soul's suggestions for the chat's plan: copy an instruction into the chat to use it. Nothing is sent for you.</p>
      </section>

      {/* Suggestions */}
      <aside className="w-[280px] shrink-0 hidden xl:flex flex-col gap-2 glass-panel rounded-lg p-3 overflow-y-auto scrollbar-hide" aria-label="Suggestions">
        <div className="text-xs font-mono tracking-widest uppercase text-reka-gold border-b border-reka-gold/20 pb-2">Soul suggests</div>
        {!suggestions.length && <p className="text-xs font-mono text-gray-400">Nothing to change right now.</p>}
        {suggestions.map(s => {
          const x = chats.find(y => y.c.id === s.chatId);
          return <SuggestionCard key={s.id} s={s} chat={x?.c} project={x?.p?.name ?? null} onSelect={() => setPicked(s.chatId)} />;
        })}
      </aside>
    </div>
  );
};

export default RelayView;
