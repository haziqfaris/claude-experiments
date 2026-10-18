// The conversation with the soul in the Today HUD: your questions on the right, the soul's answers on the left,
// a typing indicator while its home chat works, and a picker for which Claude Code chat answers.
import React, { useEffect, useRef, useState } from 'react';
import type { ChatItem } from '../types';
import { hueOf } from '../projects';
import { ago } from '../format';
import { chatName } from './ui';

export interface SoulMsg { id: string; role: 'you' | 'soul'; text: string; at: number; status?: string; meta?: string; pending?: boolean }

/** A small, safe Markdown subset: paragraphs, "-" bullets, numbered lines, **bold**, `code`. Builds elements, never HTML. */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? <b key={`${key}b${i++}`}>{t.slice(2, -2)}</b> : <code key={`${key}c${i++}`}>{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export const Markdown: React.FC<{ text: string }> = ({ text }) => {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `l${blocks.length}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={`b${blocks.length}`}>{items}</ol> : <ul key={`b${blocks.length}`}>{items}</ul>);
    list = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line), num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      const ordered = !!num && !bullet;
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    blocks.push(h ? <p key={`b${blocks.length}`}><b>{inline(h[1], `h${blocks.length}`)}</b></p> : <p key={`b${blocks.length}`}>{inline(line, `p${blocks.length}`)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
};

const SoulMark: React.FC<{ hue: string }> = ({ hue }) => <span className="sc-mark" style={{ ['--hue' as string]: hue }} aria-hidden="true" />;

export const SoulChat: React.FC<{ msgs: SoulMsg[]; hue: string; onClear: () => void; title: string }> = ({ msgs, hue, onClear, title }) => {
  const end = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [msgs]);
  if (!msgs.length) return null;
  return (
    <section className="sc" aria-label="Conversation with the soul" aria-live="polite">
      <div className="sc-head"><SoulMark hue={hue} /><b>{title}</b><button type="button" className="collapse" onClick={onClear}>New conversation</button></div>
      <div className="sc-body">
        {msgs.map((m) => m.role === 'you' ? (
          <div key={m.id} className="sc-row you"><div className="sc-bubble you">{m.text}</div></div>
        ) : (
          <div key={m.id} className="sc-row soul">
            <SoulMark hue={hue} />
            <div className="sc-bubble soul">
              {m.pending ? <div className="sc-typing"><i /><i /><i /><span>{m.status}</span></div> : <Markdown text={m.text} />}
              {!m.pending && (
                <div className="sc-meta">
                  <span>{m.meta}{m.meta ? ' · ' : ''}{ago(m.at)} ago</span>
                  <button type="button" onClick={() => { navigator.clipboard?.writeText(m.text).then(() => setCopied(m.id), () => setCopied(m.id)); setTimeout(() => setCopied(null), 1400); }}>{copied === m.id ? 'Copied' : 'Copy'}</button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
    </section>
  );
};

/** Which Claude Code chat answers: pick one from the dashboard, no command needed. */
export const HomePicker: React.FC<{ chats: ChatItem[]; home: { session: string; name: string | null } | null; onPick: (session: string | null) => void }> = ({ chats, home, onPick }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const recent = [...chats].sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 12);
  return (
    <div className="hp" ref={box}>
      <button type="button" className={`hp-btn ${home ? 'on' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Choose which Claude Code chat answers">
        <i className="dot" style={{ background: home ? 'var(--accent)' : 'var(--wait)' }} />
        {home ? <>Answers from <b>{home.name ?? 'your soul chat'}</b></> : <>Answers offline · <b>choose a chat</b></>}
        <span className="dim">▾</span>
      </button>
      {open && (
        <div className="hp-menu" role="listbox" aria-label="Choose the soul's home chat">
          <div className="pgroup">The soul answers in one of your Claude Code chats, on your subscription. Keep that chat open.</div>
          {recent.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected={home?.session === c.id} className="pitem" onClick={() => { onPick(c.id); setOpen(false); }}>
              <span className="ptype" style={{ color: hueOf(c.project), background: `color-mix(in srgb, ${hueOf(c.project)} 18%, transparent)` }}>{c.project[0]}</span>
              <span style={{ minWidth: 0 }}><span className="small" style={{ fontWeight: 500, display: 'block' }}>{chatName(c)}</span><span className="tiny muted">{c.project} · {Date.now() - c.lastActivity < 15 * 60_000 ? 'open now' : `last active ${ago(c.lastActivity)} ago`}</span></span>
              {home?.session === c.id && <span className="pk" style={{ color: 'var(--accent)' }}>home</span>}
            </button>
          ))}
          <button type="button" className="pitem" onClick={() => { onPick(null); setOpen(false); }}><span className="ptype">○</span><span className="small">Answer offline (no chat)</span></button>
        </div>
      )}
    </div>
  );
};
