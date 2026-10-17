// jarvisd: the local hub behind the Soul Engine. Serves live project stats,
// streams them to the dashboard, and answers questions about them.
import './env';
import { createReadStream, promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AskEvent, AskRequest, ProjectDetail, Snapshot } from '../src/types';
import { ask, askUsesApi, soulModel } from './ask';
import { demoDetail, demoSnapshot } from './demo';
import { gitInfo, projectNotes } from './git';
import { addDelegation, relayStats } from './relay';
import { TranscriptIndex } from './transcripts';
import { InventoryIndex, searchInventory } from './inventory';
import { accessRegisterDraft, rotationChecklist } from './docs';
import { changeReportMarkdown, diffInventories, maybeWriteWeeklyReport, saveSnapshot, snapshotBefore } from './history';
import { scopeFor, scopedInventory } from './tools';
import { inventoryContext } from './inventory';
import { routePlan, routesMarkdown, suggestRoutes } from './routes';
import { projectStatus, statusMarkdown } from './status';
import { roadmapChanges, roadmapMarkdown } from './roadmap';
import type { FlowGraph, Inventory } from '../src/types';

/** The project (a group in projects.local.json) a folder belongs to, by repo path. */
function projectOf(inv: Inventory, cwd: string): { name: string; repos: string[] } | null {
  const n = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const c = n(cwd);
  const hit = inv.projects.filter((p) => [p.path, ...(p.alsoAt ?? [])].some((x) => c === n(x) || c.startsWith(n(x) + '/')))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!hit) return null;
  const g = inv.groups.find((x) => x.repos.includes(hit.id));
  return g ? { name: g.name, repos: g.repos.map((id) => inv.projects.find((p) => p.id === id)?.name ?? id) } : { name: hit.name, repos: [hit.name] };
}

function flowGraph(): FlowGraph {
  const chats = index.flow();
  const inv = inventory.get();
  const planRoutes: FlowGraph['planRoutes'] = {};
  for (const c of chats) if (c.plan) planRoutes[c.id] = routePlan(c.plan.steps, projectOf(inv, c.cwd)?.name ?? null);
  const suggestions = suggestRoutes(chats);
  const relay = relayStats();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const agents = chats.flatMap((c) => c.agents);
  return {
    generatedAt: Date.now(), chats, planRoutes, suggestions, delegations: relay.recent,
    totals: {
      liveChats: chats.filter((c) => c.status !== 'idle').length,
      running: agents.filter((a) => a.status === 'running').length,
      returnedToday: agents.filter((a) => a.status === 'returned' && (a.endedAt ?? 0) >= start.getTime()).length,
      handoffCostToday: agents.filter((a) => a.startedAt >= start.getTime()).reduce((n, a) => n + (a.cost ?? 0), 0) + relay.costToday,
      possibleSaving: suggestions.reduce((n, s) => n + (s.saving ?? 0), 0),
    },
  };
}

const PORT = Number(process.env.SOUL_PORT ?? 7777);
const HOST = process.env.SOUL_HOST ?? '127.0.0.1';
const FORCE_DEMO = process.env.SOUL_DEMO === '1';
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

const index = new TranscriptIndex();
const inventory = new InventoryIndex();
inventory.onScanned = (inv) => {
  saveSnapshot(inv)
    .then(() => maybeWriteWeeklyReport(inv))
    .then((file) => { if (file) console.log(`weekly inventory change report: ${file}`); })
    .catch((err) => console.error('snapshot not saved:', err));
};
const CONTINUITY = process.env.SOUL_CONTINUITY_CHECK ?? null;
const projectPaths = () => (snap.source === 'demo' ? [] : snap.projects.map((p) => p.path));
function rescan() {
  inventory.scan(projectPaths()).catch((err) => console.error('inventory scan failed:', err));
}
let snap: Snapshot = demoSnapshot();

async function tick() {
  await index.refresh();
  const real = index.snapshot();
  snap = FORCE_DEMO || real.projects.length === 0 ? demoSnapshot() : { ...real, relay: relayStats() };
}

async function detail(id: string): Promise<ProjectDetail | null> {
  if (snap.source === 'demo') return demoDetail(id);
  const project = snap.projects.find((p) => p.id === id);
  if (!project) return null;
  const [git, notes] = await Promise.all([gitInfo(project.path), projectNotes(project.path)]);
  return { project, sessions: index.sessionDetails(id), git, notes };
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, limit = 256 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const sseClients = new Set<http.ServerResponse>();

function sse(res: http.ServerResponse) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

async function serveStatic(urlPath: string, res: http.ServerResponse) {
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  let file = path.join(DIST, rel);
  if (!file.startsWith(DIST)) return json(res, 403, { error: 'forbidden' });
  try {
    const st = await fs.stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(DIST, 'index.html'); // single-page app fallback
  }
  try {
    await fs.access(file);
  } catch {
    return json(res, 404, { error: 'Run `npm run build` first, or use `npm run dev`.' });
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/snapshot') return json(res, 200, snap);

    if (req.method === 'GET' && url.pathname === '/api/events') {
      sse(res);
      res.write(`data: ${JSON.stringify(snap)}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/project') {
      const d = await detail(url.searchParams.get('id') ?? '');
      return d ? json(res, 200, d) : json(res, 404, { error: 'unknown project' });
    }

    if (req.method === 'GET' && url.pathname === '/api/inventory') {
      if (inventory.stale()) rescan();
      const q = url.searchParams.get('q');
      const inv = scopedInventory(inventory.get(), scopeFor(inventory.get(), url.searchParams.get('project')));
      return json(res, 200, q ? { scannedAt: inv.scannedAt, hits: searchInventory(inv, q, 200) } : inv);
    }

    if (req.method === 'GET' && url.pathname === '/api/inventory/changes') {
      const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days')) || 7));
      const scope = scopeFor(inventory.get(), url.searchParams.get('project'));
      const before = await snapshotBefore(days);
      const report = diffInventories(before ? scopedInventory(before, scope) : null, scopedInventory(inventory.get(), scope));
      return json(res, 200, { report, markdown: changeReportMarkdown(report) });
    }

    if (req.method === 'GET' && url.pathname === '/api/docs/access-register') {
      const project = url.searchParams.get('project') ?? '';
      const markdown = accessRegisterDraft(inventory.get(), project);
      return markdown ? json(res, 200, { title: `${project}: Access Register draft`, file: `${project.replace(/[^A-Za-z0-9]+/g, '-')}-access-register.md`, markdown }) : json(res, 404, { error: 'unknown project' });
    }

    if (req.method === 'GET' && url.pathname === '/api/docs/rotation') {
      const key = url.searchParams.get('key') ?? '';
      const markdown = rotationChecklist(inventory.get(), key);
      return markdown ? json(res, 200, { title: `Rotate ${key}`, file: `rotate-${key.toLowerCase()}.md`, markdown }) : json(res, 404, { error: 'no repo uses that key' });
    }

    if (req.method === 'POST' && url.pathname === '/api/inventory/rescan') {
      rescan();
      return json(res, 202, { scanning: true });
    }

    // ---- Relay and the soul's tools (called by the soul-relay plugin inside Claude Code) ----
    if (req.method === 'GET' && url.pathname === '/api/flow') return json(res, 200, flowGraph());
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { ask: askUsesApi() ? 'api' : 'subscription' });

    if (req.method === 'GET' && url.pathname === '/api/status') {
      return json(res, 200, await projectStatus(inventory.get(), url.searchParams.get('refresh') === '1'));
    }
    if (req.method === 'GET' && url.pathname === '/api/soul/status') {
      const all = await projectStatus(inventory.get());
      const p = url.searchParams.get('project');
      return json(res, 200, { text: statusMarkdown(p ? all.filter((s) => s.name === p) : all) });
    }

    if (req.method === 'GET' && url.pathname === '/api/roadmap/changes') {
      const days = Math.max(1, Math.min(180, Number(url.searchParams.get('days')) || 30));
      const p = url.searchParams.get('project');
      const all = (await projectStatus(inventory.get())).filter((s) => !p || s.name === p);
      return json(res, 200, await roadmapChanges(all.map((s) => ({ project: s.name, roadmap: s.roadmap })), days));
    }
    if (req.method === 'GET' && url.pathname === '/api/soul/roadmap-template') {
      const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../templates/ROADMAP.md');
      return json(res, 200, { text: await fs.readFile(file, 'utf8').catch(() => '') });
    }
    if (req.method === 'GET' && url.pathname === '/api/soul/roadmap') {
      const p = url.searchParams.get('project');
      const all = await projectStatus(inventory.get());
      const list = p ? all.filter((s) => s.name === p) : all;
      return json(res, 200, { text: list.length ? list.map((s) => roadmapMarkdown(s.name, s.roadmap)).join('\n\n') : `No project named "${p}".` });
    }

    if (req.method === 'GET' && url.pathname === '/api/soul/scope') {
      return json(res, 200, { project: projectOf(inventory.get(), url.searchParams.get('cwd') ?? '') });
    }

    if (req.method === 'GET' && url.pathname === '/api/soul/inventory') {
      const project = url.searchParams.get('project');
      const q = url.searchParams.get('q');
      const inv = scopedInventory(inventory.get(), scopeFor(inventory.get(), project));
      if (q) {
        const hits = searchInventory(inv, q, 80);
        return json(res, 200, { text: hits.length ? hits.map((h) => `${h.project} · ${h.fact.label}: ${h.fact.value}${h.fact.evidence[0] ? ` (${h.fact.evidence.slice(0, 2).join(', ')})` : ''}`).join('\n') : `No inventory fact${project ? ` in ${project}` : ''} matches "${q}".` });
      }
      return json(res, 200, { text: inventoryContext(inv, project ? [project] : null, 30_000) || 'The inventory is empty or still scanning.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/soul/plan') {
      const id = url.searchParams.get('session') ?? '';
      const chat = index.flow(7 * 86_400_000).find((c) => c.id === id);
      const project = chat ? projectOf(inventory.get(), chat.cwd)?.name ?? null : null;
      const routes = chat?.plan ? routePlan(chat.plan.steps, project) : [];
      return json(res, 200, { routes, text: routesMarkdown(routes, `Suggested routes for this chat's plan${project ? ` (${project})` : ''}`) });
    }

    if (req.method === 'POST' && url.pathname === '/api/soul/routes') {
      const body = JSON.parse(await readBody(req, 64 * 1024)) as { steps?: unknown; cwd?: unknown };
      const steps = Array.isArray(body.steps) ? body.steps.filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
      const project = typeof body.cwd === 'string' ? projectOf(inventory.get(), body.cwd)?.name ?? null : null;
      const routes = routePlan(steps, project);
      return json(res, 200, { routes, text: routesMarkdown(routes, `Suggested routes${project ? ` (${project})` : ''}`) });
    }

    if (req.method === 'GET' && url.pathname === '/api/soul/overview') {
      const g = flowGraph();
      const inv = inventory.get();
      const lines = [`${g.totals.liveChats} live chats · ${g.totals.running} hand-offs running · ${g.totals.returnedToday} returned today`, ''];
      for (const c of g.chats.filter((x) => x.status !== 'idle').slice(0, 10)) {
        lines.push(`- ${projectOf(inv, c.cwd)?.name ?? c.folder} · ${c.model ?? '?'} · ${c.phase}${c.doing ? ` · ${c.doing.tool}${c.doing.detail ? ` (${c.doing.detail})` : ''}` : ''}: ${c.title.slice(0, 90)}`);
        for (const a of c.agents.filter((x) => x.status === 'running')) lines.push(`  ↳ ${a.label} · ${a.model ?? a.agentType ?? a.kind} · running`);
      }
      if (g.suggestions.length) lines.push('', 'Suggestions:', ...g.suggestions.map((s) => `- ${s.title}: ${s.why}`));
      return json(res, 200, { text: lines.join('\n') });
    }

    if (req.method === 'POST' && url.pathname === '/api/delegations') {
      const d = addDelegation(JSON.parse(await readBody(req, 16 * 1024)));
      return d ? json(res, 201, { ok: true }) : json(res, 400, { error: 'expected a delegation object' });
    }

    if (req.method === 'POST' && url.pathname === '/api/ask') {
      const body = JSON.parse(await readBody(req)) as AskRequest;
      if (typeof body.question !== 'string' || !body.question.trim()) {
        return json(res, 400, { error: 'question is required' });
      }
      sse(res);
      const abort = new AbortController();
      res.on('close', () => abort.abort());
      const send = (e: AskEvent) => {
        if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
      };
      await ask(body, snap, detail, send, abort.signal, inventory.get(), inventory, CONTINUITY);
      return res.end();
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    if (!res.headersSent) return json(res, 500, { error: (err as Error).message });
    res.end();
  }
});

await tick();
rescan(); // the first inventory scan runs in the background
let busy = false;
setInterval(async () => {
  if (busy) return; // a slow first parse must not stack refreshes
  busy = true;
  try {
    await tick();
  } catch (err) {
    console.error('refresh failed:', err);
  } finally {
    busy = false;
  }
  const payload = `data: ${JSON.stringify(snap)}\n\n`;
  for (const c of sseClients) c.write(payload);
}, 2000);

server.listen(PORT, HOST, () => {
  console.log(`REKA Soul Engine hub on http://${HOST}:${PORT}`);
  console.log(`  source: ${snap.source === 'demo' ? 'demo data' : index.root} · ${snap.projects.length} project(s) · ask box: ${askUsesApi() ? `API (${soulModel})` : "offline; ask in Claude Code with /soul"}`);
});
