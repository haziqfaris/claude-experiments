// Simulated projects for when there are no transcripts yet (or SOUL_DEMO=1),
// so the interface can be explored before Claude Code has run on this machine.
import type { ProjectDetail, ProjectSnapshot, SessionDetail, Snapshot } from '../src/types';

interface DemoProject {
  name: string;
  path: string;
  branch: string;
  model: string;
  rate: number; // tokens per second while active
  activeEvery: number; // seconds per activity cycle
  prompts: string[];
  reply: string;
  files: string[];
  tools: [string, number][];
  dirty: string[];
  commits: [string, string][];
}

const DEMO: DemoProject[] = [
  {
    name: 'payments-api',
    path: '/home/you/code/payments-api',
    branch: 'feat/idempotency',
    model: 'claude-opus-5-5',
    rate: 2600,
    activeEvery: 40,
    prompts: [
      'Add idempotency keys to the charge endpoint',
      'Make the retry test deterministic',
      'Why does the webhook handler double-post on timeout?',
    ],
    reply: 'Idempotency keys are stored in Redis with a 24h TTL; the charge handler now short-circuits on a repeated key and returns the original response.',
    files: ['src/handlers/charge.ts', 'src/lib/idempotency.ts', 'test/charge.test.ts'],
    tools: [['Edit', 31], ['Bash', 22], ['Read', 47], ['Grep', 12]],
    dirty: [' M src/handlers/charge.ts', '?? src/lib/idempotency.ts'],
    commits: [['a91c2fe', 'Add idempotency middleware skeleton'], ['77d03b1', 'Retry webhooks with backoff']],
  },
  {
    name: 'reka-soul-engine',
    path: '/home/you/code/reka-soul-engine',
    branch: 'main',
    model: 'claude-sonnet-5-5',
    rate: 1400,
    activeEvery: 25,
    prompts: ['Wire the orbit nodes to live project data', 'Make the soul core pulse with token burn'],
    reply: 'The orbits now read from /api/snapshot; node size follows tokens today and the core intensity follows burn per minute.',
    files: ['src/App.tsx', 'src/components/DataOrbits.tsx'],
    tools: [['Edit', 18], ['Read', 25], ['Bash', 6]],
    dirty: [' M src/App.tsx'],
    commits: [['5be81d0', 'Soul protocol terminal streams answers']],
  },
  {
    name: 'handbook',
    path: '/home/you/docs/handbook',
    branch: 'docs/v2',
    model: 'claude-haiku-5-5',
    rate: 500,
    activeEvery: 90,
    prompts: ['Fix broken relative links across docs/', 'Summarize the onboarding chapter'],
    reply: 'Fixed 14 relative links in docs/ and regenerated the sidebar index.',
    files: ['docs/onboarding.md', 'docs/sidebar.json'],
    tools: [['Edit', 9], ['Grep', 7]],
    dirty: [],
    commits: [['c0ffee1', 'Fix relative links']],
  },
];

const PRICE: Record<string, number> = {
  'claude-opus-5-5': 0.9,
  'claude-sonnet-5-5': 0.45,
  'claude-haiku-5-5': 0.03,
}; // blended $/M tokens with heavy cache reads, demo only

const started = Date.now();

function project(d: DemoProject, i: number, now: number): ProjectSnapshot {
  const t = (now - started) / 1000;
  const active = Math.floor(t / d.activeEvery + i) % 3 !== 2;
  const base = 180_000 * (3 - i);
  const tokensToday = Math.round(base + t * d.rate * 0.6);
  const lastActivity = active ? now - 5_000 : now - 7 * 60_000;
  const cost = (tokensToday / 1e6) * PRICE[d.model];
  const session: SessionDetail = {
    id: `demo-${i}`,
    title: d.prompts[d.prompts.length - 1],
    branch: d.branch,
    model: d.model,
    entrypoint: 'cli',
    status: active ? 'active' : 'recent',
    startedAt: started - 3_600_000,
    lastActivity,
    tokensTotal: tokensToday * 3,
    tokensToday,
    outputToday: Math.round(tokensToday * 0.03),
    costTotal: cost * 3,
    costToday: cost,
    contextTokens: Math.round(120_000 + i * 90_000 + (t * 40) % 200_000),
    contextPct: Math.min(96, 12 + i * 9 + ((t * 0.02) % 40)),
    prompts: d.prompts.map((text, k) => ({ ts: now - (d.prompts.length - k) * 600_000, text })),
    replies: [{ ts: lastActivity, text: d.reply }],
    tools: d.tools.map(([name, count]) => ({ name, count })),
    files: d.files.map((p, k) => ({ path: `${d.path}/${p}`, ts: now - k * 120_000 })),
  };
  return {
    id: d.path,
    name: d.name,
    path: d.path,
    status: session.status,
    branch: d.branch,
    lastActivity,
    sessionCount: 1,
    liveSessions: active ? 1 : 0,
    tokensToday,
    tokensTotal: session.tokensTotal,
    outputToday: session.outputToday,
    costToday: cost,
    costTotal: cost * 3,
    models: [d.model],
    contextPct: session.contextPct,
    lastPrompt: session.title,
    sessions: [session],
  };
}

export function demoSnapshot(): Snapshot {
  const now = Date.now();
  const projects = DEMO.map((d, i) => project(d, i, now));
  const burn = Array.from({ length: 30 }, (_, k) =>
    Math.round(90_000 + 50_000 * Math.sin((now / 60_000 - 30 + k) / 3) + 20_000 * Math.sin(k)),
  );
  return {
    generatedAt: now,
    source: 'demo',
    root: '(demo data)',
    projects,
    totals: {
      tokensToday: projects.reduce((n, p) => n + p.tokensToday, 0),
      outputToday: projects.reduce((n, p) => n + p.outputToday, 0),
      costToday: projects.reduce((n, p) => n + (p.costToday ?? 0), 0),
      liveSessions: projects.reduce((n, p) => n + p.liveSessions, 0),
      sessions: projects.length,
      projects: projects.length,
      burnPerMin: burn[29],
    },
    burn,
  };
}

export function demoDetail(id: string): ProjectDetail | null {
  const i = DEMO.findIndex((d) => d.path === id);
  if (i === -1) return null;
  const d = DEMO[i];
  const p = project(d, i, Date.now());
  return {
    project: p,
    sessions: p.sessions as SessionDetail[],
    git: {
      branch: d.branch,
      dirty: d.dirty,
      commits: d.commits.map(([hash, subject], k) => ({ hash, subject, when: `${k + 1} hours ago` })),
    },
    notes: null,
  };
}
