// Delegations reported by the soul-relay mod (POST /api/delegations).
import type { Delegation, RelayStats } from '../src/types';

const MAX = 300;
const log: Delegation[] = [];

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function str(v: unknown, max = 300): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** Accepts one report; anything malformed is coerced or dropped. */
export function addDelegation(raw: unknown): Delegation | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const route = r.route === 'subagent' || r.route === 'worker' ? r.route : 'model';
  const d: Delegation = {
    at: num(r.at) || Date.now(),
    sessionId: str(r.sessionId, 100),
    cwd: str(r.cwd, 500),
    mainModel: str(r.mainModel, 100),
    route,
    target: str(r.target, 100),
    model: str(r.model, 100),
    task: str(r.task, 300),
    tokens: num(r.tokens),
    cost: num(r.cost),
    saved: num(r.saved),
  };
  log.push(d);
  if (log.length > MAX) log.splice(0, log.length - MAX);
  return d;
}

export function relayStats(now = Date.now(), extra: Delegation[] = []): RelayStats {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const all = [...log, ...extra].sort((a, b) => a.at - b.at);
  const today = all.filter((d) => d.at >= start.getTime());
  return {
    countToday: today.length,
    costToday: today.reduce((n, d) => n + d.cost, 0),
    savedToday: today.reduce((n, d) => n + d.saved, 0),
    recent: all.slice(-12).reverse(),
  };
}
