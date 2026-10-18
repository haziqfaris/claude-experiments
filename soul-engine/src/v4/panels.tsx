// The side panel (a chat or a task), Ctrl+K quick search, the confirm-before-send dialog, and a document viewer.
import React, { useEffect, useRef, useState } from 'react';
import type { ChatItem, TaskItem } from '../types';
import { hueOf } from '../projects';
import { ago, fmtCost } from '../format';
import { Avatar, chatName, Health, Icon, MODEL_C, modelOf, Progress, recentSplits, SplitBoard, StatePill, Topology } from './ui';
import type { AppCtx, View } from './views';
import { ChatCard, VIEWS } from './views';

export const ChatPanel: React.FC<{ c: ChatItem; ctx: AppCtx; topoMode: 'diagram' | 'board'; setTopoMode: (m: 'diagram' | 'board') => void; onClose: () => void; onPrev?: () => void; onNext?: () => void; pos?: string }> = ({ c, ctx, topoMode, setTopoMode, onClose, onPrev, onNext, pos }) => {
  const hue = hueOf(c.project), s = ctx.statusOf(c.project);
  const done = c.steps.filter((x) => x.done).length;
  const splits = recentSplits(c);
  const rm = s?.roadmap;
  return (
    <>
      <div className="drawer-top">
        <Avatar name={c.project} /><h2>{chatName(c)}</h2><StatePill state={c.state} />
        <span className="drawer-nav">
          <button type="button" className="iconbtn" onClick={onPrev} disabled={!onPrev} aria-label="Previous chat" title="Previous chat (←)">{Icon.prev}</button>
          {pos && <span className="tiny dim">{pos}</span>}
          <button type="button" className="iconbtn" onClick={onNext} disabled={!onNext} aria-label="Next chat" title="Next chat (→)">{Icon.next}</button>
        </span>
        <button type="button" className="iconbtn" onClick={onClose} aria-label="Close">{Icon.close}</button>
      </div>
      <div className="small muted">
        <button type="button" className="linklike" style={{ color: hue }} onClick={() => { ctx.setScope(c.project); ctx.go('projects'); }}>{c.project}</button>
        {' · '}{c.model ?? 'model unknown'} · context {Math.round(c.contextPct ?? 0)}% · {fmtCost(c.costToday)} today · {fmtCost(c.costTotal)} in all · {c.turns} asks · {c.filesTouched} files · {Date.now() - c.lastActivity < 90_000 ? 'active now' : `last active ${ago(c.lastActivity)} ago`}
      </div>
      {c.goal && <div className="small" style={{ marginTop: 10 }}>Goal (first ask): <span className="muted">“{c.goal}”</span></div>}
      {c.asked && <div className="glass" style={{ marginTop: 12, padding: '12px 14px', borderColor: 'rgba(251,191,36,0.35)' }}><div className="label" style={{ color: 'var(--wait)' }}>Waiting for you</div><div style={{ marginTop: 4 }}>“{c.asked}”</div></div>}
      {c.state === 'working' && c.doing && <div className="small" style={{ marginTop: 10 }}><span style={{ color: 'var(--work)' }}>Now:</span> {c.doing.tool}{c.doing.detail ? ` · ${c.doing.detail}` : ''}</div>}

      {c.steps.length > 0 && <>
        <div className="section-h"><h2>Plan</h2><span className="tiny muted">{done} of {c.steps.length} steps</span></div>
        <Progress done={done} total={c.steps.length} hue={hue} />
        <div className="steps">{c.steps.map((x, i) => <span key={i} className={`step ${x.done ? 'done' : x.now ? 'now' : ''}`}>{x.done ? '✓ ' : x.now ? '▸ ' : ''}{x.text}</span>)}</div>
      </>}

      <div className="section-h"><h2>Project</h2></div>
      <section className="glass ctxpanel" style={{ ['--hue' as string]: hue }}>
        <div className="ctx-cell"><div className="label">Working on</div><div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}><Avatar name={c.project} /><div><div style={{ fontWeight: 600 }}>{c.project}</div><div className="tiny muted">{s?.kind ?? c.folder} · {ctx.chats.filter((x) => x.project === c.project).length} chats</div></div></div></div>
        <div className="ctx-cell"><div className="label">Health</div><div style={{ marginTop: 8 }}>{s ? <Health s={s} /> : <span className="small dim">not in a project</span>}</div></div>
        <div className="ctx-cell"><div className="label">Roadmap</div><div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {rm?.kind === 'roadmap' ? <span className="rm-chip">Roadmap {rm.counts.done}/{rm.counts.done + rm.counts.inProgress + rm.counts.blocked + rm.counts.planned}</span>
            : <><span className="rm-chip none">No roadmap</span>{s && <button type="button" className="ghost" onClick={() => ctx.askRoadmap(c.id)}>Ask this chat to write it</button>}</>}
        </div></div>
        <div className="ctx-cell"><div className="label">What’s next</div>
          <div className="small" style={{ marginTop: 6 }}><span className="muted">This chat:</span> {c.asked ? 'Answer its question' : c.steps.find((x) => !x.done)?.text ?? (c.state === 'idle' ? 'Nothing left in its plan' : 'No plan')}</div>
          {s && <div className="small" style={{ marginTop: 4 }}><span className="muted">Project:</span> {s.next}</div>}</div>
      </section>

      {splits.length > 0 && <>
        <div className="section-h"><h2>How it split its work</h2><span className="tiny muted">{splits.length} in the last day · <span style={{ color: 'var(--work)' }}>{splits.filter((a) => a.status === 'running').length} running</span> · <span style={{ color: 'var(--done)' }}>{splits.filter((a) => a.status === 'returned').length} merged</span></span>
          <span style={{ marginLeft: 'auto' }} className="seg" role="group" aria-label="Show splits as"><button type="button" aria-pressed={topoMode === 'diagram'} onClick={() => setTopoMode('diagram')}>Diagram</button><button type="button" aria-pressed={topoMode === 'board'} onClick={() => setTopoMode('board')}>Board</button></span></div>
        <div className="glass bigtopo-wrap">{topoMode === 'board' ? <SplitBoard chats={[c]} onOpen={() => {}} /> : <div id="bigtopo"><Topology chat={c} big /></div>}</div>
      </>}

      {c.lastReply && <><div className="section-h"><h2>Last said</h2></div><div className="glass box small" style={{ whiteSpace: 'pre-wrap' }}>{c.lastReply}</div></>}
      {c.prompt && <><div className="section-h"><h2>Your last ask</h2></div><div className="glass box small muted">“{c.prompt}”</div></>}
    </>
  );
};

export const TaskPanel: React.FC<{ t: TaskItem; ctx: AppCtx; onClose: () => void }> = ({ t, ctx, onClose }) => {
  const c = t.chat ? ctx.chats.find((x) => x.id === t.chat) : null;
  const [copied, setCopied] = useState(false);
  const st = { todo: ['p-idle', 'to do'], doing: ['p-work', 'in progress'], blocked: ['p-wait', 'blocked'], done: ['p-done', 'done'] }[t.status];
  return (
    <>
      <div className="drawer-top"><Avatar name={t.project} /><h2>{t.title}</h2><span className={`pill ${st[0]}`}>{st[1]}</span><button type="button" className="iconbtn" onClick={onClose} aria-label="Close">{Icon.close}</button></div>
      <div className="small muted">{t.project} · {{ roadmap: 'Roadmap', plan: 'Chat plan', soul: 'Soul suggests' }[t.src]}{t.ref ? ` · ${t.ref}` : ''}{t.owner ? ` · ${t.owner}` : ''}{t.due ? ` · due ${t.due}` : ''}</div>
      <div className="section-h"><h2>Where it should run</h2></div>
      <div className="glass box">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="model" style={{ ['--m' as string]: MODEL_C[t.model] }}>{t.model}</span><span className="small">{t.where}</span></div>
        {t.why && <div className="small muted" style={{ marginTop: 6 }}>{t.why}{t.saving ? ` · saves about $${t.saving.toFixed(2)}` : ''}</div>}
        {t.instruction ? <>
          <div className="instr" style={{ marginTop: 10 }}>{t.instruction}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button type="button" className="copy" onClick={() => { navigator.clipboard?.writeText(t.instruction!).then(() => setCopied(true), () => setCopied(true)); setTimeout(() => setCopied(false), 1400); }}>{copied ? 'Copied' : 'Copy instruction'}</button>
          </div>
        </> : <div className="small muted" style={{ marginTop: 6 }}>Runs in the chat that owns it.</div>}
      </div>
      {c && <><div className="section-h"><h2>Chat</h2></div><ChatCard c={c} ctx={ctx} /></>}
    </>
  );
};

// ---- Ctrl+K ----
export interface PaletteItem { group: string; icon: string; hue?: string; label: string; sub?: string; run: () => void }
export const Palette: React.FC<{ ctx: AppCtx; onClose: () => void; onLock: () => void; setInvQ?: (q: string) => void }> = ({ ctx, onClose, onLock }) => {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const w = q.toLowerCase().trim(), m = (s: string) => !w || s.toLowerCase().includes(w);
  const items: PaletteItem[] = [];
  VIEWS.forEach(([id, l]) => { if (m(l)) items.push({ group: 'Go to', icon: '→', label: l, run: () => ctx.go(id as View) }); });
  if (m('All projects')) items.push({ group: 'Projects', icon: '✦', label: 'All projects', run: () => ctx.setScope(null) });
  ctx.status.forEach((s) => { if (m(s.name)) items.push({ group: 'Projects', icon: s.name[0], hue: hueOf(s.name), label: s.name, sub: s.stage ? `${s.stage.step} ${s.stage.name} · ${s.readiness.level}` : s.readiness.level, run: () => { ctx.setScope(s.name); ctx.go('projects'); } }); });
  ctx.chats.forEach((c) => { if (m(`${chatName(c)} ${c.project}`)) items.push({ group: 'Chats', icon: c.project[0], hue: hueOf(c.project), label: chatName(c), sub: `${c.project} · ${c.state === 'waiting' ? 'waiting for you' : c.state}`, run: () => ctx.openChat(c.id) }); });
  if (w) ctx.tasks.forEach((t) => { if (m(`${t.title} ${t.project}`)) items.push({ group: 'Tasks', icon: '✓', label: t.title, sub: t.project, run: () => ctx.openTask(t.id) }); });
  if (m('Lock now')) items.push({ group: 'Actions', icon: '✦', label: 'Lock now', run: onLock });
  const list = items.slice(0, 50);
  const s2 = Math.min(sel, Math.max(0, list.length - 1));
  const pick = (it: PaletteItem) => { onClose(); it.run(); };
  let g = '';
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search or jump to">
        <div className="pin"><span className="dim">{Icon.search}</span><label htmlFor="pq" className="sr">Search or jump to</label>
          <input id="pq" ref={input} value={q} placeholder="Search projects, chats, tasks, or type an action" autoComplete="off"
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(list.length - 1, s2 + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(0, s2 - 1)); }
              else if (e.key === 'Enter' && list[s2]) { e.preventDefault(); pick(list[s2]); }
            }} /></div>
        <div className="presults">
          {list.map((it, i) => {
            const head = it.group !== g ? (g = it.group) : null;
            return (
              <React.Fragment key={i}>
                {head && <div className="pgroup">{head}</div>}
                <button type="button" className="pitem" aria-selected={i === s2} onMouseEnter={() => setSel(i)} onClick={() => pick(it)}>
                  <span className="ptype" style={it.hue ? { color: it.hue, background: `color-mix(in srgb, ${it.hue} 18%, transparent)` } : undefined}>{it.icon}</span>
                  <span style={{ minWidth: 0 }}><span className="small" style={{ fontWeight: 500, display: 'block' }}>{it.label}</span>{it.sub && <span className="tiny muted">{it.sub}</span>}</span>
                  {i === s2 && <span className="pk">Enter</span>}
                </button>
              </React.Fragment>
            );
          })}
          {!list.length && <p className="small dim" style={{ padding: 12 }}>No match.</p>}
        </div>
        <div className="pfoot"><span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span></div>
      </div>
    </div>
  );
};

// ---- Confirm before sending into a chat ----
export const SendDialog: React.FC<{ chat: ChatItem; text: string; title: string; onCancel: () => void; onSend: (text: string) => void }> = ({ chat, text, title, onCancel, onSend }) => {
  const [msg, setMsg] = useState(text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
      <div className="sendbox" role="dialog" aria-modal="true" aria-labelledby="sendTitle">
        <h3 id="sendTitle">{title}</h3>
        <div className="tiny muted">{chat.state === 'working' ? 'This chat is working: the message waits until its current turn ends.' : chat.state === 'waiting' ? 'This chat is waiting for your answer to another question; it will see this message next.' : 'This chat is idle and will pick it up when its Claude Code window is open.'}</div>
        <label htmlFor="sendMsg" className="sr">Message to send</label>
        <textarea id="sendMsg" ref={ref} value={msg} onChange={(e) => setMsg(e.target.value)} />
        <div className="tiny dim" style={{ marginTop: 8 }}>Delivered into “{chatName(chat)}” by the soul-relay plugin, as a message from the Soul Engine. It runs there on your subscription. Nothing is sent until you press Send.</div>
        <div className="row"><button type="button" className="btn text" onClick={onCancel}>Cancel</button><button type="button" className="btn primary" disabled={!msg.trim()} onClick={() => onSend(msg)}>Send to chat</button></div>
      </div>
    </div>
  );
};

export const DocModal: React.FC<{ title: string; markdown: string; onClose: () => void }> = ({ title, markdown, onClose }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sendbox" role="dialog" aria-modal="true" aria-label={title} style={{ width: 'min(820px, 100%)' }}>
        <h3>{title}</h3>
        <textarea readOnly value={markdown} style={{ minHeight: '50vh' }} />
        <div className="row"><button type="button" className="btn text" onClick={onClose}>Close</button><button type="button" className="btn primary" onClick={() => { navigator.clipboard?.writeText(markdown).then(() => setCopied(true), () => setCopied(true)); }}>{copied ? 'Copied' : 'Copy as Markdown'}</button></div>
      </div>
    </div>
  );
};

export const modelShort = modelOf;
