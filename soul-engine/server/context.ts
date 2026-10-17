// Turns the live snapshot into the context block the Soul Engine answers from.
import path from 'node:path';
import type { ProjectDetail, ProjectSnapshot, Snapshot } from '../src/types';

export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

export function fmtCost(c: number | null): string {
  return c == null ? 'n/a' : `$${c.toFixed(2)}`;
}

export function ago(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

/** Projects the question is about: named ones first, else the focused one, else the most recent. */
export function pickProjects(snap: Snapshot, question: string, focusId?: string | null): ProjectSnapshot[] {
  const q = question.toLowerCase();
  const named = snap.projects.filter((p) => {
    const keys = [p.name, path.basename(p.path)].map((k) => k.toLowerCase());
    return keys.some((k) => k.length > 2 && q.includes(k));
  });
  if (named.length) return named.slice(0, 3);
  const focused = snap.projects.find((p) => p.id === focusId);
  if (focused) return [focused];
  return snap.projects.filter((p) => p.status !== 'idle').slice(0, 2);
}

function overview(snap: Snapshot): string {
  const now = snap.generatedAt;
  const t = snap.totals;
  const lines = [
    `Now: ${new Date(now).toString()}`,
    `Data source: ${snap.source === 'demo' ? 'DEMO DATA (simulated projects)' : `Claude Code transcripts in ${snap.root}`}`,
    `Totals today: ${fmtTokens(t.tokensToday)} tokens (${fmtTokens(t.outputToday)} output), est. cost ${fmtCost(t.costToday)}, ${t.liveSessions} live session(s), ${t.sessions} session(s) across ${t.projects} project(s), burn ${fmtTokens(t.burnPerMin)} tokens/min.`,
    `Delegated to cheaper models today (soul-relay): ${snap.relay.countToday} task(s), spent ${fmtCost(snap.relay.costToday)}, saved about ${fmtCost(snap.relay.savedToday)} vs the main model.`,
    ...snap.relay.recent.slice(0, 5).map(
      (d) => `  - ${ago(d.at, now)}: ${path.basename(d.cwd) || '?'} -> ${d.target} (${d.model}, ${d.route}): "${d.task}" saved ${fmtCost(d.saved)}`,
    ),
    '',
    'All projects (most recent first):',
    '| project | status | branch | last activity | sessions (live) | tokens today | cost today | cost all-time | models | context % (live) | last prompt |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const p of snap.projects.slice(0, 25)) {
    lines.push(
      `| ${p.name} | ${p.status} | ${p.branch ?? '-'} | ${ago(p.lastActivity, now)} | ${p.sessionCount} (${p.liveSessions}) | ${fmtTokens(p.tokensToday)} | ${fmtCost(p.costToday)} | ${fmtCost(p.costTotal)} | ${p.models.join(', ')} | ${p.contextPct == null ? '-' : p.contextPct.toFixed(0) + '%'} | ${(p.lastPrompt ?? '-').replace(/\|/g, '/')} |`,
    );
  }
  return lines.join('\n');
}

function detailBlock(d: ProjectDetail, now: number): string {
  const p = d.project;
  const out = [`## Project: ${p.name}`, `Path: ${p.path}`];
  if (d.git) {
    out.push(`Git branch: ${d.git.branch ?? '-'}; uncommitted changes: ${d.git.dirty.length}`);
    if (d.git.dirty.length) out.push('Uncommitted files:\n' + d.git.dirty.map((l) => `  ${l}`).join('\n'));
    if (d.git.commits.length) {
      out.push('Recent commits:\n' + d.git.commits.map((c) => `  ${c.hash} ${c.subject} (${c.when})`).join('\n'));
    }
  }
  if (d.notes) out.push(`Excerpt of ${d.notes.file}:\n"""\n${d.notes.excerpt}\n"""`);
  for (const s of d.sessions) {
    out.push(
      `### Session ${s.id.slice(0, 8)} · ${s.status} · last activity ${ago(s.lastActivity, now)}`,
      `Model: ${s.model ?? '-'}; branch: ${s.branch ?? '-'}; started ${ago(s.startedAt, now)}; via ${s.entrypoint ?? '-'}`,
      `Tokens today ${fmtTokens(s.tokensToday)} (output ${fmtTokens(s.outputToday)}); all-time ${fmtTokens(s.tokensTotal)}; cost today ${fmtCost(s.costToday)}, all-time ${fmtCost(s.costTotal)}`,
      `Context in use: ${fmtTokens(s.contextTokens)}${s.contextPct == null ? '' : ` (${s.contextPct.toFixed(0)}% of window)`}`,
    );
    if (s.tools.length) out.push('Tools used: ' + s.tools.map((t) => `${t.name}×${t.count}`).join(', '));
    if (s.files.length) out.push('Files touched (newest first): ' + s.files.map((f) => f.path).join(', '));
    if (s.prompts.length) {
      out.push('Recent user prompts (oldest first):\n' + s.prompts.map((m) => `  [${ago(m.ts, now)}] ${m.text}`).join('\n'));
    }
    if (s.replies.length) {
      out.push('Latest assistant replies:\n' + s.replies.map((m) => `  [${ago(m.ts, now)}] ${m.text}`).join('\n'));
    }
  }
  return out.join('\n');
}

export function buildContext(snap: Snapshot, details: ProjectDetail[]): string {
  return [overview(snap), ...details.map((d) => detailBlock(d, snap.generatedAt))].join('\n\n');
}

/** A plain stats answer for when no Claude credentials are configured. */
export function offlineAnswer(snap: Snapshot, details: ProjectDetail[]): string {
  const t = snap.totals;
  const lines: string[] = [];
  if (!details.length) {
    lines.push(
      `${t.projects} project(s) echo in the core: ${fmtTokens(t.tokensToday)} tokens today, est. ${fmtCost(t.costToday)}, ${t.liveSessions} live.`,
    );
    for (const p of snap.projects.slice(0, 5)) {
      lines.push(`• ${p.name}: ${p.status}, ${fmtTokens(p.tokensToday)} today, last seen ${ago(p.lastActivity)}`);
    }
  }
  for (const d of details) {
    const p = d.project;
    const s = d.sessions[0];
    lines.push(
      `${p.name} · ${p.status} on ${d.git?.branch ?? p.branch ?? 'unknown branch'} · ${fmtTokens(p.tokensToday)} tokens today (${fmtCost(p.costToday)}) · ${p.liveSessions}/${p.sessionCount} sessions live.`,
    );
    if (s?.prompts.length) lines.push(`Last ask: "${s.prompts[s.prompts.length - 1].text}"`);
    if (s?.files.length) lines.push(`Recently touched: ${s.files.slice(0, 4).map((f) => path.basename(f.path)).join(', ')}`);
    if (d.git?.dirty.length) lines.push(`${d.git.dirty.length} uncommitted change(s).`);
  }
  lines.push('', '[offline: no Claude credentials found, so this is a stats summary. Set ANTHROPIC_API_KEY to talk to the Soul Engine.]');
  return lines.join('\n');
}
