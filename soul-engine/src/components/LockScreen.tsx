import React, { useEffect, useMemo, useRef, useState } from 'react';
import SoulCore from './SoulCore';
import { FlowGraph, ProjectStatus, Snapshot, SoulMood } from '../types';
import { hashPin, verifyHello } from '../lock';

interface LockScreenProps {
  snapshot: Snapshot | null;
  flow: FlowGraph | null;
  status: ProjectStatus[] | null;
  pinHash: string | null;
  hello: string | null;
  onUnlock: () => void;
}

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const s = (n: number) => (n === 1 ? '' : 's');
const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const say = (n: number) => words[n - 1] ?? String(n);

/** What the soul murmurs: the shape of what is happening, never a name, so a passer-by learns nothing. */
function murmurs(snapshot: Snapshot | null, flow: FlowGraph | null, status: ProjectStatus[] | null): string[] {
  const out: string[] = [];
  const chats = flow?.chats ?? [];
  const working = chats.filter((c) => c.phase === 'working').length;
  const waiting = chats.filter((c) => c.phase === 'waiting').length;
  const running = flow?.totals.running ?? 0;
  const down = (status ?? []).filter((p) => p.live.some((l) => !l.ok && !l.staging && l.source !== 'platform address')).length;
  const blocked = (status ?? []).reduce((n, p) => n + (p.roadmap?.kind === 'roadmap' ? p.roadmap.counts.blocked : 0), 0);
  const burn = snapshot?.totals.burnPerMin ?? 0;
  const hour = new Date().getHours();

  if (working) out.push(`${say(working)} chat${s(working)} still thinking…`, 'tools turning over in the dark', 'somewhere, something is being built');
  if (waiting) out.push(`${say(waiting)} chat${s(waiting)} waiting for you`, 'a question hangs, unanswered');
  if (running) out.push(`${say(running)} smaller mind${s(running)} out on errands`, 'work handed down, coming back soon');
  if (down) out.push(down === 1 ? 'one light has gone quiet' : `${say(down)} lights have gone quiet`);
  if (blocked) out.push(`${blocked} thing${s(blocked)} wait${blocked === 1 ? 's' : ''} on a decision`);
  if (burn > 200_000) out.push('the current runs fast tonight');
  else if (working || running) out.push('a slow, steady current');
  if (!working && !waiting && !running) out.push('all quiet', 'resting, but listening', 'listening for footsteps');
  if (hour >= 23 || hour < 5) out.push('it is late', 'the repos are sleeping');
  else if (hour < 11) out.push('morning light on the roadmaps');
  out.push('remembering every project', 'humming to itself', 'holding the threads together', '…');
  return out;
}

/** Away mode: only the soul, drifting and murmuring. Any key or click wakes it; with a PIN, the PIN does. */
const LockScreen: React.FC<LockScreenProps> = ({ snapshot, flow, status, pinHash, hello, onUnlock }) => {
  const lines = useMemo(() => murmurs(snapshot, flow, status), [snapshot, flow, status]);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const [text, setText] = useState('');
  const [fade, setFade] = useState(false);
  const [pos, setPos] = useState({ x: 50, y: 74 });
  const [asking, setAsking] = useState(false);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [helloMsg, setHelloMsg] = useState('');
  const verifying = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // Type one murmur out, hold it, let it fade, then the next.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const next = (last: string) => {
      if (!alive) return;
      let line = pick(linesRef.current);
      if (line === last && linesRef.current.length > 1) line = pick(linesRef.current);
      setPos({ x: 32 + Math.random() * 36, y: 66 + Math.random() * 14 });
      setFade(false);
      let i = 0;
      const type = () => {
        if (!alive) return;
        i += 1;
        setText(line.slice(0, i));
        if (i < line.length) timer = setTimeout(type, 55 + Math.random() * 60);
        else timer = setTimeout(() => { setFade(true); timer = setTimeout(() => next(line), 1800); }, 3800);
      };
      timer = setTimeout(type, 600);
    };
    next('');
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const wake = (e: Event) => {
      if (asking) return;
      if (e instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      if (hello) {
        // Windows Hello first: face, fingerprint or the Windows PIN.
        if (verifying.current) return;
        verifying.current = true;
        setHelloMsg('');
        verifyHello(hello).then((ok) => {
          verifying.current = false;
          if (ok) { onUnlock(); return; }
          if (pinHash) { setAsking(true); setTimeout(() => input.current?.focus(), 30); }
          else setHelloMsg('Windows Hello did not verify. Press a key to try again.');
        });
        return;
      }
      if (!pinHash) { onUnlock(); return; }
      setAsking(true);
      setTimeout(() => input.current?.focus(), 30);
    };
    window.addEventListener('keydown', wake);
    window.addEventListener('pointerdown', wake);
    return () => { window.removeEventListener('keydown', wake); window.removeEventListener('pointerdown', wake); };
  }, [asking, pinHash, hello, onUnlock]);

  // The PIN prompt hides itself again if no one types.
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => { setAsking(false); setPin(''); }, 20_000);
    return () => clearTimeout(t);
  }, [asking, pin]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinHash && (await hashPin(pin)) === pinHash) { onUnlock(); return; }
    setWrong(true);
    setPin('');
    setTimeout(() => setWrong(false), 1200);
  };

  const working = (flow?.chats ?? []).some((c) => c.phase === 'working');
  const mood = working ? SoulMood.CONNECTED : SoulMood.IDLE;

  return (
    <div className="fixed inset-0 z-[200] bg-reka-void overflow-hidden select-none cursor-none" role="dialog" aria-label="Soul Engine is locked">
      <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 50% 50%, #00f2ff 1px, transparent 1px)', backgroundSize: '48px 48px' }} />
      <div className="absolute inset-0 lock-drift">
        <SoulCore mood={mood} intensity={working ? 0.45 : 0.25} hue="#00f2ff" seed={0} />
      </div>
      <div className="absolute -translate-x-1/2 text-center pointer-events-none" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
        <span className={`font-mono text-sm md:text-base tracking-[0.25em] lowercase text-reka-cyan/70 transition-opacity duration-[1600ms] ${fade ? 'opacity-0' : 'opacity-100'}`}
          style={{ textShadow: '0 0 12px rgba(0,242,255,0.5)' }} aria-live="off">{text}</span>
      </div>
      {asking && pinHash && (
        <form onSubmit={submit} className="absolute left-1/2 bottom-[14%] -translate-x-1/2 flex flex-col items-center gap-2 cursor-auto">
          <label htmlFor="soul-pin" className="text-[10px] font-mono uppercase tracking-[0.3em] text-gray-500">PIN</label>
          <input id="soul-pin" ref={input} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={e => setPin(e.target.value)}
            className={`w-40 text-center bg-transparent border-b text-white font-mono tracking-[0.5em] py-1 focus:outline-none ${wrong ? 'border-[#ff6b6b] animate-pulse' : 'border-reka-cyan/40'}`} />
          {wrong && <span className="text-[10px] font-mono text-[#ff8c8c]">not that one</span>}
        </form>
      )}
      {!asking && <div className="absolute bottom-6 inset-x-0 text-center text-[10px] font-mono tracking-[0.3em] uppercase text-gray-700 lock-hint">{helloMsg || (hello ? 'press any key for windows hello' : pinHash ? 'press any key, then your PIN' : 'press any key')}</div>}
    </div>
  );
};

export default LockScreen;
