// Savings: is work moving to cheaper models, and what does it save? Cost per day by model, against what the same
// work would cost all on Opus; hand-offs; and the auto-split switch, for every chat or one chat at a time.
import React, { useState } from 'react';
import type { AutoSplit, Savings } from '../types';
import { hueOf } from '../projects';
import { ago, fmtCost, fmtTokens } from '../format';
import { usePoll } from '../services/soulService';
import type { AppCtx } from './views';
import { MODEL_C } from './ui';

const FAM: [string, string, string][] = [['opus', 'Opus', MODEL_C.opus], ['fable', 'Fable', '#fde68a'], ['sonnet', 'Sonnet', MODEL_C.sonnet], ['haiku', 'Haiku', MODEL_C.haiku], ['other', 'Other', '#94a3b8']];
const CHEAP = new Set(['sonnet', 'haiku']);
const usd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const dayName = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });

async function post(body: unknown): Promise<AutoSplit | null> {
  try { const r = await fetch('/api/autosplit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.ok ? ((await r.json()) as AutoSplit) : null; } catch { return null; }
}

export const SavingsView: React.FC<{ ctx: AppCtx }> = ({ ctx }) => {
  const [range, setRange] = useState<7 | 14>(7);
  // The per-chat totals cover exactly the range asked for.
  const polled = usePoll<Savings>(`/api/savings?days=${range}`, 30000);
  const [split, setSplit] = useState<AutoSplit | null>(null);
  if (!polled) return <div className="view-in"><div className="head"><h1>Savings</h1></div><div className="skel" /></div>;
  const s = { ...polled, autoSplit: split ?? polled.autoSplit };
  const days = s.days.slice(-range);
  const dels = s.delegates.slice(-range);
  const spent = days.reduce((n, d) => n + d.main.cost + d.split.cost, 0) + dels.reduce((n, d) => n + d.cost, 0);
  const allOpus = days.reduce((n, d) => n + d.allOpus, 0) + dels.reduce((n, d) => n + d.cost + d.saved, 0);
  const saved = Math.max(0, allOpus - spent);
  const tok = (fams: (f: string) => boolean) => days.reduce((n, d) => n + Object.entries(d.models).filter(([f]) => fams(f)).reduce((m, [, b]) => m + b.output, 0), 0);
  const cheapShare = tok((f) => CHEAP.has(f)) / Math.max(1, tok(() => true));
  const handoffs = days.reduce((n, d) => n + d.handoffs, 0) + dels.reduce((n, d) => n + d.count, 0);
  const splitCost = days.reduce((n, d) => n + d.split.cost, 0);
  const splitCheap = days.reduce((n, d) => n + Object.entries(d.models).filter(([f]) => CHEAP.has(f)).reduce((m, [, b]) => m + b.cost, 0), 0);
  // Hand-offs that ran on Opus anyway: the usual reason nothing was saved.
  const opusHandoffs = handoffs > 0 && splitCost > 0 && splitCheap < splitCost * 0.1;

  const flip = async (body: unknown) => { const r = await post(body); if (r) setSplit(r); };
  const since = s.autoSplit.since;
  const beforeAfter = since ? (() => {
    const b = s.days.filter((d) => d.date + 86_400_000 <= since), a = s.days.filter((d) => d.date + 86_400_000 > since);
    const share = (ds: typeof s.days) => { const all = ds.reduce((n, d) => n + d.main.cost + d.split.cost, 0); const op = ds.reduce((n, d) => n + d.allOpus, 0); return { all, op, saved: Math.max(0, op - all), days: ds.length }; };
    return { before: share(b), after: share(a) };
  })() : null;

  // ---- Chart: cost per day by model; the outline above each bar is what it would have cost all on Opus ----
  const W = 720, H = 220, P = 34, bw = (W - P - 10) / days.length;
  const max = Math.max(1, ...days.map((d) => d.allOpus), ...days.map((d) => d.main.cost + d.split.cost));
  const y = (v: number) => H - 24 - (v / max) * (H - 44);
  const sinceX = since ? days.findIndex((d) => d.date + 86_400_000 > since) : -1;

  const chats = s.chats.filter((c) => c.lastTs >= days[0].date).slice(0, 14);
  const projOf = (id: string, cwd: string | null) => ctx.chats.find((c) => c.id === id)?.project ?? (cwd ? cwd.split(/[\\/]/).pop() ?? 'Other' : 'Other');
  const state = (id: string) => (id in s.autoSplit.chats ? (s.autoSplit.chats[id] ? 'on' : 'off') : 'default');

  return (
    <div className="view-in">
      <div className="head"><h1>Savings</h1><span className="s">Is work moving to cheaper models, and what does it save · estimated from token counts at API rates; your subscription meter is not readable</span></div>

      <section className={`glass sv-switch ${s.autoSplit.all ? 'on' : ''}`}>
        <div>
          <b>Auto-split</b>
          <p>Chats on Opus hand mechanical work (searches, running tests, bulk edits, commit messages) to Haiku and Sonnet workers on their own, and keep the hard thinking. Needs soul-relay 0.3.0 in each chat; it starts from that chat’s next turn. A chat can override this with <code>/soul-split on|off</code> or in the list below.</p>
          {since && <p className="tiny dim">First switched on {ago(since)} ago. The chart marks that day so you can compare before and after.</p>}
        </div>
        <button type="button" role="switch" aria-checked={s.autoSplit.all} className="sv-toggle" onClick={() => flip({ on: !s.autoSplit.all })}><span /></button>
        <span className="sv-state">{s.autoSplit.all ? 'On for every chat' : 'Off'}</span>
      </section>

      <div className="tiles sv-tiles">
        <div className="glass tile"><small>Spent, last {range} days</small><b>{usd(spent)}</b></div>
        <div className="glass tile"><small>All on Opus would be</small><b>{usd(allOpus)}</b></div>
        <div className={`glass tile ${saved > 0 ? 'good' : ''}`}><small>Saved</small><b>{usd(saved)}</b><span className="tiny dim">{allOpus ? pct(saved / allOpus) : '0%'} of it</span></div>
        <div className="glass tile"><small>Work on Haiku / Sonnet</small><b>{pct(cheapShare)}</b><span className="tiny dim">of output</span></div>
        <div className="glass tile"><small>Hand-offs</small><b>{handoffs}</b></div>
      </div>

      {opusHandoffs && <div className="glass suggest sv-note"><span className="sv-bang">!</span><div className="small"><b>Chats handed work off, but it ran on Opus too</b><span className="muted"> · {usd(splitCost)} of hand-offs saved nothing. They used Explore or general-purpose agents, which run on the chat’s own model. Auto-split points chats at the Haiku and Sonnet workers instead.</span></div></div>}
      {!handoffs && <div className="glass suggest sv-note"><span className="sv-bang">i</span><div className="small"><b>No work was handed off in the last {range} days</b><span className="muted"> · every token ran on the chat’s own model. Turn on auto-split above, then come back in a few days.</span></div></div>}

      <section className="glass box sv-chart">
        <div className="sv-chart-h">
          <div className="label">Cost per day by model</div>
          <div className="sv-legend">{FAM.filter(([f]) => days.some((d) => d.models[f]?.cost)).map(([f, l, c]) => <span key={f}><i style={{ background: c }} />{l}</span>)}<span><i className="outline" />all on Opus</span></div>
          <div className="seg" role="group" aria-label="Range"><button type="button" aria-pressed={range === 7} onClick={() => setRange(7)}>7 days</button><button type="button" aria-pressed={range === 14} onClick={() => setRange(14)}>14 days</button></div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Estimated cost per day, stacked by model, with what it would cost all on Opus">
          {[0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={P} x2={W - 6} y1={y(max * f)} y2={y(max * f)} stroke="var(--outline)" /><text x={P - 6} y={y(max * f) + 3} textAnchor="end" className="sv-ax">${Math.round(max * f)}</text></g>)}
          {days.map((d, i) => {
            const x = P + i * bw + bw * 0.18, w = bw * 0.64;
            let top = H - 24;
            const segs = FAM.map(([f, , c]) => { const v = d.models[f]?.cost ?? 0; const h = (v / max) * (H - 44); top -= h; return v ? <rect key={f} x={x} y={top} width={w} height={h} fill={c} rx={2}><title>{`${dayName(d.date)} · ${f}: ${usd(v)} · ${fmtTokens(d.models[f]!.tokens)} tokens`}</title></rect> : null; });
            const total = d.main.cost + d.split.cost;
            return (
              <g key={d.date}>
                {segs}
                {d.allOpus > total + 0.005 && <rect x={x - 2} y={y(d.allOpus)} width={w + 4} height={(d.allOpus / max) * (H - 44)} fill="none" stroke="var(--accent)" strokeDasharray="3 3" rx={3}><title>{`All on Opus: ${usd(d.allOpus)} · saved ${usd(d.allOpus - total)}`}</title></rect>}
                {d.handoffs > 0 && <circle cx={x + w / 2} cy={y(Math.max(total, d.allOpus)) - 8} r={3} fill="var(--work)"><title>{`${d.handoffs} hand-off${d.handoffs === 1 ? '' : 's'}`}</title></circle>}
                <text x={x + w / 2} y={H - 8} textAnchor="middle" className="sv-ax">{dayName(d.date)}</text>
              </g>
            );
          })}
          {sinceX >= 0 && <g><line x1={P + sinceX * bw + 2} x2={P + sinceX * bw + 2} y1={14} y2={H - 22} stroke="var(--accent)" strokeWidth={1.5} /><text x={P + sinceX * bw + 6} y={22} className="sv-ax" fill="var(--accent)">auto-split on</text></g>}
        </svg>
        <p className="tiny dim" style={{ margin: '6px 0 0' }}>Bars: what each day cost, by model. Dashed outline: what the same calls would cost all on Opus (the gap is the saving). Green dot: a day with hand-offs. Hover for numbers.</p>
      </section>

      {beforeAfter && beforeAfter.before.days > 0 && beforeAfter.after.days > 0 && (
        <section className="glass box sv-ba">
          <div className="label">Before and after auto-split</div>
          <div className="sv-ba-row"><span>Before ({beforeAfter.before.days} days)</span><b>{usd(beforeAfter.before.all / beforeAfter.before.days)}/day</b><span className="dim">saved {pct(beforeAfter.before.saved / Math.max(0.01, beforeAfter.before.op))}</span></div>
          <div className="sv-ba-row"><span>After ({beforeAfter.after.days} days)</span><b>{usd(beforeAfter.after.all / beforeAfter.after.days)}/day</b><span className="dim">saved {pct(beforeAfter.after.saved / Math.max(0.01, beforeAfter.after.op))}</span></div>
          <p className="tiny dim">Busy days cost more whatever the split, so compare the saved share, not only the daily cost.</p>
        </section>
      )}

      <div className="section-h"><h2>Chats</h2><span className="tiny dim">last {range} days, most expensive first</span></div>
      <div className="glass xtable" role="table" aria-label="Chats">
        <div className="sv-row xh" role="row"><span>Chat</span><span>Spent</span><span title="Cost of the work its sub-agents and workers did">Handed off</span><span title="What the same calls would cost all on Opus, minus what they cost">Saved</span><span>Auto-split</span></div>
        {chats.map((c) => {
          const cost = c.main.cost + c.split.cost, sv = Math.max(0, c.allOpus - cost), p = projOf(c.id, c.cwd), st = state(c.id);
          return (
            <div key={c.id} className="sv-row" role="row">
              <span className="xname"><i className="dot" style={{ background: hueOf(p) }} /><span><b>{c.name ?? 'Unnamed chat'}</b><small>{p} · {c.handoffs} hand-off{c.handoffs === 1 ? '' : 's'}</small></span></span>
              <span>{fmtCost(cost)}</span>
              <span>{c.split.cost ? `${fmtCost(c.split.cost)} (${pct(c.split.cost / Math.max(0.01, cost))})` : <span className="dim">none</span>}</span>
              <span className={sv > 0.01 ? 'sv-good' : 'dim'}>{sv > 0.01 ? fmtCost(sv) : '—'}</span>
              <span className="seg sv-seg" role="group" aria-label="Auto-split for this chat">
                {(['default', 'on', 'off'] as const).map((k) => <button key={k} type="button" aria-pressed={st === k} title={k === 'default' ? `Follow the switch above (${s.autoSplit.all ? 'on' : 'off'})` : `Always ${k} for this chat`} onClick={() => flip(k === 'default' ? { session: c.id, reset: true } : { session: c.id, on: k === 'on' })}>{k === 'default' ? 'Auto' : k === 'on' ? 'On' : 'Off'}</button>)}
              </span>
            </div>
          );
        })}
        {!chats.length && <div className="sv-row"><span className="dim">No chats in this range.</span></div>}
      </div>
    </div>
  );
};
