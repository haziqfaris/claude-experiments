export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

export function fmtCost(c: number | null | undefined): string {
  return c == null ? '—' : `$${c.toFixed(2)}`;
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

export function shortModel(model: string | null): string {
  if (!model) return '—';
  const m = model.match(/claude-([a-z]+)-([\d-]+)/);
  return m ? `${m[1].toUpperCase()} ${m[2].replace(/-/g, '.')}` : model.toUpperCase();
}
